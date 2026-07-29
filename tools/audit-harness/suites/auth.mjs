import { GET, POST, login, ACCOUNTS, WORKSPACE } from '../lib/client.mjs';

export async function run(report, t) {
  report.suite('Auth — credentials');

  for (const role of ['admin', 'manager', 'employee']) {
    const { email, password, role: expected } = ACCOUNTS[role];
    const r = await login(email, password);
    report.status(`${role} logs in`, r, 201);
    report.eq(`${role} carries role ${expected}`, r.body?.user?.role, expected);
    report.ok(`${role} receives an access token`, typeof r.body?.accessToken === 'string' && r.body.accessToken.length > 20);
    report.ok(`${role} receives a refresh token`, typeof r.body?.refreshToken === 'string' && r.body.refreshToken.length > 20);
  }

  report.status('wrong password refused', await login(ACCOUNTS.admin.email, 'WrongPassword123'), 401);
  report.status('unknown email refused', await login('nobody@s4demo10679.test', 'DemoPass123'), 401);
  report.status(
    'right credentials, wrong workspace refused',
    await POST('/auth/login', { email: ACCOUNTS.admin.email, password: ACCOUNTS.admin.password, workspaceSlug: 'not-a-real-workspace' }),
    [401, 403, 404],
  );
  report.status('empty credentials refused', await POST('/auth/login', { email: '', password: '', workspaceSlug: WORKSPACE }), [400, 401]);

  report.suite('Auth — token handling');

  report.status('no token refused', await GET('/assets'), 401);
  report.status('garbage token refused', await GET('/assets', { token: 'not-a-jwt' }), 401);
  report.status('well-formed but bogus token refused', await GET('/assets', { token: 'aaa.bbb.ccc' }), 401);
  report.status(
    'token with tampered signature refused',
    await GET('/assets', { token: t.admin.token.slice(0, -6) + 'AAAAAA' }),
    401,
  );

  report.suite('Auth — identity');

  for (const role of ['admin', 'manager', 'employee']) {
    const me = await GET('/me', { token: t[role].token });
    report.status(`${role} reads /me`, me, 200);
    report.eq(`${role} /me returns their own email`, me.body?.user?.email, ACCOUNTS[role].email);
    report.eq(`${role} /me reports role ${ACCOUNTS[role].role}`, me.body?.user?.role, ACCOUNTS[role].role);
    report.ok(`${role} /me names the workspace`, me.body?.tenant?.slug === WORKSPACE, `got ${me.body?.tenant?.slug}`);
  }

  // A token minted for one role must not be usable to claim another. This is
  // the cheapest possible check that the role travels in the signed payload
  // rather than being looked up from something the caller controls.
  const empOnAdminRoute = await GET('/audit', { token: t.employee.token });
  report.status('employee token cannot reach an admin route', empOnAdminRoute, 403);
}
