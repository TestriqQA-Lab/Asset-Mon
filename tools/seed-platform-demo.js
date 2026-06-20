// Seed a believable, lived-in deployment of ~10 tenants for the platform-admin demo.
//
//   node tools/seed-platform-demo.js
//
// Idempotent-ish: tenants whose slug is already present in the catalog are skipped
// silently (signup would 400 anyway).  Run flush-databases.ps1 to start over.
//
// Parallelism: 3 tenants provision concurrently — enough to be quick, low enough
// to keep the API and Postgres happy.

'use strict';

const { spawnSync } = require('node:child_process');

// Refuse to scribble demo tenants into anything that looks like a production
// host. The seeder calls /api/auth/signup ten times and pokes the catalog DB
// directly via psql, so a stray invocation against prod would be a mess to
// clean up. Pass --allow-prod to explicitly acknowledge that the target really
// is production.
const ALLOW_PROD = process.argv.includes('--allow-prod') || process.env.ALLOW_PROD === '1';
if (!ALLOW_PROD) {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  const apiBase = (process.env.API_BASE || '').toLowerCase();
  const looksProd =
    env === 'production' ||
    /\bprod\b/.test(apiBase) ||
    (/^https:/.test(apiBase) && !/localhost|127\.0\.0\.1/.test(apiBase));
  if (looksProd) {
    console.error('[seed-platform-demo] refusing to run against what looks like production.');
    console.error(`  NODE_ENV=${process.env.NODE_ENV || '(unset)'}  API_BASE=${process.env.API_BASE || '(unset)'}`);
    console.error('  Pass --allow-prod (or set ALLOW_PROD=1) to override.');
    process.exit(2);
  }
}

const BASE = process.env.API_BASE || 'http://localhost:4000';
const PSQL = process.env.PSQL_PATH || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const PG = { host: 'localhost', user: 'postgres', password: 'sandeep', db: 'assetmon_catalog' };

const PLATFORM_EMAIL = 'sandeep@testriq.com';
const PLATFORM_PASSWORD = 'Sandeep!Platform2026';
const ADMIN_PASSWORD = 'Demo!2026Pass';

const CONCURRENCY = 3;

// ───────────────────────────────────────── Tenant catalogue ─────────────────

/**
 * Each tenant defines its identity, plan, the head admin, and a small profile
 * that drives how many users/depts/locations/assets we create. Plans below
 * STARTER are not allowed by the API so we deliberately skip software/tickets/PR
 * for those (their tenant has the modules disabled by ModuleGuard).
 */
const TENANTS = [
  {
    slug: 'acme-industrial', name: 'Acme Industrial', plan: 'business', status: 'ACTIVE',
    admin: { email: 'priya.shah@acme-industrial.test', firstName: 'Priya', lastName: 'Shah' },
    profile: 'industrial',
    receivePo: true,
  },
  {
    slug: 'globex-it', name: 'Globex IT Services', plan: 'enterprise', status: 'ACTIVE',
    admin: { email: 'aditya.rao@globex-it.test', firstName: 'Aditya', lastName: 'Rao' },
    profile: 'it-services',
    receivePo: true,
  },
  {
    slug: 'hexa-school', name: 'Hexa Public School', plan: 'starter', status: 'ACTIVE',
    admin: { email: 'meera.iyer@hexa-school.test', firstName: 'Meera', lastName: 'Iyer' },
    profile: 'school',
  },
  {
    slug: 'northwind-logistics', name: 'Northwind Logistics', plan: 'business', status: 'ACTIVE',
    admin: { email: 'karthik.menon@northwind-logistics.test', firstName: 'Karthik', lastName: 'Menon' },
    profile: 'logistics',
  },
  {
    slug: 'fabrikam-hospital', name: 'Fabrikam Hospital', plan: 'enterprise', status: 'ACTIVE',
    admin: { email: 'noor.fatima@fabrikam-hospital.test', firstName: 'Noor', lastName: 'Fatima' },
    profile: 'hospital',
  },
  {
    slug: 'contoso-cafe', name: 'Contoso Cafe Chain', plan: 'starter', status: 'ACTIVE',
    admin: { email: 'daniel.fernandes@contoso-cafe.test', firstName: 'Daniel', lastName: 'Fernandes' },
    profile: 'cafe',
  },
  {
    slug: 'initech-labs', name: 'Initech R&D Labs', plan: 'business', status: 'ACTIVE',
    admin: { email: 'vikram.subramanian@initech-labs.test', firstName: 'Vikram', lastName: 'Subramanian' },
    profile: 'labs',
  },
  {
    slug: 'umbrella-clinic', name: 'Umbrella Family Clinic', plan: 'starter', status: 'SUSPENDED',
    admin: { email: 'arjun.deshpande@umbrella-clinic.test', firstName: 'Arjun', lastName: 'Deshpande' },
    profile: 'clinic',
  },
  {
    slug: 'stark-studios', name: 'Stark Studios', plan: 'business', status: 'ACTIVE',
    admin: { email: 'tanvi.kapoor@stark-studios.test', firstName: 'Tanvi', lastName: 'Kapoor' },
    profile: 'studios',
  },
  {
    slug: 'wayne-foundation', name: 'Wayne Foundation', plan: 'enterprise', status: 'ACTIVE',
    admin: { email: 'rohan.bhatia@wayne-foundation.test', firstName: 'Rohan', lastName: 'Bhatia' },
    profile: 'foundation',
  },
];

