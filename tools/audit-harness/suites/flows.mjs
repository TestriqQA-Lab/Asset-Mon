import { GET, POST, PATCH, DEL } from '../lib/client.mjs';
import { TAG } from './lifecycle.mjs';

export async function run(report, t, state) {
  const admin = { token: t.admin.token };
  const manager = { token: t.manager.token };
  const employee = { token: t.employee.token };

  // A dedicated asset so these flows never depend on demo data staying put.
  const asset = await POST('/assets', { name: `${TAG}flow-asset`, status: 'AVAILABLE' }, admin);
  const assetId = asset.body?.id;
  if (assetId) state.assets.push(assetId);

  report.suite('Request flow');

  if (!assetId) {
    report.skip('request flow', 'could not create the asset these checks act on');
  } else {
    const raised = await POST('/asset-requests', { mode: 'SPECIFIC', assetIds: [assetId], reason: 'harness: need a laptop' }, employee);
    report.status('employee raises a specific-device request', raised, 201);
    const reqId = raised.body?.id;
    if (reqId) state.requests.push(reqId);
    report.eq('it starts out pending', raised.body?.status, 'PENDING');

    const mine = await GET('/asset-requests', employee);
    report.status('employee sees their own requests', mine, 200);
    const rows = mine.body?.items ?? mine.body ?? [];
    report.ok('the new request appears in their list', Array.isArray(rows) && rows.some((r) => r.id === reqId));

    if (reqId) {
      const cancelled = await POST(`/asset-requests/${reqId}/cancel`, {}, employee);
      report.status('employee cancels their own pending request', cancelled, [200, 201]);

      // A decided request is history — cancelling twice must not be possible.
      report.status('cancelling twice is refused', await POST(`/asset-requests/${reqId}/cancel`, {}, employee), [400, 409]);
    }

    // The other mode: ask for a category rather than a named device. A title is
    // required here, where a specific-device request derives one from the picks.
    const byCategory = await POST('/asset-requests', { mode: 'CATEGORY', title: `${TAG}need a laptop`, reason: 'harness' }, employee);
    report.status('employee raises a category request', byCategory, 201);
    if (byCategory.body?.id) state.requests.push(byCategory.body.id);
    report.status(
      'a category request with no title is refused',
      await POST('/asset-requests', { mode: 'CATEGORY', reason: 'harness' }, employee),
      400,
    );
    report.status(
      'a specific-device request with no devices is refused',
      await POST('/asset-requests', { mode: 'SPECIFIC', assetIds: [], reason: 'harness' }, employee),
      400,
    );

    // Once cancelled, the asset is requestable again.
    const again = await POST('/asset-requests', { mode: 'SPECIFIC', assetIds: [assetId], reason: 'harness: second ask' }, employee);
    report.status('the asset can be requested again after a cancel', again, 201);
    const secondId = again.body?.id;
    if (secondId) {
      state.requests.push(secondId);
      const approved = await POST(`/asset-requests/${secondId}/approve`, {}, manager);
      report.status('manager approves it', approved, [200, 201]);
      report.status('employee cannot approve a request', await POST(`/asset-requests/${secondId}/approve`, {}, employee), 403);
    }
  }

  report.suite('Ticket flow');

  if (!assetId) {
    report.skip('ticket flow', 'no asset available');
  } else {
    const ticket = await POST('/tickets', { assetId, title: `${TAG}screen flickers`, priority: 'LOW' }, employee);
    report.status('employee raises a ticket against an asset', ticket, 201);
    const ticketId = ticket.body?.id;
    if (ticketId) state.tickets.push(ticketId);
    report.eq('it opens in OPEN', ticket.body?.status, 'OPEN');

    // A ticket cannot exist without an asset. This is a known design friction,
    // recorded here so the behaviour is pinned rather than accidental.
    report.status('a ticket with no asset is refused', await POST('/tickets', { title: `${TAG}I need VPN access` }, employee), 400);

    if (ticketId) {
      report.status('manager moves it along', await PATCH(`/tickets/${ticketId}`, { status: 'IN_PROGRESS' }, manager), 200);
      report.status('manager resolves it', await PATCH(`/tickets/${ticketId}`, { status: 'RESOLVED', resolution: 'harness' }, manager), 200);
    }
  }

  report.suite('Reservation flow');

  if (!assetId) {
    report.skip('reservation flow', 'no asset available');
  } else {
    const start = new Date(Date.now() + 86400000).toISOString();
    const end = new Date(Date.now() + 172800000).toISOString();

    const booked = await POST('/reservations', { assetId, userId: t.employee.user.id, startAt: start, endAt: end }, employee);
    report.status('employee books the asset for themselves', booked, 201);
    report.eq('an employee booking waits for approval', booked.body?.status, 'REQUESTED');
    if (booked.body?.id) state.reservations.push(booked.body.id);

    // The overlap check is the whole point of reservations.
    const clash = await POST('/reservations', { assetId, userId: t.manager.user.id, startAt: start, endAt: end }, manager);
    report.status('an overlapping booking is refused', clash, 400);
    report.ok(
      'the clash names the conflicting reservation',
      String(clash.body?.message || '').toLowerCase().includes('conflict'),
      `message was: ${JSON.stringify(clash.body?.message)}`,
    );
    if (clash.body?.id) state.reservations.push(clash.body.id);

    report.status(
      'an end before its start is refused',
      await POST('/reservations', { assetId, userId: t.manager.user.id, startAt: end, endAt: start }, manager),
      400,
    );

    // A manager booking is trusted and skips the approval step.
    const later = new Date(Date.now() + 5 * 86400000).toISOString();
    const laterEnd = new Date(Date.now() + 6 * 86400000).toISOString();
    const mgrBooking = await POST('/reservations', { assetId, userId: t.manager.user.id, startAt: later, endAt: laterEnd }, manager);
    report.status('manager books directly', mgrBooking, 201);
    report.eq('a manager booking is confirmed straight away', mgrBooking.body?.status, 'CONFIRMED');
    if (mgrBooking.body?.id) state.reservations.push(mgrBooking.body.id);
  }
}

