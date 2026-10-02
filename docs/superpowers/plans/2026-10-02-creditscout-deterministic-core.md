# CreditScout Deterministic Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove the code layer that CreditScout's agent is never allowed to do itself — the database schema, the DSCR calculator, the guardrail, and the policy engine — plus the synthetic documents the whole system is tested against.

**Architecture:** Four independent pure-JavaScript units plus one SQL migration. Nothing here calls a model, touches n8n, or needs a network except the schema migration. `calc/dscr.js` and `guardrails/*.js` are written as zero-dependency single files because their source is pasted verbatim into n8n Code nodes later, and §8.3 of the spec requires the n8n copy to be byte-identical to the repo copy. Tests run on Node's built-in runner — no test framework dependency.

**Tech Stack:** Node 24 (built-in `node --test`), plain ES modules with a CommonJS export guard for n8n compatibility, Supabase Postgres 17 + pgvector 0.8.2.

**Spec:** `docs/superpowers/specs/2026-10-01-creditscout-design.md`

## Scope note — this is plan 1 of 3

This plan covers the parts that can be fully proven offline. Two further plans follow:

- **Plan 2 — n8n workflows** (§4.1, §4.2, §4.4): ingest, investigate, review. Depends on Task 1 (schema) and Task 2 (calculator source) here.
- **Plan 3 — UI and eval harness** (§7, §8): analyst screens and the eval runner. Depends on plans 1 and 2.

Each plan produces working, testable software on its own. This one ends with `npm test` green and six facilities' documents on disk.

## Global Constraints

- Node `>=20` (`package.json` `engines`). Development machine runs Node 24.8.0.
- `calc/dscr.js`, `guardrails/guardrail.js`, `guardrails/policy.js`, `guardrails/casefile-schema.js`: **zero dependencies, no `import`, no `require`**. Their full text is pasted into n8n Code nodes. Each ends with a guarded CommonJS export so Node can load it and n8n ignores it.
- No test framework. Use `node:test` and `node:assert/strict` only.
- All money values are dollars as JavaScript numbers. Normalise to integer cents before arithmetic.
- `dscr` is rounded **half-up to 2 decimal places**. Half-up, not banker's rounding.
- The calculator **never defaults a missing value to zero** and never infers. Missing input, denominator ≤ 0, and unknown component names all return `{error}`.
- `calc_id` is injected by the caller, never generated inside the pure function, so tests are deterministic.
- Supabase project ref: `rngsejqplndmygrozasc`. `vector` extension lives in schema `extensions` and is already enabled.
- Synthetic documents must carry the literal marker `SYNTHETIC — FOR DEMONSTRATION`. Borrower names are fictional.
- Expected DSCR values are **computed by the owner in a spreadsheet**, not by this code and not by Claude. Task 6 produces the input template only.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).

## Review Focus

Five input classes the spec implies but does not pin down. Each has a test attached to the task that owns the code.

1. **Negative or zero EBITDA** (Task 2) — a struggling borrower can have negative earnings, making the numerator negative and DSCR negative. Only a denominator ≤ 0 is an error; a negative DSCR is a legitimate failing result and must be returned, not rejected.
2. **An add-back named in `terms` with no matching figure in `financials.addback_amounts`** (Task 2) — must be a missing-input error. Silently treating it as zero would understate the numerator and produce a false breach.
3. **An add-back with no `cap` field, or `cap: null`** (Task 2) — means uncapped. Treating absent as zero would wipe out the add-back and, on facility F1, turn a correct resolve into a false escalation.
4. **A number in the explanation that comes from a cited quote rather than a calculation** (Task 4) — e.g. "the covenant requires 1.25x". The spec allows verbatim-quoted figures. A guardrail that only accepts calculated numbers would abstain on every well-formed explanation, making the zero-false-resolve metric look perfect while the product is useless.
5. **The same figure written in different formats** (Task 4) — `1,250,000` vs `1250000`, `1.25` vs `1.25x`, `$4.25m`. Naive string matching would false-abstain. Numbers must be compared after normalisation, not as text.

---

### Task 1: Database schema

**Files:**
- Create: `supabase/migrations/20261002120000_creditscout_schema.sql`
- Create: `scripts/verify-schema.mjs`
- Test: `scripts/verify-schema.mjs` is itself the check (it exits non-zero on failure)

**Interfaces:**
- Consumes: nothing.
- Produces: the nine tables of §5 — `facilities`, `documents`, `doc_chunks`, `exceptions`, `casefiles`, `calc_log`, `reviews`, `policy`, `eval_runs`. Later tasks and plans read and write these. `doc_chunks.embedding` is `vector(1536)` because `text-embedding-3-small` returns 1536 dimensions (verified against the live Azure deployment).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261002120000_creditscout_schema.sql`:

```sql
-- CreditScout schema (spec §5). vector extension already enabled in `extensions`.

create table if not exists facilities (
  id             uuid primary key default gen_random_uuid(),
  borrower_name  text not null,
  industry       text,
  sender_domain  text,
  created_at     timestamptz not null default now()
);

create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references facilities(id) on delete cascade,
  doc_type       text not null check (doc_type in
                   ('agreement','amendment','waiver','compliance_certificate','financials')),
  title          text not null,
  effective_date date,
  source         text not null default 'upload' check (source in ('upload','email')),
  created_at     timestamptz not null default now()
);

create table if not exists doc_chunks (
  id          bigserial primary key,
  content     text not null,
  embedding   extensions.vector(1536),
  metadata    jsonb not null default '{}'::jsonb
);

create table if not exists exceptions (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references facilities(id) on delete cascade,
  test_period_end date,
  reported_dscr   numeric(10,4),
  required_dscr   numeric(10,4),
  status          text not null default 'new' check (status in
                    ('new','investigating','pending_review','closed','needs_filing')),
  created_at      timestamptz not null default now()
);

create table if not exists casefiles (
  id                uuid primary key default gen_random_uuid(),
  exception_id      uuid not null references exceptions(id) on delete cascade,
  status            text not null default 'investigating' check (status in
                      ('investigating','pending_review','approved','overridden','awaiting_docs','failed')),
  trace             jsonb not null default '[]'::jsonb,
  terms             jsonb,
  recommendation    text check (recommendation in ('resolve','request','escalate','abstain')),
  explanation       text,
  claims            jsonb not null default '[]'::jsonb,
  calc_ids          uuid[] not null default '{}',
  missing_evidence  jsonb not null default '[]'::jsonb,
  suggested_tag     text check (suggested_tag in
                      ('amendment_addback','period_mismatch','missing_waiver',
                       'borrower_calc_error','true_breach','other')),
  guardrail_notes   jsonb not null default '[]'::jsonb,
  steps_count       integer not null default 0,
  summary           text,
  summary_embedding extensions.vector(1536),
  run_id            text,
  error_message     text,
  created_at        timestamptz not null default now()
);

create table if not exists calc_log (
  calc_id            uuid primary key,
  casefile_id        uuid references casefiles(id) on delete cascade,
  inputs             jsonb not null,
  outputs            jsonb not null,
  calculator_version text not null,
  created_at         timestamptz not null default now()
);

create table if not exists reviews (
  id               uuid primary key default gen_random_uuid(),
  casefile_id      uuid not null references casefiles(id) on delete cascade,
  decision         text not null check (decision in ('approve','override','request_docs')),
  reason           text,
  corrected_outcome text check (corrected_outcome in ('resolve','request','escalate','abstain')),
  pattern_tag      text check (pattern_tag in
                     ('amendment_addback','period_mismatch','missing_waiver',
                      'borrower_calc_error','true_breach','other')),
  lesson_text      text,
  lesson_embedding extensions.vector(1536),
  created_at       timestamptz not null default now()
);

create table if not exists policy (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists eval_runs (
  id         uuid primary key default gen_random_uuid(),
  mode       text not null check (mode in ('cold','warm')),
  metrics    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Lookup indexes
create index if not exists documents_facility_idx   on documents(facility_id);
create index if not exists exceptions_facility_idx  on exceptions(facility_id);
create index if not exists exceptions_status_idx    on exceptions(status);
create index if not exists casefiles_exception_idx  on casefiles(exception_id);
create index if not exists casefiles_status_idx     on casefiles(status);
create index if not exists casefiles_run_idx        on casefiles(run_id);
create index if not exists calc_log_casefile_idx    on calc_log(casefile_id);
create index if not exists reviews_casefile_idx     on reviews(casefile_id);
create index if not exists doc_chunks_metadata_idx  on doc_chunks using gin (metadata);

-- Vector indexes. Cosine distance, matching the Supabase Vector Store node default.
create index if not exists doc_chunks_embedding_idx
  on doc_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists casefiles_summary_embedding_idx
  on casefiles using hnsw (summary_embedding extensions.vector_cosine_ops);
create index if not exists reviews_lesson_embedding_idx
  on reviews using hnsw (lesson_embedding extensions.vector_cosine_ops);

-- Policy defaults (spec §6.2). max_steps is 8.
insert into policy (key, value) values
  ('variance_tolerance',              '0.05'::jsonb),
  ('escalate_if_breach_margin_over',  '0.15'::jsonb),
  ('prohibited_actions',              '["waive covenant","amend terms","contact borrower"]'::jsonb),
  ('max_steps',                       '8'::jsonb),
  ('require_human_review',            'true'::jsonb)
on conflict (key) do nothing;
```

- [ ] **Step 2: Write the schema verification script**

Create `scripts/verify-schema.mjs`:

```javascript
// Verifies the deployed schema matches what later tasks rely on.
// Usage: node scripts/verify-schema.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error('FAIL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env');
  process.exit(1);
}

const EXPECTED = [
  'facilities', 'documents', 'doc_chunks', 'exceptions', 'casefiles',
  'calc_log', 'reviews', 'policy', 'eval_runs',
];

let failed = 0;
for (const table of EXPECTED) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=*&limit=0`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (res.ok) {
    console.log(`  PASS  ${table}`);
  } else {
    console.log(`  FAIL  ${table} (HTTP ${res.status})`);
    failed++;
  }
}

// Policy defaults must be seeded, and max_steps must be 8 per spec §6.2.
const pol = await fetch(`${URL_BASE}/rest/v1/policy?select=key,value`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
const rows = pol.ok ? await pol.json() : [];
const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
for (const key of ['variance_tolerance', 'escalate_if_breach_margin_over',
                   'prohibited_actions', 'max_steps', 'require_human_review']) {
  if (key in byKey) console.log(`  PASS  policy.${key} = ${JSON.stringify(byKey[key])}`);
  else { console.log(`  FAIL  policy.${key} missing`); failed++; }
}
if (byKey.max_steps !== 8) {
  console.log(`  FAIL  policy.max_steps should be 8, got ${JSON.stringify(byKey.max_steps)}`);
  failed++;
}

console.log(failed === 0 ? '\nSchema OK' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 3: Run verification to confirm it fails before the migration is applied**

Run: `node scripts/verify-schema.mjs`
Expected: FAIL lines for all nine tables (HTTP 404), exit code 1. This proves the script detects a missing schema rather than passing vacuously.

- [ ] **Step 4: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool with name `creditscout_schema` and the SQL from Step 1, or:

Run: `supabase db push`
Expected: migration applied without error.

- [ ] **Step 5: Run verification to confirm it passes**

Run: `node scripts/verify-schema.mjs`
Expected: 14 PASS lines, `Schema OK`, exit code 0.

- [ ] **Step 6: Add the script to package.json**

Modify `package.json` — add to `scripts`:

```json
"verify:schema": "node scripts/verify-schema.mjs"
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261002120000_creditscout_schema.sql scripts/verify-schema.mjs package.json
git commit -m "feat: add CreditScout database schema and verification script"
```

---

### Task 2: DSCR calculator

**Files:**
- Create: `calc/dscr.js`
- Test: `calc/dscr.test.js`

**Interfaces:**
- Consumes: nothing. Pure function, zero dependencies.
- Produces:
  - `computeDscr(terms, financials, options)` → on success `{ calc_id, components, dscr, threshold, pass, margin, calculator_version }`; on failure `{ error, calculator_version }`.
  - `terms` and `financials` shapes are exactly §4.2 of the spec.
  - `options` is `{ calcId }` — **required**; the pure function never generates an id.
  - `components` is `{ base, addbacks: [{name, reported, cap, applied}], deductions: [{name, amount}], numerator, denominator, denominator_components: [{name, amount}] }`.
  - `CALCULATOR_VERSION` string constant, currently `"1.0.0"`.
  - Plan 2 wraps this in an n8n Code node that generates `calc_id` and writes `calc_log`.

- [ ] **Step 1: Write the failing tests**

Create `calc/dscr.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDscr, CALCULATOR_VERSION } from './dscr.js';

