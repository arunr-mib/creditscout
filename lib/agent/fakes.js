/**
 * TEST SUPPORT ONLY. Never imported by production code.
 *
 * The in-memory database and the scripted Foundry the agent tests share. They
 * lived inside `orchestrator.test.js` until stage 8b needed them too; a second
 * copy would be a second author's idea of how PostgREST behaves, and the
 * whole-branch review (V-5 / R2-7) traced two tests that passed with the
 * behaviour deleted to exactly that — fakes faithful only to the cases their
 * author thought of. One file, so a fidelity fix lands everywhere at once.
 *
 * Not named `*.test.js`, so `node --test` does not run it as a suite.
 */

export const EXCEPTION_ID = "24486e45-9897-4591-8ca0-86f766372ae1";
export const FACILITY_ID = "b0c54d3f-aa3d-4c02-af90-cbaff0490f60";
export const OTHER_FACILITY = "bddbabec-8625-4a05-8a55-4d02955c7b8d";
export const CASEFILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
export const TEST_ID = "7290702c-3f3f-4208-84d8-403d78f60543";
/** The fake clock, in epoch seconds: 2026-10-06T13:56:40Z. */
export const AT = 1791295000;

/** `metadata->>facility_id` reads `row.metadata.facility_id`, as PostgREST's JSON operators do. */
function read(row, column) {
  const path = column.split(/->>?/).map((p) => p.trim());
  let v = row;
  for (const p of path) v = v === null || v === undefined ? undefined : v[p];
  return v;
}

/**
 * Enough of the supabase-js builder for the agent modules: select / insert /
 * update with eq, in, is, lte, order, limit, single, maybeSingle.
 *
 * What it does that a looser fake would not, each because a looser one let a
 * real bug through:
 *
 *   - it HONOURS the select column list. PostgREST returns only what you ask
 *     for, and a fake that returns whole rows cannot notice a column the code
 *     reads but never selected (finding N-1).
 *   - it records an ordered `timeline` of every operation, so a test can assert
 *     that one thing happened before another rather than merely that both did
 *     (finding N-2).
 *   - it HONOURS `order` and `limit` (R2-7: `latestCasefile` returning the OLDEST
 *     casefile passed every test while they were ignored), resolves `a->>b`
 *     JSON paths in filters, and returns PostgREST's PGRST116 when
 *     `maybeSingle` finds more than one row instead of quietly picking the first.
 *   - an UNKNOWN TABLE is an error (42P01), not an empty result. A typo in a
 *     table name otherwise reads as "nothing on file", which for the casefile
 *     guardrail means "no evidence" — a silent abstain nobody would trace.
 *
 * Still NOT modelled, stated so nobody relies on it: unknown COLUMNS (PostgREST
 * errors 42703; this fake returns them absent), `or()`, and RLS.
 */