// ───────────────────────────────────────── Industry profiles ────────────────

const PROFILES = {
  'industrial': {
    departments: ['Operations', 'Engineering', 'Finance'],
    locations:   [['Pune Plant', 'BUILDING'], ['Mumbai HQ', 'BUILDING'], ['Aurangabad Yard', 'BUILDING']],
    assetCount: 18,
    extraUsers: 6,
    software: [{ name: 'Autodesk Inventor', publisher: 'Autodesk', seats: 8 }, { name: 'Tally Prime', publisher: 'Tally Solutions', seats: 4 }],
    tickets: ['Hydraulic press fault', 'Battery swelling on lift truck', 'Conveyor sensor mis-reads'],
    purchaseRequest: { title: 'Q3 laptop refresh', items: [{ description: 'Engineer workstation', quantity: 4, unitPriceEstimate: 95000, category: 'Laptop' }, { description: '27" monitor', quantity: 6, unitPriceEstimate: 22000, category: 'Monitor' }] },
  },
  'it-services': {
    departments: ['Engineering', 'IT', 'Sales', 'Operations'],
    locations:   [['Bengaluru Campus', 'BUILDING'], ['Hyderabad Office', 'BUILDING'], ['Pune Office', 'BUILDING'], ['Delhi Branch', 'BUILDING']],
    assetCount: 25,
    extraUsers: 8,
    software: [{ name: 'JetBrains All Products Pack', publisher: 'JetBrains', seats: 25 }, { name: 'Microsoft 365 E3', publisher: 'Microsoft', seats: 50 }, { name: 'GitHub Enterprise', publisher: 'GitHub', seats: 20 }],
    tickets: ['Laptop won\'t boot — black screen', 'VPN client crashes on macOS', 'Backup throwing 0x80070005', 'Keyboard backlight dead'],
    purchaseRequest: { title: 'New-hire kit batch', items: [{ description: 'MacBook Pro 14"', quantity: 5, unitPriceEstimate: 215000, category: 'Laptop' }, { description: 'Logitech MX Master 3S', quantity: 5, unitPriceEstimate: 8500, category: 'Peripheral' }] },
  },
  'school': {
    departments: ['Administration', 'IT'],
    locations:   [['Main Campus', 'BUILDING'], ['Library Wing', 'BUILDING']],
    assetCount: 10,
    extraUsers: 3,
    software: [],
    tickets: [],
    purchaseRequest: null,
  },
  'logistics': {
    departments: ['Operations', 'Finance', 'Sales'],
    locations:   [['Mumbai HQ', 'BUILDING'], ['Chennai Hub', 'BUILDING'], ['Kolkata Depot', 'BUILDING']],
    assetCount: 15,
    extraUsers: 5,
    software: [{ name: 'Microsoft 365 Business', publisher: 'Microsoft', seats: 15 }, { name: 'Tally Prime', publisher: 'Tally Solutions', seats: 3 }],
    tickets: ['Scanner gun dropped, screen cracked', 'Printer paper jam recurring'],
    purchaseRequest: { title: 'Warehouse handheld refresh', items: [{ description: 'Zebra TC22 scanner', quantity: 8, unitPriceEstimate: 32000, category: 'Phone' }] },
  },
  'hospital': {
    departments: ['Administration', 'IT', 'Finance', 'Operations'],
    locations:   [['South Block', 'BUILDING'], ['North Block', 'BUILDING'], ['OPD Wing', 'BUILDING']],
    assetCount: 22,
    extraUsers: 7,
    software: [{ name: 'Microsoft 365 E5', publisher: 'Microsoft', seats: 60 }, { name: 'Adobe Creative Cloud', publisher: 'Adobe', seats: 4 }],
    tickets: ['Reception monitor flicker', 'CCTV NVR offline', 'Pharmacy label printer jam'],
    purchaseRequest: { title: 'OPD desktop refresh', items: [{ description: 'Dell OptiPlex', quantity: 10, unitPriceEstimate: 65000, category: 'Laptop' }, { description: '24" monitor', quantity: 10, unitPriceEstimate: 14000, category: 'Monitor' }] },
  },
  'cafe': {
    departments: ['Operations', 'Finance'],
    locations:   [['Bandra Outlet', 'BUILDING'], ['Powai Outlet', 'BUILDING']],
    assetCount: 8,
    extraUsers: 3,
    software: [],
    tickets: [],
    purchaseRequest: null,
  },
  'labs': {
    departments: ['Engineering', 'Operations', 'IT'],
    locations:   [['Bengaluru Lab', 'BUILDING'], ['Pune Lab', 'BUILDING']],
    assetCount: 16,
    extraUsers: 6,
    software: [{ name: 'MATLAB & Simulink', publisher: 'MathWorks', seats: 10 }, { name: 'JetBrains All Products Pack', publisher: 'JetBrains', seats: 8 }],
    tickets: ['Lab PC GPU fan rattle', 'Oscilloscope serial-port driver', 'OS reinstall request — bench machine'],
    purchaseRequest: { title: 'GPU expansion for ML bench', items: [{ description: 'NVIDIA RTX A6000 workstation', quantity: 2, unitPriceEstimate: 480000, category: 'Laptop' }] },
  },
  'clinic': {
    departments: ['Administration', 'Operations'],
    locations:   [['Andheri Clinic', 'BUILDING'], ['Vile Parle Branch', 'BUILDING']],
    assetCount: 7,
    extraUsers: 3,
    software: [],
    tickets: [],
    purchaseRequest: null,
  },
  'studios': {
    departments: ['Engineering', 'Operations', 'Sales'],
    locations:   [['Mumbai Studio', 'BUILDING'], ['Goa Pop-Up', 'BUILDING']],
    assetCount: 17,
    extraUsers: 6,
    software: [{ name: 'Adobe Creative Cloud', publisher: 'Adobe', seats: 18 }, { name: 'Avid Pro Tools', publisher: 'Avid', seats: 4 }],
    tickets: ['Wacom tablet pen drift', 'Render node thermal throttle'],
    purchaseRequest: { title: 'Color-grade rig upgrade', items: [{ description: 'iMac Pro', quantity: 3, unitPriceEstimate: 295000, category: 'Laptop' }, { description: 'Reference monitor', quantity: 2, unitPriceEstimate: 185000, category: 'Monitor' }] },
  },
  'foundation': {
    departments: ['Administration', 'Finance', 'Operations'],
    locations:   [['Gotham HQ', 'BUILDING'], ['New Delhi Office', 'BUILDING'], ['Bengaluru Field Office', 'BUILDING']],
    assetCount: 20,
    extraUsers: 7,
    software: [{ name: 'Microsoft 365 E3', publisher: 'Microsoft', seats: 40 }, { name: 'Adobe Acrobat Pro', publisher: 'Adobe', seats: 10 }],
    tickets: ['Conference room TV no signal', 'Phone touchscreen unresponsive'],
    purchaseRequest: { title: 'Field-team laptop top-up', items: [{ description: 'Dell Latitude', quantity: 6, unitPriceEstimate: 78000, category: 'Laptop' }] },
  },
};