const CALC_ID = '11111111-1111-4111-8111-111111111111';
const opts = { calcId: CALC_ID };

/** Facility F1 shape: EBITDA + capped restructuring add-back, two deductions. */
function f1Terms() {
  return {
    test_period: { basis: 'TTM', period_end: '2026-06-30' },
    threshold: { min_dscr: 1.25, citation: 'CA §7.11' },
    numerator: {
      base: 'Consolidated EBITDA',
      addbacks: [
        { name: 'restructuring charges', amount_source: 'financials', cap: 500000, citation: 'Amd 2 §3(a)' },
      ],
      deductions: ['unfinanced_capex', 'cash_taxes'],
    },
    denominator: { components: ['scheduled_principal', 'cash_interest'], citation: 'CA §1.01' },
    effective_amendments: [{ doc: 'Amendment No. 2', effective: '2026-04-01', citation: 'Amd 2 §1' }],
  };
}

function f1Financials() {
  return {
    ebitda: 4250000,
    addback_amounts: { 'restructuring charges': 400000 },
    unfinanced_capex: 300000,
    cash_taxes: 250000,
    scheduled_principal: 2000000,
    cash_interest: 1100000,
  };
}

test('computes DSCR from terms and financials', () => {
  // numerator = 4,250,000 + 400,000 - 300,000 - 250,000 = 4,100,000
  // denominator = 2,000,000 + 1,100,000 = 3,100,000
  // 4,100,000 / 3,100,000 = 1.32258... -> 1.32
  const r = computeDscr(f1Terms(), f1Financials(), opts);
  assert.equal(r.error, undefined);
  assert.equal(r.dscr, 1.32);
  assert.equal(r.components.numerator, 4100000);
  assert.equal(r.components.denominator, 3100000);
});

test('returns calc_id, threshold, pass and margin', () => {
  const r = computeDscr(f1Terms(), f1Financials(), opts);
  assert.equal(r.calc_id, CALC_ID);
  assert.equal(r.threshold, 1.25);
  assert.equal(r.pass, true);
  // margin = dscr - threshold, also rounded to 2dp
  assert.equal(r.margin, 0.07);
  assert.equal(r.calculator_version, CALCULATOR_VERSION);
});

test('pass is false and margin negative when below threshold', () => {
  const fin = { ...f1Financials(), ebitda: 3000000 };
  // numerator = 3,000,000 + 400,000 - 550,000 = 2,850,000; /3,100,000 = 0.919 -> 0.92
  const r = computeDscr(f1Terms(), fin, opts);
  assert.equal(r.dscr, 0.92);
  assert.equal(r.pass, false);
  assert.equal(r.margin, -0.33);
});

test('applies the add-back cap', () => {
  const fin = { ...f1Financials(), addback_amounts: { 'restructuring charges': 900000 } };
  // add-back capped at 500,000 -> numerator = 4,250,000 + 500,000 - 550,000 = 4,200,000
  const r = computeDscr(f1Terms(), fin, opts);
  assert.equal(r.components.numerator, 4200000);
  assert.equal(r.components.addbacks[0].reported, 900000);
  assert.equal(r.components.addbacks[0].applied, 500000);
});

test('treats an absent cap as uncapped', () => {
  // Review Focus 3: absent cap must not be read as cap 0.
  const terms = f1Terms();
  delete terms.numerator.addbacks[0].cap;
  const fin = { ...f1Financials(), addback_amounts: { 'restructuring charges': 900000 } };
  const r = computeDscr(terms, fin, opts);
  assert.equal(r.components.addbacks[0].applied, 900000);
  assert.equal(r.components.numerator, 4600000);
});

test('treats a null cap as uncapped', () => {
  const terms = f1Terms();
  terms.numerator.addbacks[0].cap = null;
  const fin = { ...f1Financials(), addback_amounts: { 'restructuring charges': 900000 } };
  const r = computeDscr(terms, fin, opts);
  assert.equal(r.components.addbacks[0].applied, 900000);
});

test('rounds half-up, not to even', () => {
  // numerator 1,005,000 / denominator 1,000,000 = 1.005 -> half-up -> 1.01
  const terms = {
    threshold: { min_dscr: 1.0 },
    numerator: { base: 'Consolidated EBITDA', addbacks: [], deductions: [] },
    denominator: { components: ['scheduled_principal'] },
  };
  const fin = { ebitda: 1005000, addback_amounts: {}, scheduled_principal: 1000000 };
  const r = computeDscr(terms, fin, opts);
  assert.equal(r.dscr, 1.01);
});

test('returns a negative DSCR when EBITDA is negative', () => {
  // Review Focus 1: a negative numerator is a real failing result, not an error.
  const terms = f1Terms();
  const fin = { ...f1Financials(), ebitda: -1000000, addback_amounts: { 'restructuring charges': 0 } };
  // numerator = -1,000,000 - 550,000 = -1,550,000; /3,100,000 = -0.5
  const r = computeDscr(terms, fin, opts);
  assert.equal(r.error, undefined);
  assert.equal(r.dscr, -0.5);
  assert.equal(r.pass, false);
});

test('errors when an add-back named in terms has no figure in financials', () => {
  // Review Focus 2: missing must not be read as zero.
  const fin = { ...f1Financials(), addback_amounts: {} };
  const r = computeDscr(f1Terms(), fin, opts);
  assert.match(r.error, /restructuring charges/);
  assert.equal(r.dscr, undefined);
});

test('errors when a required financial input is missing', () => {
  const fin = { ...f1Financials() };
  delete fin.cash_interest;
  const r = computeDscr(f1Terms(), fin, opts);
  assert.match(r.error, /cash_interest/);
});

test('errors when a required financial input is not a finite number', () => {
  const r = computeDscr(f1Terms(), { ...f1Financials(), cash_taxes: 'n/a' }, opts);
  assert.match(r.error, /cash_taxes/);
});

test('errors when the denominator is zero', () => {
  const fin = { ...f1Financials(), scheduled_principal: 0, cash_interest: 0 };
  const r = computeDscr(f1Terms(), fin, opts);
  assert.match(r.error, /denominator/i);
});

test('errors when the denominator is negative', () => {
  const fin = { ...f1Financials(), scheduled_principal: -4000000 };
  const r = computeDscr(f1Terms(), fin, opts);
  assert.match(r.error, /denominator/i);
});

test('errors on an unknown deduction name', () => {
  const terms = f1Terms();
  terms.numerator.deductions = ['unfinanced_capex', 'goodwill_vibes'];
  const r = computeDscr(terms, f1Financials(), opts);
  assert.match(r.error, /goodwill_vibes/);
});

test('errors on an unknown denominator component name', () => {
  const terms = f1Terms();
  terms.denominator.components = ['scheduled_principal', 'mystery_fees'];
  const r = computeDscr(terms, f1Financials(), opts);
  assert.match(r.error, /mystery_fees/);
});

test('errors when calcId is not supplied', () => {
  const r = computeDscr(f1Terms(), f1Financials(), {});
  assert.match(r.error, /calcId/);
});

