// Result collection and reporting.
//
// A check is PASS, FAIL, or SKIP. SKIP exists so a suite that cannot run (no
// seed data, platform portal unreachable) is visible rather than silently
// absent — a harness that quietly stops checking things is worse than no
// harness, because the pass count still looks healthy.

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', RESET = '\x1b[0m';

export class Report {
  constructor() {
    this.rows = [];
    this.currentSuite = '(none)';
  }

  suite(name) {
    this.currentSuite = name;
    return this;
  }

  add(name, status, detail = '') {
    this.rows.push({ suite: this.currentSuite, name, status, detail });
    return status === 'PASS';
  }

  pass(name, detail) { return this.add(name, 'PASS', detail); }
  fail(name, detail) { return this.add(name, 'FAIL', detail); }
  skip(name, detail) { return this.add(name, 'SKIP', detail); }

  /** Assert a response status is one of `allowed`. */
  status(name, res, allowed, extra = '') {
    const list = Array.isArray(allowed) ? allowed : [allowed];
    if (list.includes(res.status)) return this.pass(name, `${res.status}${extra ? ' ' + extra : ''}`);
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    return this.fail(name, `expected ${list.join('|')}, got ${res.status} — ${String(body).slice(0, 160)}`);
  }

  /** Assert an arbitrary condition. */
  ok(name, condition, detail = '') {
    return condition ? this.pass(name, detail) : this.fail(name, detail || 'condition was false');
  }

  eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    return a === e ? this.pass(name, a) : this.fail(name, `expected ${e}, got ${a}`);
  }

  get counts() {
    const c = { PASS: 0, FAIL: 0, SKIP: 0 };
    for (const r of this.rows) c[r.status]++;
    return c;
  }

  print({ verbose = false } = {}) {
    let suite = null;
    for (const r of this.rows) {
      if (r.suite !== suite) {
        suite = r.suite;
        console.log(`\n${DIM}── ${suite} ${'─'.repeat(Math.max(0, 58 - suite.length))}${RESET}`);
      }
      if (r.status === 'PASS' && !verbose) continue;
      const mark = r.status === 'PASS' ? `${GREEN}pass${RESET}`
        : r.status === 'FAIL' ? `${RED}FAIL${RESET}`
        : `${YELLOW}skip${RESET}`;
      console.log(`  ${mark}  ${r.name}${r.detail ? `\n        ${DIM}${r.detail}${RESET}` : ''}`);
    }

    const c = this.counts;
    const total = this.rows.length;
    console.log(`\n${'═'.repeat(62)}`);
    console.log(
      `  ${c.PASS}/${total} passed` +
      (c.FAIL ? `   ${RED}${c.FAIL} failed${RESET}` : '') +
      (c.SKIP ? `   ${YELLOW}${c.SKIP} skipped${RESET}` : ''),
    );
    console.log(`${'═'.repeat(62)}`);

    if (c.FAIL) {
      console.log(`\n${RED}Failures:${RESET}`);
      for (const r of this.rows.filter((x) => x.status === 'FAIL')) {
        console.log(`  ${r.suite} › ${r.name}\n      ${r.detail}`);
      }
    }
    return c;
  }

  toJSON() {
    return { counts: this.counts, total: this.rows.length, rows: this.rows };
  }
}
