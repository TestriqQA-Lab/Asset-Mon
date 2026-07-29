import { GET, POST } from '../lib/client.mjs';

// The employee experience, checked as its own thing rather than as the leftover
// of the admin one. Most of these lock down fixes that were made because an
// employee was being shown something they could not use, or could see something
// they should not.

export async function run(report, t) {
  const employee = { token: t.employee.token };
  const admin = { token: t.admin.token };

  report.suite('Employee — "my assets" really is only theirs');

  const mine = await GET('/assets?assignedToMe=1', employee);
  report.status('employee lists their own assets', mine, 200);
  const items = mine.body?.items ?? [];
  const myId = t.employee.user?.id;
  report.ok(
    'every row returned is assigned to the caller',
    items.every((a) => !a.assignedToId || a.assignedToId === myId),
    `${items.filter((a) => a.assignedToId && a.assignedToId !== myId).length} row(s) belonged to someone else`,
  );

  // The filter must key off the session, not off a parameter the caller
  // supplies — otherwise an employee could read anyone's assets by guessing.
  const someoneElse = await GET(`/assets?assignedToMe=1&userId=${t.admin.user?.id}`, employee);
  const spoofed = someoneElse.body?.items ?? [];
  report.ok(
    'passing another user id does not widen the result',
    spoofed.every((a) => !a.assignedToId || a.assignedToId === myId),
    'an employee could read another user\'s assets by adding a query parameter',
  );

  report.suite('Employee — pagination');

  const paged = await GET('/assets?page=1&pageSize=2', employee);
  report.status('employee can page the asset list', paged, 200);
  report.ok('a page holds at most the requested size', (paged.body?.items ?? []).length <= 2, `got ${(paged.body?.items ?? []).length}`);
  report.ok('the response reports a total', typeof paged.body?.total === 'number');
  report.eq('the response echoes the page size', paged.body?.pageSize, 2);

  report.suite('Employee — reference data is trimmed');

  // Employees need category NAMES to render their own asset rows, so categories
  // stay readable — but only id and name, never workspace-wide asset counts.
  const cats = await GET('/categories', employee);
  report.status('employee may read categories', cats, 200);
  const catRows = Array.isArray(cats.body) ? cats.body : cats.body?.items ?? [];
  const leaked = catRows.filter((c) => Object.keys(c).some((k) => !['id', 'name'].includes(k)));
  report.ok(
    'categories expose only id and name',
    leaked.length === 0,
    leaked.length ? `extra fields: ${Object.keys(leaked[0]).filter((k) => !['id', 'name'].includes(k)).join(',')}` : '',
  );

  report.status('employee may not read departments', await GET('/departments', employee), 403);
  report.status('employee may not read locations', await GET('/locations', employee), 403);
  report.status('employee may not read the user list', await GET('/users', employee), 403);

  report.suite('Employee — search is refused, not silently broken');

  // The search box used to be shown to employees, fail on the server, and have
  // the error swallowed — so it looked like nothing matched. The refusal itself
  // is the correct behaviour; the fix was to stop offering the box.
  report.status('employee search is refused outright', await GET('/search?q=laptop', employee), 403);

  report.suite('Employee — their own dashboard');

  const stats = await GET('/dashboard/stats', employee);
  report.status('employee reads dashboard stats', stats, 200);
  report.status('employee may not read workspace alerts', await GET('/dashboard/alerts', employee), 403);

  report.suite('Employee — reservations are self-service only');

  const forSomeoneElse = await POST(
    '/reservations',
    {
      assetId: '00000000-0000-4000-8000-000000000000',
      userId: t.admin.user?.id,
      startAt: new Date(Date.now() + 86400000).toISOString(),
      endAt: new Date(Date.now() + 172800000).toISOString(),
    },
    employee,
  );
  report.status('employee cannot book on someone else\'s behalf', forSomeoneElse, 403);
}