test('does not mutate its inputs', () => {
  const terms = f1Terms();
  const fin = f1Financials();
  const termsCopy = JSON.parse(JSON.stringify(terms));
  const finCopy = JSON.parse(JSON.stringify(fin));
  computeDscr(terms, fin, opts);
  assert.deepEqual(terms, termsCopy);
  assert.deepEqual(fin, finCopy);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test calc/`
Expected: FAIL — `Cannot find module` for `./dscr.js`.

- [ ] **Step 3: Write the calculator**

Create `calc/dscr.js`:

```javascript
/**
 * CreditScout DSCR calculator — spec §4.2.
 *
 * Pure function. No I/O, no dependencies, no imports: the full text of this
 * file is pasted into an n8n Code node, and spec §8.3 requires that copy to be
 * byte-identical to this one. Do not add imports.
 *
 * The caller supplies calc_id so results are deterministic under test.
 */

const CALCULATOR_VERSION = '1.0.0';

/** Financial input names the calculator understands. */
const DEDUCTION_FIELDS = ['unfinanced_capex', 'cash_taxes'];
const DENOMINATOR_FIELDS = ['scheduled_principal', 'cash_interest'];

/**
 * Round half-up to `dp` places.
 *
 * Done via decimal-string shifting rather than `value * 100`, because binary
 * floating point puts 1.005 slightly below the true value and a naive
 * multiply would round it down to 1.00. toPrecision(15) first collapses the
 * float noise left by the division; Number('1.005e2') then parses to exactly
 * 100.5, and Math.round rounds halves away from zero for positive numbers.
 */
function roundHalfUp(value, dp) {
  if (!Number.isFinite(value)) return value;
  const collapsed = Number(Number(value).toPrecision(15));
  const shifted = Number(`${collapsed}e${dp}`);
  const rounded = value < 0 ? -Math.round(-shifted) : Math.round(shifted);
  return Number(`${rounded}e-${dp}`);
}

/** Dollars to integer cents, so sums are exact. */
function toCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function fail(message) {
  return { error: message, calculator_version: CALCULATOR_VERSION };
}

/**
 * @param {object} terms      §4.2 terms schema
 * @param {object} financials {ebitda, addback_amounts, unfinanced_capex, cash_taxes,
 *                             scheduled_principal, cash_interest}
 * @param {object} options    {calcId} — required
 */
function computeDscr(terms, financials, options) {
  const calcId = options && options.calcId;
  if (typeof calcId !== 'string' || calcId.length === 0) {
    return fail('calcId is required: the calculator does not generate ids');
  }
  if (!terms || typeof terms !== 'object') return fail('terms is missing');
  if (!financials || typeof financials !== 'object') return fail('financials is missing');

  const numeratorTerms = terms.numerator || {};
  const denominatorTerms = terms.denominator || {};
  const addbackTerms = Array.isArray(numeratorTerms.addbacks) ? numeratorTerms.addbacks : [];
  const deductionNames = Array.isArray(numeratorTerms.deductions) ? numeratorTerms.deductions : [];
  const denominatorNames = Array.isArray(denominatorTerms.components)
    ? denominatorTerms.components
    : [];

  if (denominatorNames.length === 0) {
    return fail('terms.denominator.components is empty: nothing to divide by');
  }

  // --- base earnings ---
  if (!isFiniteNumber(financials.ebitda)) {
    return fail('missing or non-numeric financial input: ebitda');
  }
  let numeratorCents = toCents(financials.ebitda);

  // --- add-backs, each capped if the terms impose a cap ---
  const addbackAmounts =
    financials.addback_amounts && typeof financials.addback_amounts === 'object'
      ? financials.addback_amounts
      : {};
  const addbackDetail = [];
  for (const addback of addbackTerms) {
    const name = addback && addback.name;
    if (typeof name !== 'string' || name.length === 0) {
      return fail('an add-back in terms has no name');
    }
    if (!Object.prototype.hasOwnProperty.call(addbackAmounts, name)) {
      return fail(`missing financial input for add-back: ${name}`);
    }
    const reported = addbackAmounts[name];
    if (!isFiniteNumber(reported)) {
      return fail(`missing or non-numeric financial input for add-back: ${name}`);
    }
    // An absent or null cap means uncapped. It must never be read as zero.
    const hasCap = isFiniteNumber(addback.cap);
    const appliedCents = hasCap
      ? Math.min(toCents(reported), toCents(addback.cap))
      : toCents(reported);
    numeratorCents += appliedCents;
    addbackDetail.push({
      name,
      reported,
      cap: hasCap ? addback.cap : null,
      applied: appliedCents / 100,
    });
  }

  // --- deductions ---
  const deductionDetail = [];
  for (const name of deductionNames) {
    if (DEDUCTION_FIELDS.indexOf(name) === -1) {
      return fail(`unknown deduction component: ${name}`);
    }
    if (!isFiniteNumber(financials[name])) {
      return fail(`missing or non-numeric financial input: ${name}`);
    }
    numeratorCents -= toCents(financials[name]);
    deductionDetail.push({ name, amount: financials[name] });
  }

  // --- denominator ---
  let denominatorCents = 0;
  const denominatorDetail = [];
  for (const name of denominatorNames) {
    if (DENOMINATOR_FIELDS.indexOf(name) === -1) {
      return fail(`unknown denominator component: ${name}`);
    }
    if (!isFiniteNumber(financials[name])) {
      return fail(`missing or non-numeric financial input: ${name}`);
    }
    denominatorCents += toCents(financials[name]);
    denominatorDetail.push({ name, amount: financials[name] });
  }

  if (denominatorCents <= 0) {
    return fail(`denominator must be greater than zero, got ${denominatorCents / 100}`);
  }

  // A negative numerator is a legitimate failing result, not an error.
  const dscr = roundHalfUp(numeratorCents / denominatorCents, 2);

  const thresholdRaw = terms.threshold && terms.threshold.min_dscr;
  const threshold = isFiniteNumber(thresholdRaw) ? thresholdRaw : null;
  const pass = threshold === null ? null : dscr >= threshold;
  const margin = threshold === null ? null : roundHalfUp(dscr - threshold, 2);

  return {
    calc_id: calcId,
    components: {
      base: financials.ebitda,
      addbacks: addbackDetail,
      deductions: deductionDetail,
      numerator: numeratorCents / 100,
      denominator: denominatorCents / 100,
      denominator_components: denominatorDetail,
    },
    dscr,
    threshold,
    pass,
    margin,
    calculator_version: CALCULATOR_VERSION,
  };
}

export { computeDscr, CALCULATOR_VERSION, roundHalfUp };

/* n8n Code node compatibility: harmless under ESM, used when pasted into n8n. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeDscr, CALCULATOR_VERSION, roundHalfUp };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test calc/`
Expected: all 17 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add calc/dscr.js calc/dscr.test.js
git commit -m "feat: add deterministic DSCR calculator with caps, deductions and error cases"
```

---

### Task 3: Casefile schema validator

**Files:**
- Create: `guardrails/casefile-schema.js`
- Test: `guardrails/casefile-schema.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `validateCasefileOutput(output)` → `{ valid: true, value }` or `{ valid: false, errors: string[] }`.
  - `RECOMMENDATIONS` = `['resolve','request','escalate','abstain']`.
  - `PATTERN_TAGS` = the six tags from §5.
  - Task 4 calls this as guardrail check 1.

- [ ] **Step 1: Write the failing tests**

Create `guardrails/casefile-schema.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCasefileOutput, RECOMMENDATIONS, PATTERN_TAGS } from './casefile-schema.js';

function valid() {
  return {
    recommendation: 'resolve',
    confidence_basis: 'Amendment No. 2 permits the add-back; recomputed DSCR passes.',
    explanation: 'Recomputed DSCR is 1.32 against a 1.25 threshold.',
    claims: [{ text: 'Threshold is 1.25x', citation: 'CA §7.11', quote: 'not less than 1.25 to 1.00' }],
    calculations: [{ calc_id: '11111111-1111-4111-8111-111111111111' }],
    missing_evidence: [],
    suggested_tag: 'amendment_addback',
  };
}

test('accepts a well-formed output', () => {
  const r = validateCasefileOutput(valid());
  assert.equal(r.valid, true);
  assert.equal(r.value.recommendation, 'resolve');
});

test('exposes the four recommendations and six tags from the spec', () => {
  assert.deepEqual(RECOMMENDATIONS, ['resolve', 'request', 'escalate', 'abstain']);
  assert.deepEqual(PATTERN_TAGS, [
    'amendment_addback', 'period_mismatch', 'missing_waiver',
    'borrower_calc_error', 'true_breach', 'other',
  ]);
});

test('rejects a non-object', () => {
  for (const bad of [null, undefined, 'resolve', 42, []]) {
    assert.equal(validateCasefileOutput(bad).valid, false);
  }
});

test('rejects an unknown recommendation', () => {
  const r = validateCasefileOutput({ ...valid(), recommendation: 'approve' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /recommendation/.test(e)));
});

test('rejects an unknown pattern tag', () => {
  const r = validateCasefileOutput({ ...valid(), suggested_tag: 'vibes' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /suggested_tag/.test(e)));
});

test('rejects an explanation longer than 150 words', () => {
  const r = validateCasefileOutput({ ...valid(), explanation: 'word '.repeat(151).trim() });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /150 words/.test(e)));
});

test('accepts an explanation of exactly 150 words', () => {
  const r = validateCasefileOutput({ ...valid(), explanation: 'word '.repeat(150).trim() });
  assert.equal(r.valid, true);
});

test('rejects a claim missing citation or quote', () => {
  const noQuote = validateCasefileOutput({
    ...valid(), claims: [{ text: 'x', citation: 'CA §7.11' }],
  });
  assert.equal(noQuote.valid, false);
  const noCitation = validateCasefileOutput({
    ...valid(), claims: [{ text: 'x', quote: 'y' }],
  });
  assert.equal(noCitation.valid, false);
});

test('rejects claims that is not an array', () => {
  assert.equal(validateCasefileOutput({ ...valid(), claims: 'none' }).valid, false);
});

test('rejects a calculation entry without calc_id', () => {
  const r = validateCasefileOutput({ ...valid(), calculations: [{ id: 'x' }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /calc_id/.test(e)));
});

test('collects every error rather than stopping at the first', () => {
  const r = validateCasefileOutput({ recommendation: 'nope', suggested_tag: 'nope' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.length >= 3);
});

test('accepts empty claims and calculations for an abstain', () => {
  const r = validateCasefileOutput({
    recommendation: 'abstain',
    confidence_basis: 'No waiver on file.',
    explanation: 'The certificate cites a waiver that is not in the document set.',
    claims: [],
    calculations: [],
    missing_evidence: ['waiver referenced on the certificate'],
    suggested_tag: 'missing_waiver',
  });
  assert.equal(r.valid, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test guardrails/`
Expected: FAIL — `Cannot find module` for `./casefile-schema.js`.

- [ ] **Step 3: Write the validator**

Create `guardrails/casefile-schema.js`:

```javascript
/**
 * Orchestrator output shape — spec §6.1.
 * Zero dependencies: pasted verbatim into an n8n Code node.
 */

const RECOMMENDATIONS = ['resolve', 'request', 'escalate', 'abstain'];
const PATTERN_TAGS = [
  'amendment_addback',
  'period_mismatch',
  'missing_waiver',
  'borrower_calc_error',
  'true_breach',
  'other',
];
const MAX_EXPLANATION_WORDS = 150;

function countWords(text) {
  const trimmed = String(text).trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Collects all problems rather than failing on the first. */
function validateCasefileOutput(output) {
  const errors = [];

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { valid: false, errors: ['output must be an object'] };
  }

  if (RECOMMENDATIONS.indexOf(output.recommendation) === -1) {
    errors.push(`recommendation must be one of ${RECOMMENDATIONS.join(', ')}`);
  }
  if (typeof output.confidence_basis !== 'string' || output.confidence_basis.trim() === '') {
    errors.push('confidence_basis must be a non-empty string');
  }
  if (typeof output.explanation !== 'string' || output.explanation.trim() === '') {
    errors.push('explanation must be a non-empty string');
  } else if (countWords(output.explanation) > MAX_EXPLANATION_WORDS) {
    errors.push(`explanation must be at most ${MAX_EXPLANATION_WORDS} words`);
  }

  if (!Array.isArray(output.claims)) {
    errors.push('claims must be an array');
  } else {
    output.claims.forEach((claim, i) => {
      if (!claim || typeof claim !== 'object') {
        errors.push(`claims[${i}] must be an object`);
        return;
      }
      if (typeof claim.text !== 'string' || claim.text.trim() === '') {
        errors.push(`claims[${i}].text must be a non-empty string`);
      }
      if (typeof claim.citation !== 'string' || claim.citation.trim() === '') {
        errors.push(`claims[${i}].citation must be a non-empty string`);
      }
      if (typeof claim.quote !== 'string' || claim.quote.trim() === '') {
        errors.push(`claims[${i}].quote must be a non-empty string`);
      }
    });
  }

  if (!Array.isArray(output.calculations)) {
    errors.push('calculations must be an array');
  } else {
    output.calculations.forEach((calc, i) => {
      if (!calc || typeof calc !== 'object' || typeof calc.calc_id !== 'string') {
        errors.push(`calculations[${i}].calc_id must be a string`);
      }
    });
  }

  if (!Array.isArray(output.missing_evidence)) {
    errors.push('missing_evidence must be an array');
  } else if (output.missing_evidence.some((m) => typeof m !== 'string')) {
    errors.push('missing_evidence entries must be strings');
  }

  if (PATTERN_TAGS.indexOf(output.suggested_tag) === -1) {
    errors.push(`suggested_tag must be one of ${PATTERN_TAGS.join(', ')}`);
  }

  return errors.length === 0 ? { valid: true, value: output } : { valid: false, errors };
}

export { validateCasefileOutput, RECOMMENDATIONS, PATTERN_TAGS, MAX_EXPLANATION_WORDS };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateCasefileOutput, RECOMMENDATIONS, PATTERN_TAGS, MAX_EXPLANATION_WORDS,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test guardrails/`
Expected: all 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add guardrails/casefile-schema.js guardrails/casefile-schema.test.js
git commit -m "feat: add casefile output schema validator"
```

---

### Task 4: Guardrail

**Files:**
- Create: `guardrails/guardrail.js`
- Test: `guardrails/guardrail.test.js`

**Interfaces:**
- Consumes: `validateCasefileOutput` from Task 3 (inlined by copy, not imported — see note below).
- Produces:
  - `applyGuardrail(output, context)` → `{ output, notes, forcedAbstain }` where `output` is the possibly-modified casefile fields and `notes` is an array of `{ check, action, detail }` destined for `casefiles.guardrail_notes`.
  - `context` is `{ calcLogs, chunks, stepsCount, maxSteps, isRetry }`:
    - `calcLogs`: array of calculator outputs produced during this casefile.
    - `chunks`: array of `{ citation, content }` — the cited document sections retrieved during this casefile.
    - `stepsCount`, `maxSteps`: numbers.
    - `isRetry`: boolean — true when this is the second attempt after a malformed output.
  - `extractNumbers(text)` and `numbersMatch(a, b)` exported for testing.

**Note on the Task 3 dependency:** `guardrail.js` must stay import-free for n8n. Copy the `validateCasefileOutput` function body into `guardrail.js` and add a test asserting the two copies agree on a shared fixture, so drift is caught. The n8n Code node for the guardrail will contain both files' text concatenated.

- [ ] **Step 1: Write the failing tests**

Create `guardrails/guardrail.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGuardrail, extractNumbers, numbersMatch } from './guardrail.js';
import { validateCasefileOutput } from './casefile-schema.js';

const CALC_ID = '11111111-1111-4111-8111-111111111111';

function passingCalc() {
  return {
    calc_id: CALC_ID,
    dscr: 1.32,
    threshold: 1.25,
    pass: true,
    margin: 0.07,
    components: { numerator: 4100000, denominator: 3100000 },
  };
}

function chunks() {
  return [
    { citation: 'CA §7.11', content: 'Borrower shall maintain a Debt Service Coverage Ratio of not less than 1.25 to 1.00.' },
    { citation: 'Amd 2 §3(a)', content: 'one-time restructuring charges not exceeding $500,000 may be added back' },
  ];
}

function resolveOutput() {
  return {
    recommendation: 'resolve',
    confidence_basis: 'Amendment No. 2 permits the add-back.',
    explanation: 'Recomputed DSCR is 1.32, above the 1.25 threshold.',
    claims: [
      { text: 'Threshold is 1.25', citation: 'CA §7.11', quote: 'not less than 1.25 to 1.00' },
      { text: 'Add-back permitted', citation: 'Amd 2 §3(a)', quote: 'one-time restructuring charges not exceeding $500,000 may be added back' },
    ],
    calculations: [{ calc_id: CALC_ID }],
    missing_evidence: [],
    suggested_tag: 'amendment_addback',
  };
}

function ctx(over) {
  return {
    calcLogs: [passingCalc()],
    chunks: chunks(),
    stepsCount: 6,
    maxSteps: 8,
    isRetry: false,
    ...over,
  };
}

test('passes a well-formed, fully grounded resolve unchanged', () => {
  const r = applyGuardrail(resolveOutput(), ctx());
  assert.equal(r.output.recommendation, 'resolve');
  assert.equal(r.forcedAbstain, false);
  assert.equal(r.notes.length, 0);
  assert.equal(r.output.claims.length, 2);
});

// --- check 1: schema ---

test('malformed output on the first attempt asks for a retry', () => {
  const r = applyGuardrail({ recommendation: 'nope' }, ctx());
  assert.equal(r.retry, true);
  assert.equal(r.forcedAbstain, false);
});

test('malformed output on the retry forces abstain with "malformed output"', () => {
  const r = applyGuardrail({ recommendation: 'nope' }, ctx({ isRetry: true }));
  assert.equal(r.output.recommendation, 'abstain');
  assert.equal(r.forcedAbstain, true);
  assert.ok(r.notes.some((n) => /malformed output/.test(n.detail)));
});

// --- check 2: every number traceable ---

test('forces abstain on a number that is neither calculated nor quoted', () => {
  const out = resolveOutput();
  out.explanation = 'Recomputed DSCR is 1.47, above the 1.25 threshold.';
  const r = applyGuardrail(out, ctx());
  assert.equal(r.output.recommendation, 'abstain');
  assert.ok(r.notes.some((n) => /unverified figure/.test(n.detail)));
  assert.ok(r.notes.some((n) => /1\.47/.test(n.detail)));
});

test('accepts a number that appears only in a cited quote', () => {
  // Review Focus 4: quoted figures are legitimate, not hallucinations.
  const out = resolveOutput();
  out.explanation = 'The covenant requires 1.25 and the add-back cap is $500,000.';
  const r = applyGuardrail(out, ctx());
  assert.equal(r.output.recommendation, 'resolve');
  assert.equal(r.forcedAbstain, false);
});

test('accepts calculator component figures, not just the ratio', () => {
  const out = resolveOutput();
  out.explanation = 'Numerator 4,100,000 over denominator 3,100,000 gives 1.32.';
  const r = applyGuardrail(out, ctx());
  assert.equal(r.output.recommendation, 'resolve');
});

test('matches numbers across formatting differences', () => {
  // Review Focus 5
  assert.equal(numbersMatch(1250000, 1250000), true);
  assert.deepEqual(extractNumbers('1,250,000 and 1.25x and $500,000'), [1250000, 1.25, 500000]);
  const out = resolveOutput();
  out.explanation = 'DSCR of 1.32x clears the 1.25 test.';
  assert.equal(applyGuardrail(out, ctx()).output.recommendation, 'resolve');
});

test('ignores section numbers in citations when scanning for figures', () => {
  const out = resolveOutput();
  out.explanation = 'Per CA §7.11 the threshold is 1.25 and the recomputed DSCR is 1.32.';
  const r = applyGuardrail(out, ctx());
  assert.equal(r.output.recommendation, 'resolve');
});

test('scans claim text for untraceable numbers too', () => {
  const out = resolveOutput();
  out.claims[0].text = 'Threshold is 9.99';
  const r = applyGuardrail(out, ctx());
  assert.equal(r.output.recommendation, 'abstain');
});

// --- check 3: quotes must appear verbatim ---

test('removes a claim whose quote is not in the cited chunk', () => {
  const out = resolveOutput();
  out.claims.push({
    text: 'Waiver granted', citation: 'CA §7.11', quote: 'the Lender hereby waives',
  });
  const r = applyGuardrail(out, ctx());
  assert.equal(r.output.claims.length, 2);
  assert.ok(r.notes.some((n) => n.action === 'claim_removed'));
});

test('abstains when removing a fake quote leaves a resolve unsupported', () => {
  const out = resolveOutput();
  out.claims = [{ text: 'Add-back permitted', citation: 'Amd 2 §3(a)', quote: 'totally invented text' }];
  const r = applyGuardrail(out, ctx());
  assert.equal(r.output.recommendation, 'abstain');
  assert.equal(r.output.claims.length, 0);
});

test('normalises whitespace when comparing a quote to its chunk', () => {
  const out = resolveOutput();
  out.claims[0].quote = 'not  less\nthan 1.25 to 1.00';
  const r = applyGuardrail(out, ctx());
  assert.equal(r.output.claims.length, 2);
});

test('removes a claim citing a document section that was never retrieved', () => {
  const out = resolveOutput();
  out.claims.push({ text: 'x', citation: 'CA §99.1', quote: 'anything' });
  const r = applyGuardrail(out, ctx());
  assert.ok(r.notes.some((n) => /CA §99\.1/.test(n.detail)));
  assert.equal(r.output.claims.length, 2);
});

// --- check 4: resolve needs a passing calc and cited terms ---

test('downgrades resolve to escalate when no calc passed', () => {
  const failing = { ...passingCalc(), pass: false, dscr: 1.12, margin: -0.13 };
  const out = resolveOutput();
  out.explanation = 'Recomputed DSCR is 1.12 against the 1.25 threshold.';
  const r = applyGuardrail(out, ctx({ calcLogs: [failing] }));
  assert.equal(r.output.recommendation, 'escalate');
  assert.ok(r.notes.some((n) => /passing calc/.test(n.detail)));
});

test('downgrades resolve to escalate when there are no calcs at all', () => {
  const out = resolveOutput();
  out.calculations = [];
  out.explanation = 'It looks fine to me.';
  const r = applyGuardrail(out, ctx({ calcLogs: [] }));
  assert.equal(r.output.recommendation, 'escalate');
});

test('does not require a passing calc for request, escalate or abstain', () => {
  for (const rec of ['request', 'escalate', 'abstain']) {
    const out = {
      recommendation: rec,
      confidence_basis: 'Certificate uses the wrong test period.',
      explanation: 'The certificate reports a period that does not match the facility.',
      claims: [],
      calculations: [],
      missing_evidence: ['corrected compliance certificate'],
      suggested_tag: 'period_mismatch',
    };
    const r = applyGuardrail(out, ctx({ calcLogs: [] }));
    assert.equal(r.output.recommendation, rec);
  }
});

// --- check 5: step cap ---

test('forces abstain when the step cap is reached', () => {
  const r = applyGuardrail(resolveOutput(), ctx({ stepsCount: 8, maxSteps: 8 }));
  assert.equal(r.output.recommendation, 'abstain');
  assert.ok(r.notes.some((n) => /investigation incomplete/.test(n.detail)));
});

test('does not fire the step cap below the limit', () => {
  const r = applyGuardrail(resolveOutput(), ctx({ stepsCount: 7, maxSteps: 8 }));
  assert.equal(r.output.recommendation, 'resolve');
});

// --- ordering and bookkeeping ---

test('records every forced change in notes', () => {
  const out = resolveOutput();
  out.explanation = 'Recomputed DSCR is 1.47.';
  const r = applyGuardrail(out, ctx());
  assert.ok(r.notes.length > 0);
  for (const n of r.notes) {
    assert.equal(typeof n.check, 'string');
    assert.equal(typeof n.action, 'string');
    assert.equal(typeof n.detail, 'string');
  }
});

test('does not mutate the output it was given', () => {
  const out = resolveOutput();
  const copy = JSON.parse(JSON.stringify(out));
  applyGuardrail(out, ctx({ stepsCount: 8, maxSteps: 8 }));
  assert.deepEqual(out, copy);
});

test('the inlined schema validator agrees with the Task 3 copy', () => {
  // Guards against drift between the two copies.
  const fixtures = [
    resolveOutput(),
    { recommendation: 'nope' },
    { ...resolveOutput(), suggested_tag: 'vibes' },
    { ...resolveOutput(), explanation: 'word '.repeat(151).trim() },
  ];
  for (const f of fixtures) {
    const viaGuardrail = applyGuardrail(f, ctx({ isRetry: true }));
    const viaSchema = validateCasefileOutput(f);
    const guardrailSaysMalformed = viaGuardrail.notes.some((n) => /malformed output/.test(n.detail));
    assert.equal(guardrailSaysMalformed, !viaSchema.valid,
      `disagreement on fixture: ${JSON.stringify(f).slice(0, 60)}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test guardrails/`
Expected: FAIL — `Cannot find module` for `./guardrail.js`. Task 3's tests still pass.

- [ ] **Step 3: Write the guardrail**

Create `guardrails/guardrail.js`:

```javascript
/**
 * Code guardrail — spec §6.1. Runs after the orchestrator, before policy.
 *
 * Checks run in the spec's order. Every forced change is recorded in `notes`,
 * which the UI surfaces. Zero dependencies and no imports: the text of this
 * file is pasted into an n8n Code node.
 *
 * `validateCasefileOutput` below is a copy of guardrails/casefile-schema.js.
 * guardrail.test.js asserts the two copies agree, so drift is caught.
 */

const RECOMMENDATIONS = ['resolve', 'request', 'escalate', 'abstain'];
const PATTERN_TAGS = [
  'amendment_addback', 'period_mismatch', 'missing_waiver',
  'borrower_calc_error', 'true_breach', 'other',
];
const MAX_EXPLANATION_WORDS = 150;

function countWords(text) {
  const trimmed = String(text).trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function validateCasefileOutput(output) {
  const errors = [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { valid: false, errors: ['output must be an object'] };
  }
  if (RECOMMENDATIONS.indexOf(output.recommendation) === -1) {
    errors.push(`recommendation must be one of ${RECOMMENDATIONS.join(', ')}`);
  }
  if (typeof output.confidence_basis !== 'string' || output.confidence_basis.trim() === '') {
    errors.push('confidence_basis must be a non-empty string');
  }
  if (typeof output.explanation !== 'string' || output.explanation.trim() === '') {
    errors.push('explanation must be a non-empty string');
  } else if (countWords(output.explanation) > MAX_EXPLANATION_WORDS) {
    errors.push(`explanation must be at most ${MAX_EXPLANATION_WORDS} words`);
  }
  if (!Array.isArray(output.claims)) {
    errors.push('claims must be an array');
  } else {
    output.claims.forEach((claim, i) => {
      if (!claim || typeof claim !== 'object') { errors.push(`claims[${i}] must be an object`); return; }
      if (typeof claim.text !== 'string' || claim.text.trim() === '') {
        errors.push(`claims[${i}].text must be a non-empty string`);
      }
      if (typeof claim.citation !== 'string' || claim.citation.trim() === '') {
        errors.push(`claims[${i}].citation must be a non-empty string`);
      }
      if (typeof claim.quote !== 'string' || claim.quote.trim() === '') {
        errors.push(`claims[${i}].quote must be a non-empty string`);
      }
    });
  }
  if (!Array.isArray(output.calculations)) {
    errors.push('calculations must be an array');
  } else {
    output.calculations.forEach((calc, i) => {
      if (!calc || typeof calc !== 'object' || typeof calc.calc_id !== 'string') {
        errors.push(`calculations[${i}].calc_id must be a string`);
      }
    });
  }
  if (!Array.isArray(output.missing_evidence)) {
    errors.push('missing_evidence must be an array');
  } else if (output.missing_evidence.some((m) => typeof m !== 'string')) {
    errors.push('missing_evidence entries must be strings');
  }
  if (PATTERN_TAGS.indexOf(output.suggested_tag) === -1) {
    errors.push(`suggested_tag must be one of ${PATTERN_TAGS.join(', ')}`);
  }
  return errors.length === 0 ? { valid: true, value: output } : { valid: false, errors };
}

/* ---------- number handling ---------- */

/**
 * Pull the numeric figures out of prose.
 *
 * Section references like `§7.11` and `CA §1.01` are stripped first: they are
 * citations, not claims about money, and treating them as figures would make
 * every well-cited explanation abstain.
 */
function extractNumbers(text) {
  const withoutSections = String(text).replace(/§\s*[\d.]+(\([a-z0-9]+\))?/gi, ' ');
  const matches = withoutSections.match(/-?\d[\d,]*(\.\d+)?/g) || [];
  const out = [];
  for (const raw of matches) {
    const n = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Equal after normalisation, with a tolerance for 2dp rounding. */
function numbersMatch(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  return Math.abs(a - b) < 0.005;
}

/** Every figure a calculator produced for this casefile. */
function calculatedNumbers(calcLogs) {
  const values = [];
  for (const log of calcLogs || []) {
    for (const key of ['dscr', 'threshold', 'margin']) {
      if (Number.isFinite(log[key])) values.push(log[key]);
    }
    const c = log.components || {};
    for (const key of ['base', 'numerator', 'denominator']) {
      if (Number.isFinite(c[key])) values.push(c[key]);
    }
    for (const a of c.addbacks || []) {
      for (const key of ['reported', 'cap', 'applied']) {
        if (Number.isFinite(a[key])) values.push(a[key]);
      }
    }
    for (const d of (c.deductions || []).concat(c.denominator_components || [])) {
      if (Number.isFinite(d.amount)) values.push(d.amount);
    }
  }
  return values;
}

/** Every figure appearing verbatim in a chunk the casefile cited. */
function quotedNumbers(chunks) {
  const values = [];
  for (const chunk of chunks || []) {
    for (const n of extractNumbers(chunk.content || '')) values.push(n);
  }
  return values;
}

function normaliseWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ---------- the guardrail ---------- */

function applyGuardrail(rawOutput, context) {
  const ctx = context || {};
  const notes = [];
  const note = (check, action, detail) => notes.push({ check, action, detail });

  // Check 1 — schema. One retry, then abstain.
  const validation = validateCasefileOutput(rawOutput);
  if (!validation.valid) {
    if (!ctx.isRetry) {
      return { output: null, notes, forcedAbstain: false, retry: true };
    }
    note('schema', 'forced_abstain', `malformed output: ${validation.errors.join('; ')}`);
    return {
      output: {
        recommendation: 'abstain',
        confidence_basis: 'Guardrail: malformed output',
        explanation: 'The investigation did not return a usable result.',
        claims: [],
        calculations: [],
        missing_evidence: ['a well-formed investigation result'],
        suggested_tag: 'other',
      },
      notes,
      forcedAbstain: true,
      retry: false,
    };
  }

  // Work on a copy — never mutate the caller's object.
  const output = JSON.parse(JSON.stringify(rawOutput));
  let forcedAbstain = false;

  const abstain = (reason, detail) => {
    note(reason, 'forced_abstain', detail);
    output.recommendation = 'abstain';
    forcedAbstain = true;
  };

  // Check 5 is evaluated first because reaching the cap invalidates any
  // conclusion, no matter how well-formed. Spec lists it last; the outcome is
  // the same and this avoids reporting cosmetic findings on a truncated run.
  if (Number.isFinite(ctx.stepsCount) && Number.isFinite(ctx.maxSteps)
      && ctx.stepsCount >= ctx.maxSteps) {
    abstain('step_cap', `investigation incomplete: step cap ${ctx.maxSteps} reached`);
    output.missing_evidence = (output.missing_evidence || [])
      .concat(['investigation did not finish within the step cap']);
    return { output, notes, forcedAbstain, retry: false };
  }

  // Check 2 — every number traceable to a calculation or a cited quote.
  const allowed = calculatedNumbers(ctx.calcLogs).concat(quotedNumbers(ctx.chunks));
  const scanned = [output.explanation]
    .concat((output.claims || []).map((c) => c.text));
  const untraceable = [];
  for (const text of scanned) {
    for (const n of extractNumbers(text || '')) {
      if (!allowed.some((a) => numbersMatch(a, n))) untraceable.push(n);
    }
  }
  if (untraceable.length > 0) {
    abstain('figure_traceability',
      `unverified figure: ${untraceable.join(', ')} not produced by a calculation or quoted from a cited document`);
  }

  // Check 3 — every claim's quote must appear verbatim in the cited chunk.
  const chunkIndex = new Map();
  for (const chunk of ctx.chunks || []) {
    const key = normaliseWhitespace(chunk.citation || '');
    const existing = chunkIndex.get(key) || '';
    chunkIndex.set(key, `${existing} ${normaliseWhitespace(chunk.content || '')}`);
  }
  const keptClaims = [];
  for (const claim of output.claims || []) {
    const body = chunkIndex.get(normaliseWhitespace(claim.citation));
    if (body === undefined) {
      note('quote_verification', 'claim_removed',
        `citation ${claim.citation} was never retrieved in this casefile`);
      continue;
    }
    if (body.indexOf(normaliseWhitespace(claim.quote)) === -1) {
      note('quote_verification', 'claim_removed',
        `quote not found verbatim in ${claim.citation}`);
      continue;
    }
    keptClaims.push(claim);
  }
  const claimsRemoved = (output.claims || []).length - keptClaims.length;
  output.claims = keptClaims;

  // Check 4 — resolve needs a passing calculation and cited effective terms.
  if (output.recommendation === 'resolve') {
    const hasPassingCalc = (ctx.calcLogs || []).some((c) => c.pass === true);
    if (!hasPassingCalc) {
      note('resolve_support', 'downgraded_to_escalate',
        'resolve requires at least one passing calc; none found');
      output.recommendation = 'escalate';
    } else if (keptClaims.length === 0) {
      // Removing fake quotes left nothing supporting the conclusion.
      abstain('resolve_support',
        'resolve had no surviving cited terms after quote verification');
    } else if (claimsRemoved > 0) {
      note('resolve_support', 'claims_removed_resolve_retained',
        `${claimsRemoved} claim(s) removed; a passing calc and ${keptClaims.length} cited term(s) remain`);
    }
  }

  return { output, notes, forcedAbstain, retry: false };
}

export {
  applyGuardrail, extractNumbers, numbersMatch,
  calculatedNumbers, quotedNumbers, validateCasefileOutput,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    applyGuardrail, extractNumbers, numbersMatch,
    calculatedNumbers, quotedNumbers, validateCasefileOutput,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test guardrails/`
Expected: all tests PASS (Task 3's 12 plus Task 4's 22).

- [ ] **Step 5: Commit**

```bash
git add guardrails/guardrail.js guardrails/guardrail.test.js
git commit -m "feat: add code guardrail enforcing figure traceability and quote verification"
```

---

### Task 5: Policy engine

**Files:**
- Create: `guardrails/policy.js`
- Test: `guardrails/policy.test.js`

**Interfaces:**
- Consumes: the guardrail's `output` from Task 4.
- Produces:
  - `applyPolicy(output, context, policy)` → `{ output, notes }`, notes in the same shape as the guardrail's.
  - `policy` is the §6.2 map: `{ variance_tolerance, escalate_if_breach_margin_over, prohibited_actions, max_steps, require_human_review }`, loaded from the `policy` table.
  - `context` is `{ calcLogs, reportedDscr, claims }`.
  - `DEFAULT_POLICY` constant matching the §6.2 defaults, for tests and seeding.

- [ ] **Step 1: Write the failing tests**

Create `guardrails/policy.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPolicy, DEFAULT_POLICY } from './policy.js';

const CALC_ID = '11111111-1111-4111-8111-111111111111';

function resolveOutput() {
  return {
    recommendation: 'resolve',
    confidence_basis: 'Amendment permits the add-back.',
    explanation: 'Recomputed DSCR is 1.32 against the 1.25 threshold.',
    claims: [{ text: 'Add-back permitted', citation: 'Amd 2 §3(a)', quote: 'may be added back' }],
    calculations: [{ calc_id: CALC_ID }],
    missing_evidence: [],
    suggested_tag: 'amendment_addback',
  };
}

function calc(over) {
  return { calc_id: CALC_ID, dscr: 1.32, threshold: 1.25, pass: true, margin: 0.07, ...over };
}

test('defaults match spec §6.2', () => {
  assert.equal(DEFAULT_POLICY.variance_tolerance, 0.05);
  assert.equal(DEFAULT_POLICY.escalate_if_breach_margin_over, 0.15);
  assert.equal(DEFAULT_POLICY.max_steps, 8);
  assert.equal(DEFAULT_POLICY.require_human_review, true);
  assert.deepEqual(DEFAULT_POLICY.prohibited_actions,
    ['waive covenant', 'amend terms', 'contact borrower']);
});

test('leaves a well-supported resolve alone when variance is explained', () => {
  const r = applyPolicy(resolveOutput(),
    { calcLogs: [calc()], reportedDscr: 1.12 }, DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'resolve');
  assert.equal(r.notes.length, 0);
});

test('escalates a resolve when variance exceeds tolerance with no explaining claim', () => {
  const out = resolveOutput();
  out.claims = [];
  const r = applyPolicy(out, { calcLogs: [calc()], reportedDscr: 1.12 }, DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'escalate');
  assert.ok(r.notes.some((n) => /variance/.test(n.detail)));
});

test('allows a resolve when variance is inside tolerance even without claims', () => {
  const out = resolveOutput();
  out.claims = [];
  // |1.32 - 1.30| = 0.02, inside 0.05
  const r = applyPolicy(out, { calcLogs: [calc()], reportedDscr: 1.30 }, DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'resolve');
});

test('escalates a breach deeper than the margin limit', () => {
  const out = { ...resolveOutput(), recommendation: 'request' };
  // margin -0.40 is worse than -0.15
  const r = applyPolicy(out,
    { calcLogs: [calc({ pass: false, dscr: 0.85, margin: -0.40 })], reportedDscr: 0.85 },
    DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'escalate');
  assert.ok(r.notes.some((n) => /breach margin/.test(n.detail)));
});

test('does not escalate a shallow breach on that rule alone', () => {
  const out = { ...resolveOutput(), recommendation: 'request' };
  const r = applyPolicy(out,
    { calcLogs: [calc({ pass: false, dscr: 1.15, margin: -0.10 })], reportedDscr: 1.15 },
    DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'request');
});

test('escalates when the explanation proposes a prohibited action', () => {
  for (const phrase of ['waive covenant', 'amend terms', 'contact borrower']) {
    const out = resolveOutput();
    out.explanation = `We should ${phrase} to resolve this.`;
    const r = applyPolicy(out, { calcLogs: [calc()], reportedDscr: 1.32 }, DEFAULT_POLICY);
    assert.equal(r.output.recommendation, 'escalate', `failed for: ${phrase}`);
    assert.ok(r.notes.some((n) => /prohibited action/.test(n.detail)));
  }
});

test('matches prohibited actions case-insensitively', () => {
  const out = resolveOutput();
  out.explanation = 'We should WAIVE COVENANT here.';
  const r = applyPolicy(out, { calcLogs: [calc()], reportedDscr: 1.32 }, DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'escalate');
});

test('scans claim text for prohibited actions as well', () => {
  const out = resolveOutput();
  out.claims[0].text = 'Lender may amend terms at will';
  const r = applyPolicy(out, { calcLogs: [calc()], reportedDscr: 1.32 }, DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'escalate');
});

test('does not flag an innocent mention of the word covenant', () => {
  const out = resolveOutput();
  out.explanation = 'The covenant is satisfied at 1.32 against 1.25.';
  const r = applyPolicy(out, { calcLogs: [calc()], reportedDscr: 1.32 }, DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'resolve');
});

test('respects a policy value overridden from the table', () => {
  const out = resolveOutput();
  out.claims = [];
  const loose = { ...DEFAULT_POLICY, variance_tolerance: 0.5 };
  const r = applyPolicy(out, { calcLogs: [calc()], reportedDscr: 1.12 }, loose);
  assert.equal(r.output.recommendation, 'resolve');
});

test('skips variance checking when there is no reported figure', () => {
  const out = resolveOutput();
  out.claims = [];
  const r = applyPolicy(out, { calcLogs: [calc()], reportedDscr: null }, DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'resolve');
});

test('does not mutate the output it was given', () => {
  const out = resolveOutput();
  const copy = JSON.parse(JSON.stringify(out));
  applyPolicy(out, { calcLogs: [calc()], reportedDscr: 1.12 }, DEFAULT_POLICY);
  assert.deepEqual(out, copy);
});

test('never downgrades an abstain', () => {
  const out = { ...resolveOutput(), recommendation: 'abstain', claims: [] };
  const r = applyPolicy(out,
    { calcLogs: [calc({ pass: false, margin: -0.9 })], reportedDscr: 0.5 }, DEFAULT_POLICY);
  assert.equal(r.output.recommendation, 'abstain');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test guardrails/`
Expected: FAIL — `Cannot find module` for `./policy.js`.

- [ ] **Step 3: Write the policy engine**

Create `guardrails/policy.js`:

```javascript
/**
 * Risk Officer policy — spec §6.2. Runs after the guardrail.
 *
 * Values come from the `policy` table so the Risk Officer can change them
 * without code. Zero dependencies, no imports: pasted into an n8n Code node.
 */

const DEFAULT_POLICY = {
  variance_tolerance: 0.05,
  escalate_if_breach_margin_over: 0.15,
  prohibited_actions: ['waive covenant', 'amend terms', 'contact borrower'],
  max_steps: 8,
  require_human_review: true,
};

function applyPolicy(rawOutput, context, policyInput) {
  const policy = { ...DEFAULT_POLICY, ...(policyInput || {}) };
  const ctx = context || {};
  const output = JSON.parse(JSON.stringify(rawOutput));
  const notes = [];
  const note = (check, action, detail) => notes.push({ check, action, detail });

  const calcLogs = ctx.calcLogs || [];
  const escalate = (check, detail) => {
    // An abstain already withholds a conclusion; escalating it would overstate
    // what the system knows.
    if (output.recommendation === 'abstain') return;
    note(check, 'escalated', detail);
    output.recommendation = 'escalate';
  };

  // Rule: a prohibited action proposed anywhere in the narrative escalates.
  const narrative = [output.explanation || '']
    .concat((output.claims || []).map((c) => c.text || ''))
    .join(' ')
    .toLowerCase();
  for (const action of policy.prohibited_actions || []) {
    if (narrative.indexOf(String(action).toLowerCase()) !== -1) {
      escalate('prohibited_actions', `prohibited action proposed: ${action}`);
      break;
    }
  }

  // Rule: a true breach deeper than the limit always escalates.
  const worstMargin = calcLogs
    .filter((c) => Number.isFinite(c.margin))
    .reduce((acc, c) => Math.min(acc, c.margin), Infinity);
  if (Number.isFinite(worstMargin)
      && worstMargin < 0
      && Math.abs(worstMargin) > policy.escalate_if_breach_margin_over) {
    escalate('breach_depth',
      `breach margin ${worstMargin} exceeds limit ${policy.escalate_if_breach_margin_over}`);
  }

  // Rule: an unexplained gap against the borrower's own figure blocks resolve.
  if (output.recommendation === 'resolve' && Number.isFinite(ctx.reportedDscr)) {
    const ours = calcLogs.filter((c) => c.pass === true).map((c) => c.dscr);
    const latest = ours.length > 0 ? ours[ours.length - 1] : null;
    if (Number.isFinite(latest)) {
      const variance = Math.abs(latest - ctx.reportedDscr);
      const explained = (output.claims || []).length > 0;
      if (variance > policy.variance_tolerance && !explained) {
        escalate('variance_tolerance',
          `variance ${variance.toFixed(4)} exceeds tolerance ${policy.variance_tolerance} with no cited finding explaining the gap`);
      }
    }
  }

  return { output, notes };
}

export { applyPolicy, DEFAULT_POLICY };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyPolicy, DEFAULT_POLICY };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test guardrails/`
Expected: all tests PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests across `calc/` and `guardrails/` PASS.

- [ ] **Step 6: Commit**

```bash
git add guardrails/policy.js guardrails/policy.test.js
git commit -m "feat: add Risk Officer policy engine"
```

---

### Task 6: Synthetic facilities and the expected-values template

**Files:**
- Create: `data/facilities.js`
- Create: `data/generate.mjs`
- Test: `data/facilities.test.js`
- Generates: `data/facilities/F1..F6/*.txt` and `data/expected-values-template.csv`

**Interfaces:**
- Consumes: nothing at runtime. `facilities.js` figures are chosen so the DSCR outcomes match §4.3.
- Produces:
  - `FACILITIES` — array of six facility definitions, each `{ id, borrower_name, industry, sender_domain, twist, expected_outcome, terms, financials, reported_dscr, documents }`.
  - `data/facilities/F*/` text files: `agreement.txt`, `amendment.txt` or `waiver.txt` where the twist calls for it, `financials.txt`, `compliance_certificate.txt`.
  - `data/expected-values-template.csv` — one row per case with the covenant terms and the six financial inputs, and an empty `expected_dscr` column for the owner to fill.

**PDF note:** the spec calls for text-based PDFs. This task writes `.txt` first because the content is what matters and text is diffable in review. Converting to PDF is a mechanical last step handled in Plan 2, where the n8n ingest workflow needs real PDFs. The generator's `--pdf` flag is added there.

- [ ] **Step 1: Write the failing tests**

Create `data/facilities.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACILITIES } from './facilities.js';
import { computeDscr } from '../calc/dscr.js';

const CALC_ID = '11111111-1111-4111-8111-111111111111';

test('defines exactly the six facilities from spec §4.3', () => {
  assert.equal(FACILITIES.length, 6);
  assert.deepEqual(FACILITIES.map((f) => f.id), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  assert.deepEqual(FACILITIES.map((f) => f.borrower_name), [
    'Harbor Logistics', 'Pinecrest Dental', 'Northgate Foods',
    'Alder Software', 'Coastal Marine', 'Ridge Ag Supply',
  ]);
});

test('every facility has the fields the generator and workflows need', () => {
  for (const f of FACILITIES) {
    assert.equal(typeof f.industry, 'string', `${f.id} industry`);
    assert.equal(typeof f.sender_domain, 'string', `${f.id} sender_domain`);
    assert.equal(typeof f.twist, 'string', `${f.id} twist`);
    assert.ok(['resolve', 'request', 'escalate', 'abstain'].includes(f.expected_outcome),
      `${f.id} expected_outcome`);
    assert.ok(Array.isArray(f.documents) && f.documents.length >= 3, `${f.id} documents`);
    assert.ok(Number.isFinite(f.reported_dscr), `${f.id} reported_dscr`);
  }
});

test('F1 recomputes above threshold once the amendment add-back applies', () => {
  // Spec §4.3: reported 1.12 -> actual passes after Amendment No. 2.
  const f1 = FACILITIES.find((f) => f.id === 'F1');
  assert.equal(f1.reported_dscr, 1.12);
  const r = computeDscr(f1.terms, f1.financials, { calcId: CALC_ID });
  assert.equal(r.error, undefined);
  assert.equal(r.pass, true);
  assert.ok(r.dscr > f1.terms.threshold.min_dscr,
    `F1 should pass, got ${r.dscr} vs ${f1.terms.threshold.min_dscr}`);
});

test('F3 is a genuine breach that nothing explains', () => {
  const f3 = FACILITIES.find((f) => f.id === 'F3');
  const r = computeDscr(f3.terms, f3.financials, { calcId: CALC_ID });
  assert.equal(r.error, undefined);
  assert.equal(r.pass, false);
  assert.equal(f3.expected_outcome, 'escalate');
});

test('F6 recomputes above threshold because the borrower omitted an add-back', () => {
  const f6 = FACILITIES.find((f) => f.id === 'F6');
  const r = computeDscr(f6.terms, f6.financials, { calcId: CALC_ID });
  assert.equal(r.pass, true);
  assert.ok(r.dscr > f6.reported_dscr,
    'our figure should beat the borrower-reported figure');
});

test('F5 mirrors F1 so a memory lesson can shorten the path', () => {
  const f1 = FACILITIES.find((f) => f.id === 'F1');
  const f5 = FACILITIES.find((f) => f.id === 'F5');
  assert.equal(f5.expected_outcome, 'resolve');
  assert.equal(f5.pattern_tag, f1.pattern_tag);
  assert.ok(f5.documents.some((d) => d.doc_type === 'amendment'));
});

test('F2 and F4 are the incomplete-evidence cases', () => {
  const f2 = FACILITIES.find((f) => f.id === 'F2');
  const f4 = FACILITIES.find((f) => f.id === 'F4');
  assert.equal(f2.expected_outcome, 'request');
  assert.equal(f4.expected_outcome, 'abstain');
  // F4's certificate cites a waiver, and no waiver document is on file.
  assert.ok(!f4.documents.some((d) => d.doc_type === 'waiver'));
});

test('every facility computes without a calculator error', () => {
  for (const f of FACILITIES) {
    const r = computeDscr(f.terms, f.financials, { calcId: CALC_ID });
    assert.equal(r.error, undefined, `${f.id}: ${r.error}`);
  }
});

test('every add-back named in terms has a matching figure', () => {
  for (const f of FACILITIES) {
    for (const a of f.terms.numerator.addbacks || []) {
      assert.ok(Object.prototype.hasOwnProperty.call(f.financials.addback_amounts, a.name),
        `${f.id} missing figure for add-back ${a.name}`);
    }
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test data/`
Expected: FAIL — `Cannot find module` for `./facilities.js`.

- [ ] **Step 3: Write the facility definitions**

Create `data/facilities.js`. Each facility's figures must produce the §4.3 outcome — the tests from Step 1 enforce that. Shape for F1, which the other five follow:

```javascript
/**
 * The six synthetic facilities — spec §4.3 and §9.
 *
 * All borrowers, figures and documents are invented. The figures are chosen so
 * the calculator reaches the outcome §4.3 expects; data/facilities.test.js
 * enforces that, so a figure cannot drift without a test failing.
 *
 * The expected DSCR values used to GRADE the system are not here. They are
 * computed independently by the owner in a spreadsheet (§9), from
 * data/expected-values-template.csv.
 */

const COMMON_DEDUCTIONS = ['unfinanced_capex', 'cash_taxes'];
const COMMON_DENOMINATOR = ['scheduled_principal', 'cash_interest'];

const FACILITIES = [
  {
    id: 'F1',
    borrower_name: 'Harbor Logistics',
    industry: 'Freight and logistics',
    sender_domain: 'harborlogistics.example',
    twist: 'Amendment No. 2 permits a one-time restructuring add-back capped at $500,000. '
         + 'The borrower computed DSCR without it and reported a breach.',
    expected_outcome: 'resolve',
    pattern_tag: 'amendment_addback',
    reported_dscr: 1.12,
    test_period_end: '2026-06-30',
    terms: {
      test_period: { basis: 'TTM', period_end: '2026-06-30' },
      threshold: { min_dscr: 1.25, citation: 'CA §7.11' },
      numerator: {
        base: 'Consolidated EBITDA',
        addbacks: [{
          name: 'restructuring charges',
          amount_source: 'financials',
          cap: 500000,
          citation: 'Amd 2 §3(a)',
        }],
        deductions: COMMON_DEDUCTIONS,
      },
      denominator: { components: COMMON_DENOMINATOR, citation: 'CA §1.01' },
      effective_amendments: [{
        doc: 'Amendment No. 2', effective: '2026-04-01', citation: 'Amd 2 §1',
      }],
    },
    financials: {
      ebitda: 4250000,
      addback_amounts: { 'restructuring charges': 480000 },
      unfinanced_capex: 300000,
      cash_taxes: 250000,
      scheduled_principal: 2000000,
      cash_interest: 1100000,
    },
    documents: [
      { doc_type: 'agreement', title: 'Credit Agreement', effective_date: '2024-03-15' },
      { doc_type: 'amendment', title: 'Amendment No. 2', effective_date: '2026-04-01' },
      { doc_type: 'financials', title: 'Quarterly Financials — Q2 2026', effective_date: '2026-06-30' },
      { doc_type: 'compliance_certificate', title: 'Compliance Certificate — Q2 2026', effective_date: '2026-06-30' },
    ],
  },
  // F2 Pinecrest Dental — certificate states the wrong test period, so the
  // agent must request a corrected certificate rather than compute.
  // F3 Northgate Foods — genuine breach, no amendment or waiver explains it.
  // F4 Alder Software — certificate cites a waiver that is not in the file.
  // F5 Coastal Marine — same amendment_addback shape as F1, fewer steps warm.
  // F6 Ridge Ag Supply — borrower omitted a permitted add-back.
];

export { FACILITIES, COMMON_DEDUCTIONS, COMMON_DENOMINATOR };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FACILITIES, COMMON_DEDUCTIONS, COMMON_DENOMINATOR };
}
```

Fill in F2 through F6 following F1's shape. Constraints the tests enforce:

| Facility | Must hold |
|---|---|
| F2 Pinecrest Dental | `expected_outcome: 'request'`, `pattern_tag: 'period_mismatch'`. Certificate's `test_period_end` differs from the facility's quarter. Figures must still compute cleanly. |
| F3 Northgate Foods | `expected_outcome: 'escalate'`, `pattern_tag: 'true_breach'`. Calculator must return `pass: false`. No amendment or waiver in `documents`. Keep the margin shallower than 0.15 so the §6.2 depth rule is not what escalates it — the escalation must come from the agent finding nothing. |
| F4 Alder Software | `expected_outcome: 'abstain'`, `pattern_tag: 'missing_waiver'`. No `waiver` entry in `documents`; the certificate text references one. |
| F5 Coastal Marine | `expected_outcome: 'resolve'`, `pattern_tag: 'amendment_addback'` (same as F1). Must include an `amendment` document. Different borrower, industry and figures from F1 — only the pattern repeats. |
| F6 Ridge Ag Supply | `expected_outcome: 'resolve'`, `pattern_tag: 'borrower_calc_error'`. Calculator `pass: true` and `dscr > reported_dscr`. No amendment needed — the add-back is in the original agreement and the borrower simply left it out. |

Two optional fields the generator reads, which only F2 and F4 set:

- `certificate_period_end` (string) — overrides the period printed on the compliance certificate. **F2 sets this** to a quarter other than `terms.test_period.period_end`; that mismatch is F2's whole twist. Every other facility omits it and the certificate uses the facility's own period.
- `certificate_note` (string) — extra `§4 Note` paragraph on the certificate. **F4 sets this** to text referencing a waiver that is not in `documents`, e.g. `"The ratio reflects the covenant relief granted under the Waiver Letter dated 15 May 2026."` That dangling reference is what the agent must fail to corroborate.


- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test data/`
Expected: all 9 tests PASS. If an outcome assertion fails, adjust that facility's figures — not the test.

- [ ] **Step 5: Write the document generator**

Create `data/generate.mjs`. It writes one directory per facility. Every document starts with the required marker.

```javascript
/**
 * Generates the synthetic document set — spec §9.
 * Usage: node data/generate.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { FACILITIES } from './facilities.js';

const MARKER = 'SYNTHETIC — FOR DEMONSTRATION';
const OUT = new URL('./facilities/', import.meta.url);

const money = (n) => n.toLocaleString('en-US');

function header(facility, title) {
  return `${MARKER}\n\n${title.toUpperCase()}\n${facility.borrower_name}\n\n`;
}

/** Section headings use the § / ARTICLE forms the ingest chunker splits on. */
function agreement(f) {
  const t = f.terms;
  const addbackClause = (t.numerator.addbacks || [])
    .map((a) => `      (i) ${a.name}${Number.isFinite(a.cap) ? ` not exceeding $${money(a.cap)}` : ''};`)
    .join('\n');
  return header(f, 'Credit Agreement')
    + `ARTICLE I — DEFINITIONS\n\n`
    + `§1.01 "Debt Service" means, for any period, the sum of scheduled principal `
    + `payments and cash interest expense paid or payable in respect of the Loans.\n\n`
    + `§1.02 "Consolidated EBITDA" means consolidated net income plus interest expense, `
    + `income taxes, depreciation and amortization, in each case for the trailing twelve `
    + `month period then ended.\n\n`
    + `ARTICLE VII — FINANCIAL COVENANTS\n\n`
    + `§7.11 Debt Service Coverage Ratio. Borrower shall maintain, as of the last day of `
    + `each fiscal quarter, a Debt Service Coverage Ratio of not less than `
    + `${t.threshold.min_dscr.toFixed(2)} to 1.00, tested on a trailing twelve month basis. `
    + `For purposes of this §7.11 the numerator shall be Consolidated EBITDA, `
    + `plus the following permitted add-backs:\n${addbackClause || '      (none)'}\n`
    + `      less unfinanced capital expenditures and cash taxes paid.\n\n`
    + `ARTICLE VIII — EVENTS OF DEFAULT\n\n`
    + `§8.01 Failure to comply with §7.11 shall constitute an Event of Default, subject `
    + `to the notice and cure provisions of §8.04.\n\n`
    + `ARTICLE IX — NOTICES\n\n`
    + `§9.01 Notices shall be delivered to the addresses set forth on Schedule 9.01.\n`;
}

function financials(f) {
  // Spec §9: the six calculator inputs appear as plain labeled lines so the
  // agent can read and cite them without table extraction.
  const fin = f.financials;
  const addbackLines = Object.entries(fin.addback_amounts)
    .map(([name, v]) => `${name.replace(/\b\w/g, (c) => c.toUpperCase())}: ${money(v)}`)
    .join('\n');
  return header(f, 'Quarterly Financial Statements')
    + `Period: trailing twelve months ended ${f.terms.test_period.period_end}\n`
    + `All amounts in USD.\n\n`
    + `SELECTED FINANCIAL DATA\n\n`
    + `Consolidated EBITDA: ${money(fin.ebitda)}\n`
    + `${addbackLines}\n`
    + `Unfinanced Capital Expenditures: ${money(fin.unfinanced_capex)}\n`
    + `Cash Taxes Paid: ${money(fin.cash_taxes)}\n`
    + `Scheduled Principal Payments: ${money(fin.scheduled_principal)}\n`
    + `Cash Interest Expense: ${money(fin.cash_interest)}\n`;
}

function certificate(f) {
  return header(f, 'Compliance Certificate')
    + `The undersigned officer of ${f.borrower_name} hereby certifies as follows.\n\n`
    + `§1 Test Period. The fiscal quarter ended ${f.certificate_period_end
        || f.terms.test_period.period_end}.\n\n`
    + `§2 Debt Service Coverage Ratio. The Debt Service Coverage Ratio for the test `
    + `period was ${f.reported_dscr.toFixed(2)} to 1.00.\n\n`
    + `§3 Required Ratio. The ratio required by §7.11 of the Credit Agreement is `
    + `${f.terms.threshold.min_dscr.toFixed(2)} to 1.00.\n\n`
    + (f.certificate_note ? `§4 Note. ${f.certificate_note}\n\n` : '')
    + `Signed by an Authorized Officer.\n`;
}

function amendment(f, doc) {
  const a = (f.terms.numerator.addbacks || [])[0];
  return header(f, doc.title)
    + `§1 Effective Date. This ${doc.title} is effective as of ${doc.effective_date}.\n\n`
    + `§2 Reference. This amends the Credit Agreement dated as of the date set forth therein.\n\n`
    + `§3 Amendment to §7.11.\n`
    + `      (a) The definition of the numerator in §7.11 is amended to permit the `
    + `add-back of ${a ? a.name : 'permitted charges'}`
    + `${a && Number.isFinite(a.cap) ? ` not exceeding $${money(a.cap)}` : ''}, `
    + `in each case to the extent incurred during the test period.\n\n`
    + `§4 Effect. Except as expressly amended, the Credit Agreement remains in full force.\n`;
}

const BUILDERS = {
  agreement, financials, compliance_certificate: certificate,
  amendment, waiver: amendment,
};

let written = 0;
for (const f of FACILITIES) {
  const dir = new URL(`${f.id}/`, OUT);
  mkdirSync(dir, { recursive: true });
  for (const doc of f.documents) {
    const build = BUILDERS[doc.doc_type];
    if (!build) throw new Error(`${f.id}: no builder for doc_type ${doc.doc_type}`);
    const name = `${doc.doc_type}${doc.doc_type === 'amendment' ? `-${doc.title.replace(/\W+/g, '-').toLowerCase()}` : ''}.txt`;
    const body = build(f, doc);
    if (!body.startsWith(MARKER)) throw new Error(`${f.id}/${name} missing marker`);
    writeFileSync(new URL(name, dir), body, 'utf8');
    written++;
  }
}

// Expected-values template — the owner fills expected_dscr (spec §9).
const rows = [[
  'case_id', 'facility', 'borrower', 'test_period_end', 'threshold',
  'ebitda', 'addbacks', 'unfinanced_capex', 'cash_taxes',
  'scheduled_principal', 'cash_interest',
  'reported_dscr', 'expected_dscr', 'expected_outcome', 'expected_tag', 'owner_signed_off',
].join(',')];
for (const f of FACILITIES) {
  const fin = f.financials;
  const addbacks = Object.entries(fin.addback_amounts)
    .map(([k, v]) => `${k}=${v}`).join('; ');
  rows.push([
    f.id, f.id, `"${f.borrower_name}"`, f.terms.test_period.period_end,
    f.terms.threshold.min_dscr, fin.ebitda, `"${addbacks}"`,
    fin.unfinanced_capex, fin.cash_taxes, fin.scheduled_principal, fin.cash_interest,
    f.reported_dscr, '', f.expected_outcome, f.pattern_tag, 'NO',
  ].join(','));
}
writeFileSync(new URL('../expected-values-template.csv', OUT), `${rows.join('\n')}\n`, 'utf8');

console.log(`Wrote ${written} documents and data/expected-values-template.csv`);
```

- [ ] **Step 6: Run the generator**

Run: `node data/generate.mjs`
Expected: `Wrote N documents and data/expected-values-template.csv`, with `data/facilities/F1..F6/` populated.

- [ ] **Step 7: Spot-check one agreement and one financials file**

Run: `head -30 data/facilities/F1/agreement.txt && head -20 data/facilities/F1/financials.txt`
Expected: the marker on line 1; `§7.11` present in the agreement; the six inputs present as labeled lines in the financials.

- [ ] **Step 8: Add the generator to package.json**

Modify `package.json` — add to `scripts`:

```json
"generate:data": "node data/generate.mjs"
```

- [ ] **Step 9: Commit**

```bash
git add data/ package.json
git commit -m "feat: add six synthetic facilities, document generator and expected-values template"
```

- [ ] **Step 10: Hand the template to the owner**

The generated `data/expected-values-template.csv` has an empty `expected_dscr` column and `owner_signed_off: NO` on every row. Tell the owner it is ready, and that the `expected_dscr` values must be computed in a spreadsheet from the covenant terms — not copied from anything this code produces. Plan 3's eval runner reads this file and must refuse to run while any row still says `NO`.

---

## Plan Complete — what exists at the end

- Nine tables live in Supabase, verified by `npm run verify:schema`
- A DSCR calculator proven against caps, deductions, rounding, negative earnings and every specified error case
- A guardrail that forces abstain on untraceable figures and strips unverifiable quotes, with the two false-abstain traps covered
- A policy engine enforcing the four §6.2 rules from table-driven values
- Six synthetic facilities whose figures are test-locked to the §4.3 outcomes, their documents on disk, and a template waiting for the owner's independent expected values
- `npm test` green

**Not in this plan:** n8n workflows, the orchestrator and its sub-agents, retrieval and embeddings, the analyst UI, the eval runner, PDF conversion. Those are plans 2 and 3.
