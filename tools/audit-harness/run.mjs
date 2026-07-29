#!/usr/bin/env node
// AssetMon audit harness.
//
//   node tools/audit-harness/run.mjs            # summary + failures only
//   node tools/audit-harness/run.mjs --verbose  # every check
//   node tools/audit-harness/run.mjs --json out.json
//
// Exits non-zero if any check fails, so it can gate an upgrade.

import { writeFileSync } from 'node:fs';
import { Report } from './lib/report.mjs';
import { loginAll, API, WORKSPACE, GET } from './lib/client.mjs';

import * as auth from './suites/auth.mjs';
import * as rbac from './suites/rbac.mjs';
import * as writes from './suites/writes.mjs';
import * as lifecycle from './suites/lifecycle.mjs';
import * as flows from './suites/flows.mjs';
import * as employee from './suites/employee.mjs';
import * as platform from './suites/platform.mjs';

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose') || argv.includes('-v');
const jsonAt = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;

const report = new Report();

// Records created during the run, so cleanup can find them again.
const state = { assets: [], requests: [], tickets: [], reservations: [] };

console.log(`AssetMon audit harness`);
console.log(`  api       ${API}`);
console.log(`  workspace ${WORKSPACE}`);

const health = await GET('/health');
if (health.status === 0) {
  console.error(`\nCannot reach the API at ${API}.`);
  console.error(`Bring the stack up first:  wsl.exe --cd <root> -- bash check-stack.sh`);
  process.exit(2);
}

let tokens;
try {
  tokens = await loginAll();
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(2);
}

// The chain must be intact BEFORE the run, or an "intact" result afterwards
// proves nothing. A pre-existing break is a finding in its own right.
const scannedBefore = await lifecycle.verifyChain(report, tokens, 'before the run');

await auth.run(report, tokens);
await rbac.run(report, tokens);
await writes.run(report, tokens);
await lifecycle.run(report, tokens, state);
await flows.run(report, tokens, state);
await employee.run(report, tokens);
await platform.run(report, tokens);

await flows.cleanup(report, tokens, state);

// Runs last: the lifecycle suite deletes an asset that had history, which is
// precisely the operation that used to break the chain.
const scannedAfter = await lifecycle.verifyChain(report, tokens, 'after deleting an asset with history');
report.suite('Audit chain — growth');
report.ok(
  'the run appended new audit entries',
  scannedAfter > scannedBefore,
  `scanned ${scannedBefore} before, ${scannedAfter} after`,
);

const counts = report.print({ verbose });

if (jsonAt) {
  writeFileSync(jsonAt, JSON.stringify(report.toJSON(), null, 2));
  console.log(`\nwrote ${jsonAt}`);
}

process.exit(counts.FAIL > 0 ? 1 : 0);
