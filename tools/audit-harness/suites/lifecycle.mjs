import { GET, POST, PATCH, DEL } from '../lib/client.mjs';

// Everything this suite creates is named with this prefix so cleanup can find
// it again even if a run dies half way through.
export const TAG = 'HARNESS-';

export async function run(report, t, state) {
  const admin = { token: t.admin.token };
  const employee = { token: t.employee.token };

  report.suite('Asset lifecycle');

  const created = await POST('/assets', { name: `${TAG}laptop`, status: 'AVAILABLE' }, admin);
  report.status('admin creates an asset', created, 201);
  const assetId = created.body?.id;
  if (!assetId) {
    report.skip('remaining lifecycle checks', 'asset creation failed, nothing to act on');
    return;
  }
  state.assets.push(assetId);

  const fetched = await GET(`/assets/${assetId}`, admin);
  report.status('the new asset reads back', fetched, 200);
  report.eq('it kept its name', fetched.body?.name, `${TAG}laptop`);
  report.eq('it kept its status', fetched.body?.status, 'AVAILABLE');

  const renamed = await PATCH(`/assets/${assetId}`, { name: `${TAG}laptop-renamed` }, admin);
  report.status('admin renames it', renamed, 200);
  report.eq('the rename stuck', renamed.body?.name, `${TAG}laptop-renamed`);

  // A partial update must not blank the fields it did not mention. This is the
  // exact shape of the bug that made every save wipe an asset's location.
  const afterPartial = await GET(`/assets/${assetId}`, admin);
  report.eq('a partial update left status alone', afterPartial.body?.status, 'AVAILABLE');

  report.suite('Asset status transitions');
  for (const status of ['ASSIGNED', 'OUT_FOR_REPAIR', 'OUT_OF_SERVICE', 'AVAILABLE']) {
    const r = await PATCH(`/assets/${assetId}`, { status }, admin);
    report.status(`admin moves it to ${status}`, r, 200);
    report.eq(`status is now ${status}`, r.body?.status, status);
  }
  report.status('an invented status is refused', await PATCH(`/assets/${assetId}`, { status: 'BANANA' }, admin), 400);

  report.suite('Requestability follows status');

  // Broken or retired equipment must not be requestable. ASSIGNED and PENDING
  // stay requestable on purpose — queueing behind someone else is legitimate
  // and availability is the reviewer's call.
  for (const status of ['OUT_OF_SERVICE', 'OUT_FOR_REPAIR', 'LOST_STOLEN', 'ARCHIVED']) {
    await PATCH(`/assets/${assetId}`, { status }, admin);
    const asked = await POST('/asset-requests', { mode: 'SPECIFIC', assetIds: [assetId], reason: 'harness check' }, employee);
    report.status(`request refused while ${status}`, asked, 400);
    report.ok(
      `the refusal for ${status} explains itself`,
      typeof asked.body?.message === 'string' && asked.body.message.length > 10,
      `message was: ${JSON.stringify(asked.body?.message)}`,
    );
  }

  await PATCH(`/assets/${assetId}`, { status: 'AVAILABLE' }, admin);
  const okRequest = await POST('/asset-requests', { mode: 'SPECIFIC', assetIds: [assetId], reason: 'harness check' }, employee);
  report.status('request accepted once it is available again', okRequest, 201);
  if (okRequest.body?.id) state.requests.push(okRequest.body.id);

  // ASSIGNED is requestable ON PURPOSE — queueing behind the current holder is
  // legitimate, and the manager judges availability at review time.
  await PATCH(`/assets/${assetId}`, { status: 'ASSIGNED' }, admin);
  const queued = await POST('/asset-requests', { mode: 'SPECIFIC', assetIds: [assetId], reason: 'harness queue' }, employee);
  report.status('an ASSIGNED asset can still be requested', queued, 201);
  if (queued.body?.id) state.requests.push(queued.body.id);
  await PATCH(`/assets/${assetId}`, { status: 'AVAILABLE' }, admin);

  report.suite('Deleting an asset that has history');

  // An asset that had ever been requested used to be undeletable forever —
  // five foreign keys referenced it with no delete rule. Nullable columns now
  // SET NULL so history survives; NOT NULL request lines CASCADE.
  const deleted = await DEL(`/assets/${assetId}`, admin);
  report.status('an asset with a request against it can still be deleted', deleted, [200, 204]);
  if (deleted.status === 200 || deleted.status === 204) {
    state.assets = state.assets.filter((id) => id !== assetId);
    state.requests = [];
  }
  report.status('it is gone afterwards', await GET(`/assets/${assetId}`, admin), 404);
}

/**
 * The audit chain must still verify after all of the above — deleting an asset
 * rewrites its audit rows' assetId to NULL, which used to invalidate every hash
 * from that row onward. Runs last, on purpose.
 */
export async function verifyChain(report, t, label) {
  report.suite(`Audit chain — ${label}`);
  const v = await GET('/audit/verify', { token: t.admin.token });
  report.status('admin can verify the chain', v, 200);
  report.ok('the chain is intact', v.body?.intact === true, `broken entries: ${JSON.stringify(v.body?.broken ?? []).slice(0, 200)}`);
  report.ok('it actually scanned something', (v.body?.scanned ?? 0) > 0, `scanned ${v.body?.scanned}`);
  return v.body?.scanned ?? 0;
}
