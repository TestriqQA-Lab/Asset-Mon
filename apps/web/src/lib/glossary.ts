export type GlossaryEntry = { slug: string; term: string; short: string; body: string[]; related?: string[]; tags: string[] };

export const GLOSSARY: GlossaryEntry[] = [
  {
    slug: 'itam',
    term: 'IT Asset Management (ITAM)',
    short: 'The discipline of tracking and managing every hardware, software and digital asset across its full lifecycle.',
    body: [
      'IT Asset Management — ITAM — is the practice of capturing every IT asset an organisation owns and managing it through procurement, deployment, maintenance, and retirement. It exists where finance, security and operations meet.',
      'A mature ITAM programme answers four questions on demand: what do we own, where is it, who has it, and what did it cost? Without ITAM, finance over-renews software, security cannot prove asset coverage, and IT cannot ship a new hire on day one.',
      'AssetMon is built as a modern ITAM platform: per-tenant database, every event audit-logged, custom fields per category, depreciation built-in.',
    ],
    related: ['cmdb', 'sam', 'ham', 'mttr'],
    tags: ['ITAM', 'IT asset management', 'asset tracking'],
  },
  {
    slug: 'cmdb',
    term: 'Configuration Management Database (CMDB)',
    short: 'A database of configuration items (CIs) and their relationships, typically used to support ITSM.',
    body: [
      'A CMDB extends an asset inventory with relationship modelling: which service runs on which server, which user is in which department, which laptop runs which OS build.',
      'CMDB and ITAM overlap but have different goals. ITAM cares about ownership and lifecycle; CMDB cares about service impact and change management.',
      'In practice, smaller organisations start with ITAM and add CMDB-style relationships (location → asset → user → license) as their footprint grows.',
    ],
    related: ['itam', 'change-management', 'service-ticket'],
    tags: ['CMDB', 'ITSM', 'configuration management'],
  },
  {
    slug: 'sam',
    term: 'Software Asset Management (SAM)',
    short: 'The practice of tracking software entitlements vs. deployments to stay compliant and avoid over-spend.',
    body: [
      'SAM is the cousin of HAM (Hardware Asset Management). It tracks licenses owned (entitlements) against licenses deployed (consumption), and flags discrepancies before vendors do.',
      'Vendor audits are the single biggest financial risk of poor SAM. The mid-market audit settlement averages well over USD 200K.',
      'AssetMon\'s license module tracks seats used vs. owned in real time and flags over-deployment automatically.',
    ],
    related: ['ham', 'license-compliance', 'true-up'],
    tags: ['SAM', 'software asset management', 'license compliance'],
  },
  {
    slug: 'ham',
    term: 'Hardware Asset Management (HAM)',
    short: 'The practice of tracking physical IT hardware — laptops, monitors, phones, servers — through its lifecycle.',
    body: [
      'HAM is the tangible side of ITAM: serial numbers, asset tags, locations, custodians, conditions.',
      'A robust HAM programme has three pillars: a tag on every unit, a system of record for who has what, and a quarterly physical audit to keep records honest.',
    ],
    related: ['itam', 'sam', 'asset-tag', 'physical-audit'],
    tags: ['HAM', 'hardware asset management'],
  },
  {
    slug: 'asset-tag',
    term: 'Asset tag',
    short: 'A unique identifier (often a QR or barcode label) attached to a physical asset for scanning and lookup.',
    body: [
      'Asset tags transform a piece of hardware into a scannable record. Modern teams favour QR codes — they scan from any phone, encode useful payloads, and tolerate partial damage.',
      'Tag every asset on day one. Tagged assets get treated as company property; untagged hardware tends to disappear.',
    ],
    related: ['qr-code', 'barcode', 'rfid'],
    tags: ['asset tag', 'asset label', 'QR code'],
  },
  {
    slug: 'qr-code',
    term: 'QR code',
    short: 'A two-dimensional barcode that encodes arbitrary text and scans from any modern phone camera.',
    body: [
      'QR codes have become the default asset tag for SaaS-era ITAM. They encode meaningful payloads (asset tag, URL, even a small JSON), scan from any phone, and degrade gracefully thanks to built-in error correction.',
      'AssetMon generates QR labels per asset with a tenant-scoped payload — scanning takes you straight to the asset detail page.',
    ],
    related: ['barcode', 'rfid', 'asset-tag'],
    tags: ['QR code', 'asset tag'],
  },
  {
    slug: 'barcode',
    term: 'Barcode',
    short: 'A one-dimensional encoding of a serial number, read by a laser scanner or phone camera.',
    body: [
      'Linear barcodes are the workhorse of warehousing. They require line of sight and a dedicated scanner for best speeds, but they are cheap and reliable.',
      'For mixed-use environments most teams favour QR codes — they scan from any smartphone — but plain barcodes still earn their keep on consumables.',
    ],
    related: ['qr-code', 'asset-tag'],
    tags: ['barcode', 'asset tag'],
  },
  {
    slug: 'rfid',
    term: 'RFID',
    short: 'Radio-frequency identification — read multiple tagged items at distance, no line of sight required.',
    body: [
      'RFID excels where you need to scan dozens of items per second from several metres away — warehouses, tool cribs, theatre props.',
      'For typical office ITAM, RFID is usually overkill: per-tag and reader costs run 10-50× the price of a QR sticker.',
    ],
    related: ['qr-code', 'barcode'],
    tags: ['RFID', 'asset tracking'],
  },
  {
    slug: 'depreciation',
    term: 'Depreciation',
    short: 'Allocating an asset\'s cost across its useful life on the balance sheet.',
    body: [
      'Two methods dominate practice: straight-line (equal expense each period) and declining balance (front-loaded). Straight-line is simpler and beloved by tax authorities; declining balance better reflects how laptops actually lose value.',
      'AssetMon ships both methods, computes current book value live, and produces a fleet-wide CSV your finance team can hand straight to the auditor.',
    ],
    related: ['straight-line', 'declining-balance', 'book-value'],
    tags: ['asset depreciation', 'book value'],
  },
  {
    slug: 'straight-line',
    term: 'Straight-line depreciation',
    short: 'Equal-expense depreciation: (cost − salvage) / useful life, per period.',
    body: [
      'Straight-line is the most common method for office hardware. It is predictable, easy for non-accountants to follow, and accepted by every major jurisdiction.',
      'Example: a $3,000 laptop with a $300 salvage value and 36-month life expenses $75 per month.',
    ],
    related: ['depreciation', 'declining-balance'],
    tags: ['straight-line depreciation', 'depreciation method'],
  },
  {
    slug: 'declining-balance',
    term: 'Declining-balance depreciation',
    short: 'Front-loaded depreciation that matches how technology assets actually lose value.',
    body: [
      'Declining-balance — usually "double-declining" — applies a constant rate to the remaining book value each period. A new laptop loses value fast in year one and slowly thereafter; declining-balance mirrors that.',
      'Some tax regimes restrict declining balance to specific asset classes. Always check before swapping methods.',
    ],
    related: ['depreciation', 'straight-line'],
    tags: ['declining balance', 'depreciation method'],
  },
  {
    slug: 'book-value',
    term: 'Book value',
    short: 'Acquisition cost minus accumulated depreciation: what an asset is worth on the balance sheet today.',
    body: [
      'Book value is not market value. It is an accounting construct that helps finance reason about asset lifecycle costs without referencing a daily price.',
      'AssetMon shows live book value on every depreciating asset, and aggregates a fleet-wide net book value on the depreciation report.',
    ],
    related: ['depreciation'],
    tags: ['book value', 'depreciation'],
  },
  {
    slug: 'mttr',
    term: 'MTTR (Mean Time To Repair)',
    short: 'The average time between a ticket being opened and resolved.',
    body: [
      'MTTR is the most-watched KPI in service operations. It captures the user experience of downtime in a single number.',
      'AssetMon\'s service-tickets module emits MTTR through the audit log; pair it with priority routing and SLAs to keep the number trending down.',
    ],
    related: ['service-ticket', 'sla'],
    tags: ['MTTR', 'service desk metric'],
  },
  {
    slug: 'tco',
    term: 'TCO (Total Cost of Ownership)',
    short: 'The full cost of an asset over its life — including purchase, maintenance, energy, training and disposal.',
    body: [
      'Hardware purchase price is usually 40-60% of TCO. The rest is maintenance, software, energy, training and end-of-life processing.',
      'TCO analysis is the antidote to "we got it cheaper on Amazon" purchasing decisions.',
    ],
    related: ['depreciation', 'maintenance'],
    tags: ['TCO', 'total cost of ownership'],
  },
  {
    slug: 'license-compliance',
    term: 'License compliance',
    short: 'Operating within the seat counts and terms of every software license you have purchased.',
    body: [
      'Compliance has two failure modes: over-deployment (more users than seats) and contract drift (using a feature your contract does not include).',
      'A monthly reconciliation of seats deployed vs. seats owned is the single highest-leverage SAM control.',
    ],
    related: ['sam', 'true-up'],
    tags: ['license compliance', 'SAM'],
  },
  {
    slug: 'true-up',
    term: 'True-up',
    short: 'A vendor adjustment for past over-deployment — usually expensive.',
    body: [
      'A true-up is what happens when a vendor audit finds you have been deploying more seats than you bought. The bill covers the gap, often with penalty interest.',
      'The good news: clean SAM records eliminate the risk entirely. If you can prove seat counts every month, you never face a surprise true-up.',
    ],
    related: ['sam', 'license-compliance'],
    tags: ['true-up', 'vendor audit'],
  },
  {
    slug: 'preventive-maintenance',
    term: 'Preventive maintenance',
    short: 'Scheduled maintenance to prevent breakdowns, as opposed to reactive repair after the fact.',
    body: [
      'PM is the difference between a fleet that ages gracefully and one that fails at the worst possible moment.',
      'For laptops, sensible PM intervals are: battery health every six months, fan/vent clean annually, full OS reimage every two years.',
    ],
    related: ['service-ticket', 'mttr'],
    tags: ['preventive maintenance', 'reliability'],
  },
  {
    slug: 'service-ticket',
    term: 'Service ticket',
    short: 'A workflow object representing one unit of repair or support work, with status, owner and resolution.',
    body: [
      'Tickets give support work shape. State machines (OPEN → IN_PROGRESS → RESOLVED → CLOSED), priorities, owners and SLAs make sure nothing slips.',
      'AssetMon\'s tickets are tied to assets — opening one auto-flips the asset to IN_REPAIR, and resolving the last open ticket flips it back to IN_STOCK.',
    ],
    related: ['mttr', 'sla'],
    tags: ['service ticket', 'help desk'],
  },
  {
    slug: 'physical-audit',
    term: 'Physical audit',
    short: 'A periodic walk-the-floor count that reconciles your records with reality.',
    body: [
      'No matter how disciplined the data entry, records drift from reality. A quarterly physical audit catches it.',
      'Modern audits use phone-based scan-to-audit: walk the floor, scan tags, see live discrepancies. AssetMon ships this as a module.',
    ],
    related: ['asset-tag', 'qr-code'],
    tags: ['physical audit', 'inventory audit'],
  },
  {
    slug: 'multi-tenant',
    term: 'Multi-tenant SaaS',
    short: 'A software architecture pattern where one deployment serves many customers, each with isolated data.',
    body: [
      'Two camps: shared schema with a tenant_id column (cheap, risky) or database-per-tenant (physically isolated, slightly costlier to operate).',
      'AssetMon picked database-per-tenant from day one. Cross-tenant data leakage is not a "we promise" control — it is physically impossible.',
    ],
    related: ['itam', 'cmdb'],
    tags: ['multi-tenant', 'SaaS architecture'],
  },
];

export function getGlossaryEntry(slug: string) {
  return GLOSSARY.find((g) => g.slug === slug);
}