export function fakeDb(seed = {}) {
  const tables = {
    exceptions: [
      { id: EXCEPTION_ID, facility_id: FACILITY_ID, test_id: null, test_period_end: "2026-06-30", computed_dscr: "1.1200", reported_dscr: "1.1200", required_dscr: "1.2500", status: "new" },
    ],
    facilities: [{ id: FACILITY_ID, borrower_name: "Harbor Logistics", industry: "Freight and logistics" }],
    documents: [
      { facility_id: FACILITY_ID, doc_type: "agreement", title: "Credit Agreement", effective_date: "2024-03-15" },
      { facility_id: FACILITY_ID, doc_type: "amendment", title: "Amendment No. 2", effective_date: "2026-04-01" },
    ],
    covenant_terms: [
      {
        id: "terms-v1",
        facility_id: FACILITY_ID,
        version: 1,
        effective_from: "2024-03-15",
        effective_to: null,
        status: "approved",
        terms: { threshold: { min_dscr: 1.25 }, numerator: { addbacks: [], deductions: ["unfinanced_capex", "cash_taxes"] }, denominator: { components: ["scheduled_principal", "cash_interest"] }, effective_amendments: [] },
      },
    ],
    policy: [{ key: "max_steps", value: 8 }],
    casefiles: [],
    calc_log: [],
    tests: [],
    doc_chunks: [],
    ...seed,
  };
  let counter = 0;
  const writes = [];
  const timeline = [];
  function from(name) {
    const st = { op: "select", filters: [], ins: [], is: [], lte: null, orders: [], limit: null, payload: null, mode: "many", returning: false, cols: null };
    const b = {
      select(cols) { if (st.op !== "select") st.returning = true; st.cols = cols ?? null; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      in(c, v) { st.ins.push([c, v]); return b; },
      is(c, v) { st.is.push([c, v]); return b; },
      lte(c, v) { st.lte = [c, v]; return b; },
      order(c, opts = {}) { st.orders.push([c, opts.ascending !== false]); return b; },
      limit(n) { st.limit = n; return b; },
      single() { st.mode = "single"; return b; },
      maybeSingle() { st.mode = "maybe"; return b; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    const match = (r) =>
      st.filters.every(([c, v]) => read(r, c) === v) &&
      st.ins.every(([c, v]) => v.includes(read(r, c))) &&
      st.is.every(([c, v]) => (read(r, c) ?? null) === v) &&
      (st.lte === null || read(r, st.lte[0]) <= st.lte[1]);
    /** Only the selected columns come back, exactly as PostgREST behaves. */
    const project = (row) => {
      if (st.cols === null || st.cols.trim() === "*") return structuredClone(row);
      const out = {};
      for (const col of st.cols.split(",").map((c) => c.trim()).filter(Boolean)) {
        if (col in row) out[col] = structuredClone(row[col]);
      }
      return out;
    };
    const sorted = (rows) => {
      if (st.orders.length === 0) return rows;
      return [...rows].sort((x, y) => {
        for (const [c, asc] of st.orders) {
          const a = read(x, c);
          const z = read(y, c);
          if (a === z) continue;
          // PostgREST's default: NULLS LAST ascending, NULLS FIRST descending.
          if (a === null || a === undefined) return asc ? 1 : -1;
          if (z === null || z === undefined) return asc ? -1 : 1;
          return (a < z ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      });
    };
    const shape = (rows) => {
      const limited = st.limit === null ? sorted(rows) : sorted(rows).slice(0, st.limit);
      const picked = limited.map(project);
      if (st.mode === "many") return { data: picked, error: null };
      if (st.mode === "maybe") {
        if (picked.length > 1) return { data: null, error: { code: "PGRST116", message: `JSON object requested, multiple (or no) rows returned (${picked.length})` } };
        return { data: picked[0] ?? null, error: null };
      }
      return picked.length === 1 ? { data: picked[0], error: null } : { data: null, error: { code: "PGRST116", message: `expected one row, got ${picked.length}` } };
    };
    function run() {
      timeline.push(`${name}.${st.op}`);
      if (!(name in tables)) return { data: null, error: { code: "42P01", message: `relation "public.${name}" does not exist` } };
      const rows = tables[name];
      const forced = db.failOnce;
      if (forced && forced.table === name && forced.op === st.op) {
        db.failOnce = null;
        if (st.op === "insert") writes.push({ table: name, op: "insert", payload: st.payload });
        if (db.revealAfterInsert) { rows.push(db.revealAfterInsert); db.revealAfterInsert = null; }
        return { data: null, error: forced.error };
      }
      if (st.op === "select") return shape(rows.filter(match));
      if (st.op === "insert") {
        writes.push({ table: name, op: "insert", payload: st.payload });
        // A uuid, as Postgres would mint: code that validates ids must see one.
        // `created_at` moves forward with every insert, as `now()` does, because
        // the casefile guardrail orders calculations by it.
        const row = { id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, steps_count: 0, status: "investigating", created_at: new Date(AT * 1000 + counter * 1000).toISOString(), ...structuredClone(st.payload) };
        rows.push(row);
        return st.returning ? shape([row]) : { data: null, error: null };
      }
      if (st.op === "update") {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, structuredClone(st.payload)));
        writes.push({ table: name, op: "update", payload: st.payload, rows: hit.length });
        return st.returning ? { data: hit.map(project), error: null } : { data: null, error: null };
      }
      throw new Error(`fakeDb: ${st.op}`);
    }
    return b;
  }
  const db = { tables, writes, timeline, from, failOnce: null, revealAfterInsert: null };
  return db;
}

/**
 * A scripted Foundry, as a state machine rather than a queue.
 *
 * `states[phase]` is what a GET returns, and the phase advances when the run is
 * ADVANCED — by submitting tool outputs, or by polling if `advanceOnPoll` is
 * set to model a run progressing under its own steam.
 *
 * It does NOT advance merely because someone looked at it, and that is the whole
 * point. The previous fake advanced on every GET, so two concurrent syncs saw
 * two different states and could never both reach `requires_action` — which
 * made the lock test pass with the lock deleted (finding N-3).
 *
 * A run created on an EXISTING thread (the casefile guardrail's one retry) is a
 * separate script: `retry.states` for its GETs, `retry.messages` for what it
 * said. Its id is `run_retry_N`.
 */
export function fakeFoundry({ states, steps, messages = [], advanceOnPoll = false, retry = null }) {
  const seen = [];
  let phase = 0;
  let cancelled = false;
  let retries = 0;
  const retryPhase = new Map();
  const at = (i) => states[Math.min(i, states.length - 1)];
  const impl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    seen.push({ url, method: init.method, body });
    const reply = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    const retryRun = /\/runs\/(run_retry_\d+)/.exec(url)?.[1];
    if (retryRun && retry) {
      if (url.includes("/cancel")) return reply({ id: retryRun, thread_id: "thread_1", status: "cancelled" });
      const i = retryPhase.get(retryRun) ?? 0;
      retryPhase.set(retryRun, i + 1);
      const s = retry.states[Math.min(i, retry.states.length - 1)];
      return reply({ id: retryRun, thread_id: "thread_1", ...s });
    }
    if (url.includes("/steps")) return reply({ data: steps[Math.min(phase, steps.length - 1)] ?? [] });
    if (url.includes("/messages")) {
      const all = [...messages, ...(retry?.messages ?? [])];
      return reply({ data: all });
    }
    if (url.includes("/submit_tool_outputs")) {
      phase = Math.min(phase + 1, states.length - 1);
      return reply(at(phase));
    }
    if (url.includes("/cancel")) {
      cancelled = true;
      return reply({ ...at(phase), status: "cancelled" });
    }
    if (/\/threads\/[^/]+\/runs$/.test(url.split("?")[0]) && init.method === "POST") {
      if (!retry) return reply({ error: { message: "no retry scripted" } }, 400);
      if (retry.fail) return reply({ error: { message: retry.fail } }, 500);
      retries += 1;
      return reply({ id: `run_retry_${retries}`, thread_id: "thread_1", status: "queued" });
    }
    if (url.includes("/threads/runs")) return reply({ id: "run_1", thread_id: "thread_1", status: "queued" });
    // A GET of the run itself.
    if (cancelled) return reply({ ...at(phase), status: "cancelled" });
    const current = at(phase);
    if (advanceOnPoll) phase = Math.min(phase + 1, states.length - 1);
    return reply(current);
  };
  impl.seen = seen;
  return {
    fetchImpl: impl,
    token: async () => "fake-token",
    config: { endpoint: "https://e", apiVersion: "2025-05-01", orchestratorModel: "gpt-4.1-mini", specialistModel: "gpt-5-mini" },
  };
}


export const toolStep = (name, args, output, at = AT, kind = "function") => ({
  id: `step_${name}_${at}`,
  created_at: at,
  completed_at: at + 1,
  status: "completed",
  type: "tool_calls",
  step_details: {
    type: "tool_calls",
    tool_calls: [
      kind === "function"
        ? { id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args), output } }
        : { id: `call_${name}`, type: "connected_agent", connected_agent: { name, arguments: JSON.stringify(args), output } },
    ],
  },
});

export const message = (text, runId = "run_1") => ({ role: "assistant", run_id: runId, content: [{ type: "text", text: { value: text } }] });

export const requiresAction = (tool, args = "{}") => ({
  id: "run_1",
  thread_id: "thread_1",
  status: "requires_action",
  required_action: {
    type: "submit_tool_outputs",
    submit_tool_outputs: { tool_calls: [{ id: `call_${tool}`, type: "function", function: { name: tool, arguments: args } }] },
  },
});

export const casefileRow = (over = {}) => ({
  id: CASEFILE_ID,
  agent_output: null,
  trace: [],
  exception_id: EXCEPTION_ID,
  status: "investigating",
  steps_count: 0,
  run_id: "demo",
  foundry_thread_id: "thread_1",
  foundry_run_id: "run_1",
  last_step_at: new Date(AT * 1000).toISOString(),
  created_at: new Date(AT * 1000).toISOString(),
  ...over,
});