export async function cleanup(report, t, state) {
  report.suite('Cleanup');
  const admin = { token: t.admin.token };
  const employee = { token: t.employee.token };

  let stuck = 0;

  for (const id of state.reservations) {
    await POST(`/reservations/${id}/cancel`, {}, admin);
  }
  for (const id of state.tickets) {
    await DEL(`/tickets/${id}`, admin);
  }

  // Requests have no delete route on purpose — a request is history, and the
  // only way to close one is to cancel or decline it. A category request has no
  // asset, so unlike a specific-device request it does not disappear when the
  // asset does; it has to be closed explicitly or it lingers as PENDING.
  //
  // Cancelling belongs to whoever raised the request — an admin gets 403 on
  // someone else's. The reviewer's equivalent is `decline`. So: try cancel as
  // the employee who raised it, then fall back to declining it as the admin.
  for (const id of state.requests) {
    let closed = await POST(`/asset-requests/${id}/cancel`, {}, employee);
    if (closed.status >= 300) closed = await POST(`/asset-requests/${id}/decline`, { reason: 'harness cleanup' }, admin);
    // An already-decided request refuses both, which is correct — it is closed
    // already and needs nothing further.
    if (closed.status >= 300 && ![400, 409].includes(closed.status)) stuck++;
  }

  // Assets go last: deleting one cascades its specific-device request lines away.
  const refused = [];
  for (const id of state.assets) {
    const r = await DEL(`/assets/${id}`, admin);
    if (r.status >= 300) {
      stuck++;
      refused.push(`${id.slice(0, 8)} → ${r.status} ${JSON.stringify(r.body?.message ?? r.body).slice(0, 120)}`);
    }
  }

  report.ok(
    'every harness record could be closed or deleted',
    stuck === 0,
    refused.length ? refused.join(' | ') : `${stuck} record(s) resisted cleanup`,
  );

  // Sweep by name prefix as well as by tracked id. A run that dies half way
  // through leaves records nothing is tracking any more, and without this the
  // wreckage accumulates in the demo workspace run after run.
  const sweptRequests = await sweepRequests(admin, employee);
  const sweptAssets = await sweepAssets(admin);
  if (sweptRequests || sweptAssets) {
    report.pass('swept residue from an earlier run', `${sweptAssets} asset(s), ${sweptRequests} request(s)`);
  }

  const left = await GET('/assets?pageSize=200', admin);
  const survivors = (left.body?.items ?? []).filter((a) => String(a.name || '').startsWith(TAG));
  report.ok('no harness assets left behind', survivors.length === 0, `${survivors.length} left: ${survivors.map((s) => s.name).join(', ')}`);

  // Requests are expected to survive as closed history. What must NOT survive
  // is a harness request still sitting in someone's queue.
  const openHarness = (await harnessRequests(admin)).filter((r) => r.status === 'PENDING');
  report.ok(
    'no harness request left sitting in the queue',
    openHarness.length === 0,
    `${openHarness.length} still open: ${openHarness.map((r) => `${r.title}(${r.status})`).join(', ')}`,
  );
}

async function harnessRequests(admin) {
  const res = await GET('/asset-requests?pageSize=200', admin);
  const rows = res.body?.items ?? res.body ?? [];
  return (Array.isArray(rows) ? rows : []).filter((r) => String(r.title || '').includes(TAG));
}

async function sweepRequests(admin, employee) {
  let n = 0;
  for (const r of await harnessRequests(admin)) {
    if (r.status !== 'PENDING') continue; // APPROVED/DECLINED/FULFILLED/CANCELLED are already closed
    let done = await POST(`/asset-requests/${r.id}/cancel`, {}, employee);
    if (done.status >= 300) done = await POST(`/asset-requests/${r.id}/decline`, { reason: 'harness sweep' }, admin);
    if (done.status < 300) n++;
  }
  return n;
}

async function sweepAssets(admin) {
  const res = await GET('/assets?pageSize=200', admin);
  const rows = (res.body?.items ?? []).filter((a) => String(a.name || '').startsWith(TAG));
  let n = 0;
  for (const a of rows) {
    const d = await DEL(`/assets/${a.id}`, admin);
    if (d.status < 300) n++;
  }
  return n;
}
