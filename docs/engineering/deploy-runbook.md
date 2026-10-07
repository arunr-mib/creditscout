# CreditScout — Vercel deploy runbook (stage 10)

The code is deploy-ready (`next build` passes). The database (Supabase cloud) is
already migrated and seeded — deploy does **not** touch it. What remains are the
Vercel-account steps, which need your login. This runbook is the exact sequence.

## 0. What the controller has prepared
- Production build verified.
- Pre-deploy security batch: `/api/ingest` and `/api/covenant-terms/approve`
  gated behind the shared key; the UI upload/approve go through Server Actions so
  they still work. (See the security-batch report.)
- This runbook.

## 1. Pick the branch
The work is on **`arunr-mib/resume-assistance`** (tip of all stages). Either:
- Deploy that branch directly as a Vercel preview/production, **or**
- Merge it to `main` first and deploy `main` (cleaner for a "production" URL).

## 2. Create the Vercel project
1. Vercel → Add New → Project → import the GitHub repo.
2. Framework preset: **Next.js** (auto-detected). Build command and output are
   default — no `vercel.json` needed.
3. Node version: the repo needs **Node ≥ 22.18** (`package.json` `engines`). Set
   the Vercel project's Node version to 22.x (or 24.x) in Project Settings.
4. Do **not** deploy yet — set env vars first (step 3).

## 3. Environment variables (Project Settings → Environment Variables)
Set every variable from `.env.example`. The values are in your local `.env`
(never commit it). Grouped by purpose:

**Supabase (database + browser read)**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — server only, **secret**.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — these ship
  to the browser by design (anon read under RLS). Publishable key only — never
  put the service-role key in a `NEXT_PUBLIC_` var.

**Azure OpenAI / AI Foundry (the agent + embeddings)**
- `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_AI_ACCOUNT`,
  `AZURE_AI_PROJECT_NAME`, `AZURE_AI_PROJECT_ENDPOINT`
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` (**secret**)
- `AZURE_EMBEDDING_DEPLOYMENT`, `AZURE_JUDGE_DEPLOYMENT`
- `FOUNDRY_ORCHESTRATOR_MODEL`, `FOUNDRY_SPECIALIST_MODEL`, `FOUNDRY_API_VERSION`
- `ANTHROPIC_API_KEY` (if used; **secret**)

**CreditScout internal**
- `CREDITSCOUT_TOOL_KEY` — the shared key the server uses to call its own tool
  routes, and now the gate on ingest/approve. **Secret.** Generate a long random
  value; the same value is used everywhere.
- `PUBLIC_BASE_URL` — **the deployed URL itself** (e.g.
  `https://creditscout.vercel.app`). The agent calls its own `/api/tools/*`
  routes at this URL while investigating, so it must be the deployment's own
  origin. Set it after the first deploy gives you the URL, then redeploy (or set
  it to your known production domain up front).

## 4. The self-call + protection interaction (read before enabling protection)
During an investigation the server fetches its own `/api/tools/*` routes at
`PUBLIC_BASE_URL` with the tool key. Those routes are tool-key gated, so a public
URL is safe for them. **Recommended for the demo: deploy PUBLIC (no Vercel
Deployment Protection).** The controls are: tool routes + ingest + approve are
key-gated; the read-only UI (portfolio, casefile, governance) is intended to be
public; all data is synthetic.

If you *do* want Vercel Deployment Protection (password/SSO) on the whole app,
the server's self-calls to `/api/tools/*` will be blocked by the protection gate
unless you also enable **Protection Bypass for Automation** and send its token on
those calls — tell the controller and it will add the bypass header to the
self-call. Don't enable protection without that, or investigations will 401.

## 5. Deploy
1. Trigger the deploy. First build ~2–4 min.
2. Copy the deployment URL → set `PUBLIC_BASE_URL` to it → redeploy so the agent
   can reach its own routes.

## 6. Foundry note
The orchestrator currently uses **function tools** (the run parks at
`requires_action`; the server submits outputs via the self-calls above). This
works unchanged on Vercel once `PUBLIC_BASE_URL` and `CREDITSCOUT_TOOL_KEY` are
set — no Foundry reconfiguration needed to deploy. (The OpenAPI-tool path, where
Foundry calls the routes directly, is committed in `lib/agent/openapi.ts` for a
future switch but is not required now.)

## 7. Post-deploy smoke test
- Load `/` (portfolio) and `/governance` — they should render against live data.
- Click **Investigate** on Coastal Marine (F5) — it should run and resolve.
- Open a reviewed casefile — Approve/Override/Request-docs render.

## 8. Known items at deploy
- **Live trace streaming** is laggy (steps appear in ~25s batches / on reload);
  correctness is unaffected. Tracked polish (render-from-poll-state).
- **F1 is nondeterministic** (abstain/escalate/resolve across runs); the guardrail
  never false-resolves. Demo-accurate, not a deploy blocker.
- **Eval scoreboard** shows "no eval yet" until the eval harness runs (needs the
  owner-signed expected-values oracle + Azure Foundry groundedness).
