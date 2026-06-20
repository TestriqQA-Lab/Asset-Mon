export type BlogPost = {
  slug: string;
  title: string;
  description: string; // ~155 chars
  category: 'ITAM' | 'Operations' | 'Security' | 'Finance' | 'How-to' | 'Industry';
  tags: string[];
  author: string;
  publishedAt: string; // ISO
  updatedAt?: string;
  readingMinutes: number;
  // body paragraphs and headings as a simple structured array — rendered into <section>s
  body: { h2?: string; p?: string; ul?: string[]; quote?: string; faq?: { q: string; a: string }[] }[];
};

const A_RAVI = 'Ravi Mehta';
const A_PRIYA = 'Priya Sharma';
const A_NIKHIL = 'Nikhil Patel';
const A_AMY = 'Amy Chen';
const A_JOEL = 'Joel Rivera';

export const POSTS: BlogPost[] = [
  {
    slug: 'what-is-it-asset-management',
    title: 'What is IT Asset Management (ITAM)? A Complete Guide for 2026',
    description:
      'A practical, modern guide to IT Asset Management — what it is, why it matters, the lifecycle stages, and how to roll out ITAM without buying enterprise bloat.',
    category: 'ITAM',
    tags: ['IT asset management', 'ITAM', 'asset lifecycle', 'asset tracking'],
    author: A_RAVI, publishedAt: '2026-04-22', readingMinutes: 7,
    body: [
      { p: 'IT Asset Management — ITAM — is the discipline of tracking every piece of hardware, software, and digital service an organisation owns, from the moment it is purchased to the day it is securely retired. Done well, ITAM is the difference between a finance team that knows what they own and one that overpays for renewals on software no one is using.' },
      { h2: 'Why ITAM matters in 2026' },
      { p: 'Three trends have made ITAM a board-level concern: hybrid work, SaaS sprawl, and stricter compliance. A typical 200-person company now owns 4–5 active devices per employee and over 200 SaaS subscriptions. Without a single source of truth, you cannot tell auditors what you own, you cannot ship laptops to new hires on time, and you cannot answer the simplest finance question: how much will renewals cost us next quarter?' },
      { h2: 'The 6 stages of the IT asset lifecycle' },
      { ul: [
        'Plan & request: someone asks for a thing; a Purchase Request captures the why.',
        'Procure: a Purchase Order is issued; the asset is on its way.',
        'Receive & tag: hardware arrives, gets an asset tag (QR/barcode), and is logged.',
        'Deploy: the asset is assigned to a user, device, or location.',
        'Maintain: service tickets, preventive maintenance, and warranty management.',
        'Retire & dispose: secure data wipe, certificate of destruction, depreciation entries.',
      ]},
      { h2: 'Hardware vs software asset management' },
      { p: 'Hardware ITAM cares about physical artefacts: laptops, monitors, phones. Software Asset Management (SAM) cares about entitlements: do we have enough seats, are we over-deployed, when does the contract renew? A modern ITAM platform treats both as first-class — and links the two (a license is assigned to a device, the device is assigned to a person, the person is in a department, the department has a budget).' },
      { h2: 'The 5-step rollout that actually works' },
      { ul: [
        'Inventory what you have in week 1 — even a CSV is better than nothing.',
        'Settle on naming conventions (asset tags, categories, locations) before the team grows attached to ad-hoc ones.',
        'Tag the top 20% of high-value assets first; do not try to boil the ocean.',
        'Wire procurement so every new device enters the system on receipt.',
        'Schedule the first physical audit at month 3 — discrepancies you find are gold.',
      ]},
      { h2: 'How AssetMon helps' },
      { p: 'AssetMon was built for teams who want enterprise-grade ITAM without the implementation project. Every workspace gets its own database, default categories, and a guided onboarding. Custom fields per category, QR-coded asset tags, CSV import, depreciation engine, license compliance, service tickets, and audit-ready logs are all built-in. Sign up for the 30-day trial — no credit card.' },
    ],
  },
  {
    slug: 'hardware-vs-software-asset-management',
    title: 'Hardware Asset Management vs Software Asset Management: Key Differences',
    description: 'HAM and SAM solve different problems with the same vocabulary. Here is how they differ — and why most teams need both under one platform.',
    category: 'ITAM',
    tags: ['hardware asset management', 'software asset management', 'SAM', 'HAM'],
    author: A_PRIYA, publishedAt: '2026-04-15', readingMinutes: 6,
    body: [
      { p: 'Hardware Asset Management (HAM) and Software Asset Management (SAM) are siblings — same parent (ITAM), very different temperaments. Understanding the distinction matters because the tools, the controls, and the people who care are not the same.' },
      { h2: 'What HAM tracks' },
      { ul: [
        'Physical units: laptops, monitors, phones, servers, peripherals.',
        'Location, custodian, condition, serial number, warranty.',
        'Depreciation: book value across the useful life.',
        'Disposal: certificate of destruction, GDPR data wipe attestations.',
      ]},
      { h2: 'What SAM tracks' },
      { ul: [
        'License entitlements (seats purchased) vs. consumption (seats used).',
        'Renewal dates, contract terms, true-up obligations.',
        'Per-device vs. per-user vs. concurrent-user models.',
        'Over-deployment risk — the #1 source of vendor audit penalties.',
      ]},
      { h2: 'Where they overlap' },
      { p: 'A user receives a MacBook. The MacBook gets Microsoft 365 + Adobe Creative Cloud + Figma. That triple — device → user → license — is where most teams lose visibility. A modern ITAM platform stitches it together so when someone offboards, you reclaim three SaaS seats and one device in one click.' },
      { h2: 'Tooling implications' },
      { p: 'A spreadsheet can sort-of do HAM. SAM in a spreadsheet is a compliance time bomb. Choose tooling that does both natively and links them.' },
    ],
  },
  {
    slug: 'kpis-asset-managers',
    title: '10 Essential KPIs Every Asset Manager Should Track',
    description: 'The metrics that separate a reactive asset team from a strategic one — and how to calculate each in your existing data.',
    category: 'Operations',
    tags: ['asset management KPIs', 'ITAM metrics', 'MTTR', 'utilisation', 'TCO'],
    author: A_NIKHIL, publishedAt: '2026-04-10', readingMinutes: 8,
    body: [
      { p: 'You cannot improve what you do not measure. The right KPIs turn ITAM from a chore into a strategic function. Here are ten metrics — five operational, five financial — every team should be tracking weekly.' },
      { h2: 'Operational KPIs' },
      { ul: [
        'Asset utilisation rate: % of assets currently assigned vs. in stock.',
        'Mean time to deploy (MTTD): days from ticket to "in user hands".',
        'Mean time to repair (MTTR): hours from ticket OPEN to RESOLVED.',
        'First-time fix rate: % of tickets resolved without escalation.',
        'Audit coverage: % of expected assets scanned in the last physical audit.',
      ]},
      { h2: 'Financial KPIs' },
      { ul: [
        'Total cost of ownership (TCO) per asset class.',
        'Depreciation accuracy: actual book value vs. accounting book value.',
        'Maintenance cost as % of replacement value.',
        'License utilisation: seats used / seats paid.',
        'Loss rate: % of assets reported lost annually.',
      ]},
      { p: 'A platform like AssetMon emits these out of the box via the Reports module. Start by setting a target for each, then run a quarterly review against the trend line.' },
    ],
  },
  {
    slug: 'asset-tagging-qr-vs-barcode-vs-rfid',
    title: 'Asset Tagging Best Practices: QR Codes vs Barcodes vs RFID',
    description: 'A practical comparison of the three dominant asset tag technologies, with cost, durability, scan distance and use-case guidance.',
    category: 'How-to',
    tags: ['asset tagging', 'QR codes', 'barcodes', 'RFID', 'asset labels'],
    author: A_AMY, publishedAt: '2026-04-04', readingMinutes: 6,
    body: [
      { p: 'Every asset needs a unique identifier you can scan in the field. Three technologies dominate: linear (1D) barcodes, QR (2D) codes, and RFID. Each has a sweet spot.' },
      { h2: 'Linear barcodes' },
      { p: 'Cheap, ubiquitous, and dumb in the best way. Requires line-of-sight and a dedicated scanner for best results. Fine for warehouses, less useful for ad-hoc scanning on a phone.' },
      { h2: 'QR codes' },
      { p: 'Scan from any smartphone, encode meaningful payloads (asset tag + URL), survive partial damage thanks to built-in error correction. AssetMon generates QR labels per asset with a JSON payload that includes the tenant context — point your camera, hit the URL, you are on the asset detail page.' },
      { h2: 'RFID' },
      { p: 'No line of sight, scan dozens of tags per second from several metres. Magic for warehouse audits, overkill (and expensive) for an office.' },
      { h2: 'Our recommendation' },
      { ul: [
        'Standard office: durable QR labels (laminated polyester, 38mm).',
        'Warehouses / tool cribs: passive UHF RFID.',
        'Hybrid: QR for high-value items, plain barcode for consumables.',
      ]},
    ],
  },
  {
    slug: 'asset-depreciation-straight-line-vs-declining-balance',
    title: 'How to Calculate Asset Depreciation: Straight-Line vs Declining Balance',
    description: 'Two methods, two outcomes. We walk through the math, the tax implications and when to choose each — with a worked example.',
    category: 'Finance',
    tags: ['asset depreciation', 'straight-line depreciation', 'declining balance', 'book value'],
    author: A_JOEL, publishedAt: '2026-03-28', readingMinutes: 7,
    body: [
      { p: 'Depreciation is how you spread an asset\'s cost over its useful life. Choose the wrong method and your balance sheet over- or under-states value for years.' },
      { h2: 'Straight-line depreciation' },
      { p: 'Equal expense per period. Formula: (Cost − Salvage value) ÷ Useful life. Simple, predictable, beloved by tax authorities. Best for assets that lose value evenly — most office hardware fits.' },
      { h2: 'Declining-balance (double-declining)' },
      { p: 'Front-loaded expense. Formula: Book value × (2 / Useful life). Reflects how a laptop actually loses value: a lot in year one, less every year after. Better matches reality for IT hardware; tax authorities sometimes restrict it.' },
      { h2: 'Worked example: MacBook Pro 16" at $2,999, salvage $200, 36-month life' },
      { ul: [
        'Straight-line: ($2,999 − $200) / 36 = $77.75/month for 36 months.',
        'Declining balance (rate 2/36 ≈ 5.56%): month 1 = $166.61, month 12 ≈ $89.32, month 24 ≈ $47.78.',
      ]},
      { h2: 'How AssetMon computes both' },
      { p: 'Set the method, salvage value, useful life and start date on the asset; AssetMon shows current book value, the full monthly schedule, and a fleet-wide depreciation report you can export to CSV for your accountant.' },
    ],
  },
  {
    slug: 'spreadsheet-asset-tracking-failing',
    title: '7 Signs Your Spreadsheet-Based Asset Tracking Is Failing You',
    description: 'Excel got you to 50 people. Past that, the silent costs start to bite. Seven red flags to check this week.',
    category: 'Operations',
    tags: ['spreadsheet asset tracking', 'asset tracking software', 'when to replace Excel'],
    author: A_RAVI, publishedAt: '2026-03-21', readingMinutes: 5,
    body: [
      { p: 'Spreadsheets are an excellent starting point — and a terrible finishing one. Watch for these seven signals.' },
      { ul: [
        '1. Multiple "master" files exist and nobody knows which is canonical.',
        '2. New hires wait three days for hardware while someone hunts for a serial number.',
        '3. You discovered a software audit liability you cannot reconcile from the sheet.',
        '4. The annual physical audit takes a person-week — and 8% of items are unaccounted for.',
        '5. Finance and IT disagree about the depreciation schedule on every report.',
        '6. Offboarded users still have access to SaaS tools because nobody updated the sheet.',
        '7. Sensitive data (serial numbers, employee names, license keys) is in a shared OneDrive link.',
      ]},
      { p: 'If three or more apply, it is time to upgrade. Migrating from a spreadsheet to a structured ITAM platform takes a weekend, not a quarter.' },
    ],
  },
  {
    slug: 'license-compliance-vendor-audit',
    title: 'License Compliance: How to Avoid a Vendor Audit Nightmare',
    description: 'Vendor audits cost mid-size companies an average of $260K in true-ups. Here is the SAM playbook that keeps you compliant year-round.',
    category: 'Security',
    tags: ['license compliance', 'software audit', 'SAM', 'vendor true-up'],
    author: A_PRIYA, publishedAt: '2026-03-14', readingMinutes: 7,
    body: [
      { p: 'Microsoft, Oracle, Adobe, Salesforce — at some point they all knock. The good news: audits are deterministic. If your records are clean and your seat counts are accurate, you walk away with a renewal, not a true-up.' },
      { h2: 'The three things audits actually check' },
      { ul: [
        'How many copies / seats are deployed?',
        'How many do you own (entitlements)?',
        'Can you prove it with a contract and a system of record?',
      ]},
      { h2: 'A year-round compliance routine' },
      { ul: [
        'Maintain a license-of-record system with seats vs. assignments visible at a glance.',
        'Auto-revoke assignments on employee offboarding.',
        'Reconcile usage monthly — a 10-minute job once you are set up.',
        'Document every contract change with a date, the contract PDF, and an approver.',
      ]},
      { p: 'AssetMon\'s License Compliance report flags over-deployment in real time, lists every seat by assignee, and exports to CSV your legal team will recognise.' },
    ],
  },
  {
    slug: 'preventive-vs-reactive-maintenance',
    title: 'Preventive Maintenance vs Reactive Maintenance: An ROI Comparison',
    description: 'Reactive maintenance feels free until it is not. We model the true cost of "wait until it breaks" vs. scheduled preventive work.',
    category: 'Operations',
    tags: ['preventive maintenance', 'reactive maintenance', 'maintenance ROI', 'MTBF'],
    author: A_NIKHIL, publishedAt: '2026-03-07', readingMinutes: 6,
    body: [
      { p: 'Two strategies, very different P&Ls. The math usually surprises people.' },
      { h2: 'Reactive: the hidden cost' },
      { p: 'You pay only when something breaks. But you also pay for: the user\'s downtime, the rush shipping, the goodwill cost of a stalled meeting, the inflated repair quote on an emergency call, and the shorter overall lifespan of the asset.' },
      { h2: 'Preventive: predictable spend' },
      { p: 'Scheduled checks at fixed intervals (battery health every 6 months, AC vent clean every 12 months). Per-unit cost is small; aggregate avoidance is large.' },
      { h2: 'Worked example: 100 laptops over 3 years' },
      { ul: [
        'Reactive only: ~$32K in repairs + ~120 lost hours.',
        'PM every 6 months: ~$18K maintenance + ~$11K repairs + ~25 lost hours.',
        'Net savings ≈ $13K + 95 hours.',
      ]},
      { p: 'Set up recurring maintenance schedules in AssetMon\'s Maintenance module and let the system surface what is due each week.' },
    ],
  },
  {
    slug: 'multi-tenant-saas-database-per-tenant',
    title: 'Multi-Tenant SaaS Architecture: Why Database-Per-Tenant Wins',
    description: 'Shared schema with tenant_id is cheap to build and expensive to operate. Here is when database-per-tenant pays off — and when it doesn\'t.',
    category: 'Industry',
    tags: ['multi-tenant architecture', 'SaaS', 'database per tenant', 'data isolation'],
    author: A_AMY, publishedAt: '2026-02-28', readingMinutes: 8,
    body: [
      { p: 'Every B2B SaaS hits this fork in the road on day one: shared schema with a tenant_id column, or one database per customer. AssetMon picked the second. Here is why — and the trade-offs.' },
      { h2: 'Shared schema (row-level)' },
      { ul: [
        '✓ Cheap to host; one Postgres for thousands of tenants.',
        '✓ Schema migrations run once.',
        '✗ One missed WHERE clause is a data breach.',
        '✗ Noisy-neighbour queries hurt everyone.',
        '✗ Per-tenant backup/restore is awkward.',
      ]},
      { h2: 'Database-per-tenant' },
      { ul: [
        '✓ True isolation — accidental cross-tenant reads are physically impossible.',
        '✓ Per-tenant backup, restore, encryption, and even region pinning.',
        '✓ Performance issues are localised.',
        '✗ Migration tooling has to fan out across every DB.',
        '✗ Connection-pool engineering is non-trivial.',
      ]},
      { h2: 'The cost is exaggerated' },
      { p: 'Modern Postgres handles thousands of databases per instance. Connection pooling (PgBouncer, RDS Proxy) makes the connection cost manageable. The operational complexity is solvable with one engineer and good migrations tooling.' },
      { h2: 'Our take' },
      { p: 'For B2B apps where data sensitivity is high, the auditor will sleep better with database-per-tenant. We built it into AssetMon from day one for exactly this reason.' },
    ],
  },
  {
    slug: 'iso-27001-asset-management-controls',
    title: 'ISO 27001 Asset Management Controls: A Practical Checklist',
    description: 'A6.5–A6.7 (Annex A) translated into concrete actions your team can complete this quarter, with evidence templates.',
    category: 'Security',
    tags: ['ISO 27001', 'asset management controls', 'compliance', 'audit-ready'],
    author: A_JOEL, publishedAt: '2026-02-21', readingMinutes: 7,
    body: [
      { p: 'The 2022 revision of ISO 27001 moved asset management into theme A6 (People) and theme A7 (Physical). For an auditor, four controls dominate.' },
      { h2: 'A6.5 Inventory of information and other associated assets' },
      { p: 'Maintain a living inventory with an owner per asset. Evidence: a CSV export of every asset, owner, and classification, dated within the audit window.' },
      { h2: 'A6.6 Acceptable use of information and associated assets' },
      { p: 'A signed acknowledgement on issue. Evidence: per-asset assignment record with timestamp and user.' },
      { h2: 'A6.7 Return of assets' },
      { p: 'Documented offboarding with asset retrieval. Evidence: check-in record on the day of termination plus a secure wipe certificate.' },
      { h2: 'A7.10 Storage media' },
      { p: 'Disposal procedure for storage media. Evidence: certificate of destruction or wipe.' },
      { p: 'AssetMon\'s immutable audit log captures every check-out, check-in, status change and assignment — exactly the trail ISO auditors want to see.' },
    ],
  },
  {
    slug: 'true-cost-of-a-lost-laptop',
    title: 'The True Cost of a Lost Laptop (And How to Prevent It)',
    description: 'A lost laptop costs more than its replacement value. We break down the direct, indirect and reputational costs — and how to drop your loss rate.',
    category: 'Security',
    tags: ['lost laptop cost', 'data breach', 'asset loss rate', 'BYOD'],
    author: A_RAVI, publishedAt: '2026-02-14', readingMinutes: 5,
    body: [
      { p: 'The replacement laptop is the cheapest line item. The full bill — direct, indirect, reputational — usually runs 8–12× the device cost.' },
      { h2: 'What you actually pay' },
      { ul: [
        'Hardware replacement: $1,500–$3,000.',
        'Productivity loss: ~2 days × loaded cost = $1,200.',
        'Forensic / incident response: $5,000–$15,000.',
        'Regulatory notification (if data is sensitive): variable, often >$25,000.',
        'Reputation hit: unbounded.',
      ]},
      { h2: 'How to prevent it' },
      { ul: [
        'Tag every asset on day one; users treat tagged property differently.',
        'Enforce check-out for offsite use — your tool should auto-prompt.',
        'Run a quarterly physical audit and chase discrepancies the same week.',
        'Disk encryption + remote wipe on every device — non-negotiable.',
      ]},
    ],
  },
  {
    slug: 'asset-lifecycle-management-process',
    title: 'Building an Effective Asset Lifecycle Management Process',
    description: 'A blueprint for an end-to-end asset lifecycle: request, procure, deploy, maintain, retire — with the artefacts each stage produces.',
    category: 'Operations',
    tags: ['asset lifecycle', 'asset lifecycle management', 'ALM', 'IT operations'],
    author: A_PRIYA, publishedAt: '2026-02-07', readingMinutes: 8,
    body: [
      { p: 'The asset lifecycle is the spine of ITAM. Every other discipline (depreciation, audits, license compliance, security) hangs off it.' },
      { h2: '1. Plan & request' },
      { p: 'A Purchase Request captures who is asking, for what, and why. Approval routing keeps procurement in the loop without becoming a bottleneck.' },
      { h2: '2. Procure' },
      { p: 'A Purchase Order is generated (often from an approved request). Status tracks DRAFT → SENT → RECEIVED. Vendor terms get captured.' },
      { h2: '3. Receive & tag' },
      { p: 'On receipt, the PO converts into Assets — one per unit — with cost, purchase date and depreciation start prefilled. A QR/barcode label goes on.' },
      { h2: '4. Deploy' },
      { p: 'Asset is checked out to a user (or assigned to a department / location). Audit trail captures the assignment.' },
      { h2: '5. Maintain' },
      { p: 'Recurring maintenance schedules, service tickets, warranty alerts. Status reflects current reality.' },
      { h2: '6. Retire' },
      { p: 'Secure wipe, certificate of destruction, status RETIRED, final depreciation entry. The asset stays in the system as history — auditors love that.' },
    ],
  },
  {
    slug: 'byod-asset-tracking',
    title: 'BYOD Asset Tracking: A Practical Implementation Guide',
    description: 'Bring Your Own Device is here to stay. Track personal hardware fairly, lawfully, and without invading privacy.',
    category: 'How-to',
    tags: ['BYOD', 'bring your own device', 'mobile device management', 'asset tracking'],
    author: A_NIKHIL, publishedAt: '2026-01-31', readingMinutes: 6,
    body: [
      { p: 'BYOD is awkward: the device is the employee\'s, the data on it is the company\'s. Get the policy right and the rest is just tagging.' },
      { h2: 'The three policy questions' },
      { ul: [
        'What devices qualify? (OS, version, encryption status)',
        'What data lives where? (corporate sandbox vs. personal)',
        'What happens at offboarding? (selective wipe of corporate sandbox only)',
      ]},
      { h2: 'Tracking in your ITAM tool' },
      { p: 'Tag BYOD devices with a custom field (`ownership: BYOD`) and a custom category. Track them like any asset, but flag them in reports — finance and security will both want the breakdown.' },
      { h2: 'Privacy guardrails' },
      { p: 'Never capture location, browsing history, or personal files. Document this in the policy and the privacy notice. AssetMon stores only the metadata you explicitly choose to record.' },
    ],
  },
  {
    slug: 'cloud-asset-management-aws-azure-gcp',
    title: 'Cloud Asset Management: AWS, Azure and GCP Best Practices',
    description: 'Cloud resources are assets too. Here is how to keep an inventory that ties cloud spend back to a human owner.',
    category: 'Industry',
    tags: ['cloud asset management', 'AWS', 'Azure', 'GCP', 'cloud inventory'],
    author: A_AMY, publishedAt: '2026-01-24', readingMinutes: 7,
    body: [
      { p: 'Cloud resources rot. Buckets, instances, databases — they get spun up for a project and forgotten. Treat them like any other asset.' },
      { h2: 'Mandatory tags' },
      { ul: [
        '`owner` — an actual person\'s email.',
        '`env` — prod / staging / sandbox.',
        '`project` — for cost allocation.',
        '`expiresAt` — for ephemeral resources.',
      ]},
      { h2: 'Inventory mechanics' },
      { p: 'Pull cloud resource lists via the provider APIs nightly. Reconcile against your ITAM tool — every resource without an owner is a ticket.' },
      { h2: 'Cost guardrails' },
      { p: 'Budget alerts per project tag; the tag chain points to a human. No tag, no provisioning — implement at the IaC layer.' },
    ],
  },
  {
    slug: 'remote-work-asset-management',
    title: 'Remote Work and Asset Management: Tracking Distributed Hardware',
    description: 'Your fleet is now in 30 living rooms. Practical processes to keep visibility and reduce loss without micromanaging.',
    category: 'How-to',
    tags: ['remote work', 'distributed teams', 'asset tracking', 'hybrid work'],
    author: A_JOEL, publishedAt: '2026-01-17', readingMinutes: 5,
    body: [
      { p: 'Pre-2020 ITAM assumed assets lived in an office. That assumption is broken. Here is how to adapt.' },
      { h2: 'Shift the source of truth' },
      { p: 'Location-by-desk becomes location-by-user. Your ITAM tool needs to be useful even when the asset is in someone\'s spare room.' },
      { h2: 'Self-service flows' },
      { p: 'Let users open a service ticket from their phone, scan a QR for their own laptop, and request peripherals — without IT becoming a bottleneck.' },
      { h2: 'Offboarding without an office' },
      { p: 'Pre-paid shipping labels, scheduled wipe, and a return tracker. Track the return shipment as a stage in your asset lifecycle.' },
    ],
  },
  {
    slug: 'physical-asset-audit-8-steps',
    title: 'Asset Audits: How to Run a Physical Inventory in 8 Steps',
    description: 'A repeatable playbook for running a physical asset audit that finds discrepancies without bringing operations to a halt.',
    category: 'How-to',
    tags: ['physical audit', 'asset audit', 'inventory count', 'audit process'],
    author: A_RAVI, publishedAt: '2026-01-10', readingMinutes: 6,
    body: [
      { p: 'A physical audit is the only way to know whether your ITAM records match reality. Run one every quarter, and it stops being a fire drill.' },
      { ul: [
        '1. Define scope: location, department, or category — never "everything" on attempt #1.',
        '2. Freeze movements: no transfers during the count.',
        '3. Print or generate the expected list from your ITAM tool.',
        '4. Walk the floor with a phone or scanner; scan every tag.',
        '5. Capture exceptions as you go — do not save them for later.',
        '6. Reconcile: missing, found-but-unexpected, found-but-wrong-location.',
        '7. Resolve each exception with a documented disposition.',
        '8. Close the audit; track the metrics in a quarterly review.',
      ]},
      { p: 'AssetMon\'s Physical Audits module gives you a scan-to-audit page that accepts QR payloads, raw tags, or barcodes, and computes discrepancies live as you walk.' },
    ],
  },
  {
    slug: 'service-ticket-workflow',
    title: 'Service Ticket Workflow: From OPEN to RESOLVED in Under 24 Hours',
    description: 'The states, the SLAs, and the routing rules that keep your support team out of email and inside the workflow.',
    category: 'Operations',
    tags: ['service ticket workflow', 'IT support', 'help desk', 'SLA'],
    author: A_PRIYA, publishedAt: '2026-01-03', readingMinutes: 6,
    body: [
      { p: 'A ticket without a clear lifecycle is just an email thread. The right states + the right SLAs reduce MTTR dramatically.' },
      { h2: 'The minimum viable state machine' },
      { ul: [
        'OPEN — captured, not yet acknowledged.',
        'IN_PROGRESS — owner assigned.',
        'WAITING_VENDOR — blocked externally.',
        'RESOLVED — fix applied; pending user confirmation.',
        'CLOSED — confirmed.',
      ]},
      { h2: 'Routing rules that work' },
      { ul: [
        'Priority by impact, not by who shouted loudest.',
        'Auto-assign by asset category — laptop tickets go to the laptop tech.',
        'Escalate at SLA breach, not after.',
      ]},
      { p: 'AssetMon\'s Service Tickets module ties every ticket to an asset, captures cost on resolution, and feeds the audit log automatically.' },
    ],
  },
  {
    slug: 'purchase-order-best-practices',
    title: 'Purchase Order Best Practices for IT Procurement Teams',
    description: 'The PO is the contract. Treat it that way. Eight habits that prevent disputes, missing items and tax-line drama.',
    category: 'Finance',
    tags: ['purchase order', 'IT procurement', 'PO best practices', 'vendor management'],
    author: A_NIKHIL, publishedAt: '2025-12-27', readingMinutes: 5,
    body: [
      { p: 'A great PO is precise, vendor-friendly and audit-ready. A bad PO ends in disputes.' },
      { ul: [
        '1. One PO per project — never bundle unrelated items.',
        '2. Item-level detail: description, quantity, unit cost, expected delivery date.',
        '3. Tax line broken out — your finance team will thank you.',
        '4. Approver name on the document, not just in the system.',
        '5. Convert from an approved Purchase Request — preserves the why.',
        '6. Status discipline: DRAFT, SENT, PARTIAL, RECEIVED, CANCELLED.',
        '7. Auto-create assets on receipt (one per unit).',
        '8. Archive the signed PDF on the PO record.',
      ]},
    ],
  },
  {
    slug: 'build-vs-buy-asset-tracking',
    title: 'Choosing Between Custom Software and SaaS for Asset Tracking',
    description: 'A pragmatic decision framework: when to build, when to buy, and the hidden costs of either choice.',
    category: 'Industry',
    tags: ['build vs buy', 'asset tracking software', 'SaaS vs custom', 'TCO'],
    author: A_AMY, publishedAt: '2025-12-20', readingMinutes: 7,
    body: [
      { p: 'Build vs. buy is rarely about features — it is about total cost over five years.' },
      { h2: 'Build wins when' },
      { ul: [
        'Asset tracking is your core competitive advantage.',
        'You have a unique workflow no vendor will ever match.',
        'You have engineers free for the next five years to maintain it.',
      ]},
      { h2: 'Buy wins when' },
      { ul: [
        'Asset tracking is necessary but not differentiating.',
        'You want to start in a week, not a year.',
        'You value vendor accountability for security, uptime and updates.',
      ]},
      { h2: 'The hidden cost of build' },
      { p: 'A custom build is never finished. Year 1 is the easy part. Years 2–5 are integrations, edge cases, migrations and a person whose job is "the asset tool". Cost: typically 4–8× the licence fee of an equivalent SaaS.' },
    ],
  },
  {
    slug: 'gdpr-asset-management-2026',
    title: 'GDPR and Asset Management: What You Need to Know in 2026',
    description: 'Personal data lives on every laptop and license. Here is how to keep ITAM aligned with GDPR + DPDP without slowing your team down.',
    category: 'Security',
    tags: ['GDPR', 'data protection', 'DPDP Act', 'right to erasure', 'asset management'],
    author: A_JOEL, publishedAt: '2025-12-13', readingMinutes: 6,
    body: [
      { p: 'ITAM and data privacy regulation overlap more than people realise. Employees are data subjects too; their asset assignments are personal data.' },
      { h2: 'The three obligations that touch ITAM' },
      { ul: [
        'Right to access: produce all data you hold on an employee.',
        'Right to erasure: anonymise records on legal termination.',
        'Data minimisation: do not store custom fields you do not need.',
      ]},
      { h2: 'Practical controls' },
      { ul: [
        'Pseudonymise offboarded user assignments after retention window.',
        'Document your lawful basis (legitimate interest / contract) in your DPIA.',
        'Sign a DPA with your ITAM vendor — AssetMon has one ready.',
      ]},
      { p: 'AssetMon ships with audit logs, per-tenant data isolation and an exportable data subject report — the building blocks of a defensible GDPR posture.' },
    ],
  },
];

export function getPost(slug: string) {
  return POSTS.find((p) => p.slug === slug);
}

export function relatedPosts(slug: string, n = 3): BlogPost[] {
  const cur = getPost(slug);
  if (!cur) return [];
  return POSTS
    .filter((p) => p.slug !== slug)
    .map((p) => ({ p, score: p.category === cur.category ? 2 : 0 + p.tags.filter((t) => cur.tags.includes(t)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.p);
}

export function postsByCategory(category: BlogPost['category']) {
  return POSTS.filter((p) => p.category === category);
}