// ───────────────────────────────────────── Name pool ────────────────────────

// Plausible Indian + global names. Shuffled per tenant so each workspace gets
// a varied roster.
const FIRSTS = [
  'Anil', 'Ananya', 'Arvind', 'Bhavana', 'Chetan', 'Deepa', 'Faraz', 'Gauri', 'Harish', 'Isha',
  'Jagan', 'Kavita', 'Lakshmi', 'Manish', 'Naveen', 'Omkar', 'Pooja', 'Ravi', 'Sneha', 'Tushar',
  'Uma', 'Vidya', 'Yash', 'Zoya', 'Aarav', 'Ishita', 'Reyansh', 'Saanvi', 'Vivaan', 'Diya',
];
const LASTS = [
  'Sharma', 'Verma', 'Patel', 'Nair', 'Reddy', 'Iyer', 'Khan', 'Singh', 'Gupta', 'Joshi',
  'Pillai', 'Banerjee', 'Mukherjee', 'Chatterjee', 'Mehta', 'Shah', 'Kulkarni', 'Pawar', 'Desai', 'Bhat',
];

// ───────────────────────────────────────── HTTP plumbing ────────────────────

async function req(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    err.status = res.status; err.body = data;
    throw err;
  }
  return data;
}

function psql(sql) {
  const env = { ...process.env, PGPASSWORD: PG.password };
  const r = spawnSync(PSQL, ['-h', PG.host, '-U', PG.user, '-d', PG.db, '-v', 'ON_ERROR_STOP=1', '-c', sql], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

// ───────────────────────────────────────── Helpers ──────────────────────────

function pick(arr, n) {
  const out = [];
  const taken = new Set();
  while (out.length < n && out.length < arr.length) {
    const i = Math.floor(Math.random() * arr.length);
    if (taken.has(i)) continue;
    taken.add(i);
    out.push(arr[i]);
  }
  return out;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ASSET_STATUSES = [
  // weighted — most assets sit in-stock or assigned, fewer in repair/retired
  'IN_STOCK', 'IN_STOCK', 'IN_STOCK', 'ASSIGNED', 'ASSIGNED', 'ASSIGNED', 'ASSIGNED', 'IN_REPAIR', 'RETIRED',
];

// ───────────────────────────────────────── Login helpers ────────────────────

async function platformLogin() {
  const r = await req('POST', '/api/platform/auth/login', { email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD });
  return r.accessToken;
}

async function tenantLogin(email, slug) {
  const r = await req('POST', '/api/auth/login', { email, password: ADMIN_PASSWORD, workspaceSlug: slug });
  return r.accessToken;
}

// ───────────────────────────────────────── Provision one tenant ─────────────

async function provisionTenant(t, platformToken) {
  const summary = {
    slug: t.slug, name: t.name, plan: t.plan, status: t.status,
    tenantId: null, users: 0, assets: 0, tickets: 0, software: 0, prs: 0, pos: 0,
    skipped: false, error: null, log: [],
  };
  const log = (s) => { summary.log.push(s); };

  try {
    // 1. Signup (always uses business plan; we downgrade/upgrade later).
    log('signup…');
    let signupResp;
    try {
      signupResp = await req('POST', '/api/auth/signup', {
        workspaceName: t.name, slug: t.slug,
        email: t.admin.email, password: ADMIN_PASSWORD,
        firstName: t.admin.firstName, lastName: t.admin.lastName,
      });
    } catch (e) {
      if (e.status === 400 && /already taken/i.test(typeof e.body === 'object' ? e.body?.message : String(e.body))) {
        log('  slug already exists — skipping this tenant');
        summary.skipped = true;
        return summary;
      }
      throw e;
    }
    summary.tenantId = signupResp.tenant.id;
    summary.users = 1;
    summary.assets = 6; // demo seed
    let adminToken = signupResp.accessToken;

    // 2. Categories / locations / departments
    log('catalog…');
    const profile = PROFILES[t.profile];
    const existingDepts = await req('GET', '/api/departments', undefined, adminToken);
    const existingDeptNames = new Set(existingDepts.map((d) => d.name));
    const depts = [...existingDepts];
    for (const name of profile.departments) {
      if (existingDeptNames.has(name)) continue;
      const d = await req('POST', '/api/departments', { name }, adminToken);
      depts.push(d);
    }
    const existingLocs = await req('GET', '/api/locations', undefined, adminToken);
    const existingLocNames = new Set(existingLocs.map((l) => l.name));
    const locs = [...existingLocs];
    for (const [name, type] of profile.locations) {
      if (existingLocNames.has(name)) continue;
      const l = await req('POST', '/api/locations', { name, type }, adminToken);
      locs.push(l);
    }

    // 3. Extra users (mix of ASSET_MANAGER + EMPLOYEE)
    log('users…');
    const tenantDomain = t.slug + '.test';
    const firsts = shuffle(FIRSTS);
    const lasts = shuffle(LASTS);
    const users = [{ id: signupResp.user.id, email: signupResp.user.email, role: 'ADMIN' }];
    for (let i = 0; i < profile.extraUsers; i++) {
      const first = firsts[i % firsts.length];
      const last = lasts[i % lasts.length];
      const email = `${first.toLowerCase()}.${last.toLowerCase()}.${i}@${tenantDomain}`;
      const role = i === 0 ? 'ASSET_MANAGER' : (i === 1 ? 'ASSET_MANAGER' : 'EMPLOYEE');
      const dept = depts.length > 0 ? depts[i % depts.length] : null;
      try {
        const u = await req('POST', '/api/users', {
          email, password: ADMIN_PASSWORD, firstName: first, lastName: last,
          role, departmentId: dept ? dept.id : null,
        }, adminToken);
        users.push({ id: u.id, email: u.email, role: u.role });
        summary.users++;
      } catch (e) {
        log(`  user ${email} failed: ${e.message}`);
      }
    }

    // 4. Assets (status spread)
    log('assets…');
    const cats = await req('GET', '/api/categories', undefined, adminToken);
    const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
    const targetExtras = Math.max(0, profile.assetCount - 6);
    const newAssetIds = [];
    for (let i = 0; i < targetExtras; i++) {
      const cat = cats[i % cats.length];
      const loc = locs[i % locs.length] || null;
      const dept = depts[i % depts.length] || null;
      const status = ASSET_STATUSES[i % ASSET_STATUSES.length];
      // The lifecycle service flips IN_STOCK ↔ ASSIGNED via checkout; create as IN_STOCK
      // and only push to non-stock statuses that the controller accepts directly.
      const createStatus = status === 'ASSIGNED' ? 'IN_STOCK' : status;
      const name = pickAssetName(cat.name, i);
      try {
        const a = await req('POST', '/api/assets', {
          name,
          categoryId: cat.id,
          locationId: loc ? loc.id : undefined,
          departmentId: dept ? dept.id : undefined,
          status: createStatus,
          purchaseCost: Math.floor(20000 + Math.random() * 180000),
          purchaseDate: new Date(Date.now() - Math.floor(Math.random() * 365) * 86_400_000).toISOString(),
          serialNumber: `${cat.name.slice(0, 3).toUpperCase()}-${t.slug.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(4, '0')}`,
        }, adminToken);
        newAssetIds.push({ id: a.id, status });
        summary.assets++;
      } catch (e) {
        log(`  asset ${i} failed: ${e.message}`);
      }
    }

    // Checkout a handful of assets to flip them to ASSIGNED with real assignment rows.
    const employees = users.filter((u) => u.role !== 'ADMIN');
    let toAssign = newAssetIds.filter((a) => a.status === 'ASSIGNED').slice(0, Math.min(5, employees.length));
    for (let i = 0; i < toAssign.length; i++) {
      try {
        await req('POST', `/api/assets/${toAssign[i].id}/checkout`, {
          userId: employees[i].id,
        }, adminToken);
      } catch (e) {
        log(`  checkout failed: ${e.message}`);
      }
    }

    // 5. Modules that only exist on business/enterprise plans.
    if (t.plan !== 'starter') {
      // Software + licenses
      log('software…');
      const licensesCreated = [];
      for (const s of profile.software) {
        try {
          const sw = await req('POST', '/api/software', { name: s.name, publisher: s.publisher }, adminToken);
          summary.software++;
          // One license per software, plus a second expiring-soon license for the first.
          const lic1 = await req('POST', '/api/licenses', {
            softwareId: sw.id, seats: s.seats, type: 'SUBSCRIPTION',
            purchaseDate: new Date(Date.now() - 90 * 86_400_000).toISOString(),
            expiresAt: new Date(Date.now() + 300 * 86_400_000).toISOString(),
            cost: 12000 + Math.floor(Math.random() * 80000),
          }, adminToken);
          licensesCreated.push({ id: lic1.id, seats: s.seats });
          if (s === profile.software[0]) {
            const lic2 = await req('POST', '/api/licenses', {
              softwareId: sw.id, seats: 2, type: 'PERPETUAL',
              purchaseDate: new Date(Date.now() - 300 * 86_400_000).toISOString(),
              expiresAt: new Date(Date.now() + 45 * 86_400_000).toISOString(),
              cost: 80000,
            }, adminToken);
            licensesCreated.push({ id: lic2.id, seats: 2 });
          }
        } catch (e) {
          log(`  software ${s.name} failed: ${e.message}`);
        }
      }
      // Assign a few seats to users
      let assignedSeats = 0;
      for (const lic of licensesCreated) {
        const targets = users.slice(0, Math.min(lic.seats, 3));
        for (const u of targets) {
          try {
            await req('POST', `/api/licenses/${lic.id}/assign`, { userId: u.id }, adminToken);
            assignedSeats++;
          } catch (e) {
            // duplicate / capacity — ignore
          }
        }
      }

      // Tickets
      log('tickets…');
      const ticketableAssets = newAssetIds.length > 0 ? newAssetIds : [];
      for (let i = 0; i < profile.tickets.length; i++) {
        if (ticketableAssets.length === 0) break;
        const target = ticketableAssets[i % ticketableAssets.length];
        const priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'][i % 4];
        try {
          const tk = await req('POST', '/api/tickets', {
            assetId: target.id,
            title: profile.tickets[i],
            description: `Reported by floor staff — needs triage.`,
            priority,
            assignedToId: employees[i % Math.max(1, employees.length)]?.id,
          }, adminToken);
          summary.tickets++;
          // Mix open/in_progress
          if (i % 2 === 1) {
            await req('PATCH', `/api/tickets/${tk.id}`, { status: 'IN_PROGRESS' }, adminToken).catch(() => {});
          }
        } catch (e) {
          log(`  ticket ${i} failed: ${e.message}`);
        }
      }

      // Purchase request
      if (profile.purchaseRequest) {
        log('purchase request…');
        try {
          const prItems = profile.purchaseRequest.items.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            unitPriceEstimate: it.unitPriceEstimate,
            categoryId: byName.get(it.category.toLowerCase())?.id,
          }));
          const pr = await req('POST', '/api/purchase-requests', {
            title: profile.purchaseRequest.title,
            justification: 'Standard refresh cycle / new-hire ramp.',
            departmentId: depts[0]?.id,
            items: prItems,
          }, adminToken);
          summary.prs++;
          // Half the time submit it
          if (Math.random() > 0.5) {
            await req('POST', `/api/purchase-requests/${pr.id}/submit`, {}, adminToken).catch(() => {});
          }
        } catch (e) {
          log(`  PR failed: ${e.message}`);
        }
      }

      // Optional: full PO cycle (some tenants only)
      if (t.receivePo) {
        log('purchase order…');
        try {
          const cat = byName.get('laptop') || cats[0];
          const po = await req('POST', '/api/purchase-orders', {
            notes: 'Direct PO — bulk order, vendor TBD',
            items: [
              { description: 'Standard laptop bundle', quantity: 3, unitCost: 78000, categoryId: cat.id },
              { description: 'Webcam', quantity: 3, unitCost: 4500, categoryId: byName.get('peripheral')?.id || cat.id },
            ],
          }, adminToken);
          await req('POST', `/api/purchase-orders/${po.id}/send`, {}, adminToken);
          const rcv = await req('POST', `/api/purchase-orders/${po.id}/receive`, { namePrefix: `${t.name} Laptop` }, adminToken);
          summary.pos++;
          summary.assets += rcv.received || 0;
        } catch (e) {
          log(`  PO failed: ${e.message}`);
        }
      }
    }

    // 6. Apply plan change via platform API (signup defaults to business)
    if (t.plan !== 'business') {
      log(`change plan to ${t.plan}…`);
      try {
        await req('PATCH', `/api/platform/tenants/${summary.tenantId}/plan`, { plan: t.plan }, platformToken);
      } catch (e) {
        log(`  plan change failed: ${e.message}`);
      }
    }

    // 7. Suspend if requested
    if (t.status === 'SUSPENDED') {
      log('suspend…');
      try {
        await req('POST', `/api/platform/tenants/${summary.tenantId}/suspend`, {}, platformToken);
      } catch (e) {
        log(`  suspend failed: ${e.message}`);
      }
    }

    // 8. Backdate createdAt randomly over the last 30 days so "Recent signups" looks real.
    const daysAgo = Math.floor(Math.random() * 30);
    const ts = new Date(Date.now() - daysAgo * 86_400_000 - Math.floor(Math.random() * 86_400_000));
    try {
      psql(`UPDATE "Tenant" SET "createdAt" = '${ts.toISOString()}' WHERE id = '${summary.tenantId}';`);
    } catch (e) {
      log(`  backdate failed: ${e.message}`);
    }

    return summary;
  } catch (e) {
    summary.error = e.message;
    return summary;
  }
}

