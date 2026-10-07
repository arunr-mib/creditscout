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

## 4. Access control — the one real decision (read this)
The pre-deploy batch gated the two most dangerous raw routes (`/api/ingest`,
`/api/covenant-terms/approve`). But on a **public** URL the analyst surface is
still fully open: the Server Actions (upload, approve, review, investigate) and a
few still-ungated routes (`/api/review`, `/api/tests/run`,
`/api/tests/run-quarter`, `/api/covenant-terms/propose`) can be driven by anyone
who reaches the URL. Concretely, a stranger could **approve/override casefiles,
run tests, and spend Azure tokens by hammering Investigate.** Per-route gating
can't fix this — the UI *is* the analyst surface. Two viable options:

**CHOSEN: Option A — Vercel Deployment Protection (password/SSO). The code change
for it is already done (commit 0b69296).** To turn it on:
1. Vercel → Project → Settings → **Deployment Protection** → enable Standard
   Protection (Vercel Authentication) or Password Protection.
2. Settings → Deployment Protection → **Protection Bypass for Automation** →
   enable; Vercel generates a secret.
3. Add that secret as the env var **`VERCEL_AUTOMATION_BYPASS_SECRET`** (all
   environments). The agent's self-calls already send the
   `x-vercel-protection-bypass` header when this is set, so investigations work
   through the protection gate; without the secret set, the header is never sent
   (safe for public/dev).
4. Redeploy after setting it.

One gate now covers every route, Server Action and the token-spend surface.
MVP-appropriate (the spec puts analyst auth out of scope). Read-only reads stay
on the publishable key under anon RLS.

_(Option B — deploy public, no protection — remains possible with no code change,
but was not chosen: anyone with the URL could spend Azure tokens.)_

The read-only reads (portfolio, casefile, governance) use the publishable key
under anon RLS (SELECT-only) — safe to be public either way.

## 4b. Vercel body-size cap (uploads)
Vercel caps a serverless function request body at **4.5 MB**. The app allows 10
MB uploads, so a large package will fail at the platform before the app sees it.
Fine for the demo's synthetic PDFs (small); note it if you upload big files.

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