function pickAssetName(catName, i) {
  const pools = {
    'Laptop': ['MacBook Pro 14"', 'MacBook Pro 16"', 'MacBook Air 13"', 'Dell XPS 13', 'Dell Latitude 7440', 'Lenovo ThinkPad X1', 'HP EliteBook 840', 'Asus ZenBook'],
    'Monitor': ['Dell U2724QE', 'LG UltraFine 27"', 'BenQ PD2705U', 'Samsung Odyssey G7', 'HP E27u'],
    'Phone': ['iPhone 15 Pro', 'iPhone 14', 'Samsung Galaxy S24', 'Pixel 8', 'OnePlus 12', 'Zebra TC22 scanner'],
    'Peripheral': ['Logitech MX Master 3S', 'Apple Magic Keyboard', 'Jabra Evolve2 65', 'Logitech C920 webcam', 'Anker USB-C hub'],
    'Furniture': ['Featherlite chair', 'Standing desk', 'Steelcase chair', 'Conference table', 'Filing cabinet'],
  };
  const pool = pools[catName] || ['Generic asset'];
  return `${pool[i % pool.length]} #${i + 1}`;
}

// ───────────────────────────────────────── Driver ───────────────────────────

async function withConcurrency(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: n }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function waitForApi() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) {
        const j = await r.json();
        if (j?.ok) return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function main() {
  console.log(`AssetMon platform demo seeder → ${BASE}`);

  console.log('Waiting for API health…');
  if (!(await waitForApi())) {
    console.error('API did not become healthy within 60 s — aborting.');
    process.exit(2);
  }
  console.log('API healthy.');

  console.log('Logging in as platform super-admin…');
  let platformToken;
  try {
    platformToken = await platformLogin();
  } catch (e) {
    console.error(`Platform login failed: ${e.message}`);
    process.exit(3);
  }

  console.log(`Provisioning ${TENANTS.length} tenants (${CONCURRENCY} in parallel)…\n`);
  const t0 = Date.now();
  const results = await withConcurrency(TENANTS, CONCURRENCY, async (t) => {
    const r = await provisionTenant(t, platformToken);
    if (r.error) console.log(`  ✗ ${t.slug}: ${r.error}`);
    else if (r.skipped) console.log(`  · ${t.slug}: already existed, skipped`);
    else console.log(`  ✓ ${t.slug}: users=${r.users} assets=${r.assets} tickets=${r.tickets} software=${r.software} PR=${r.prs} PO=${r.pos}`);
    return r;
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nProvisioning finished in ${elapsed}s.\n`);

  // Re-login (token may have expired during long runs) and verify via platform API
  platformToken = await platformLogin();
  const metrics = await req('GET', '/api/platform/metrics', undefined, platformToken);
  const tenantsList = await req('GET', '/api/platform/tenants', undefined, platformToken);

  console.log('─── Final summary ─────────────────────────────────────────');
  const provisioned = results.filter((r) => !r.skipped && !r.error);
  const failed = results.filter((r) => r.error);
  console.log(`Tenants created : ${provisioned.length} / ${TENANTS.length}`);
  console.log(`Tenants skipped : ${results.filter((r) => r.skipped).length}`);
  console.log(`Tenants failed  : ${failed.length}`);
  console.log(`Total users     : ${provisioned.reduce((s, r) => s + r.users, 0)} (script-side count)`);
  console.log(`Total assets    : ${provisioned.reduce((s, r) => s + r.assets, 0)} (script-side count)`);
  console.log('');
  console.log(`Platform metrics: tenants.total=${metrics.tenants.total} users=${metrics.users} assets=${metrics.assets} readErrors=${metrics.readErrors}`);
  console.log('Plan mix:', metrics.tenants.byPlan);
  console.log('Status mix:', metrics.tenants.byStatus);
  console.log('');
  console.log('Per-tenant from platform API:');
  for (const t of tenantsList) {
    console.log(`  ${t.slug.padEnd(22)} plan=${String(t.plan).padEnd(10)} status=${String(t.status).padEnd(10)} users=${t.userCount} assets=${t.assetCount}`);
  }
  if (failed.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const f of failed) {
      console.log(`  ${f.slug}: ${f.error}`);
    }
  }

  return { results, metrics, tenantsList };
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Unexpected fatal error:', e);
  process.exit(1);
});
