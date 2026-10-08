---
name: security-foundation
description: Review CreditScout for security issues before it ships — RLS policies, the service-role key boundary, agent tool-endpoint auth, file upload validation, prompt injection from borrower documents, and secrets hygiene. Use before any deploy.
---

# Security Foundation

## Purpose

Catch security problems in the plan and the code before anything is publicly
reachable. CreditScout deploys to a public URL, lets a browser read the database
directly, and exposes HTTP endpoints that an external agent platform calls. Each
of those is a real surface.

## Inputs

- `docs/engineering/engineering-doc.md` §6.13 (RLS) and §7 (API design)
- `supabase/migrations/` — the actual policies, not the intended ones
- `app/api/**` — every route handler
- `lib/supabase/server.ts` and `lib/supabase/browser.ts`
- `.env.example` and `.gitignore`

## Instructions

Work through all six areas. For each, state **pass**, **fail**, or **N/A with a
reason** — never skip one silently.

1. **Row Level Security**
   - RLS is `ENABLE`d on every table, with no exceptions
   - `anon` has **SELECT only**. No INSERT, UPDATE or DELETE policy exists for it
   - Confirm `USING (true)` is justified — it is acceptable *only* because this
     is single-tenant with synthetic data. If a tenant concept has appeared since,
     this is now a defect: it needs `lender_id` and a JWT claim check.

2. **The service-role key boundary**
   - The service-role key appears in **no** `NEXT_PUBLIC_` variable
   - `lib/supabase/server.ts` is never imported by a Client Component — check
     the import graph, not just the filename
   - No API route echoes the key, or any env var, into a response or a log

3. **Agent tool endpoints**
   - `/api/tools/*` all require `X-CreditScout-Tool-Key` and return 401 without it
   - They are **scoped**: `search-documents` must filter by the requested
     `facility_id` and must not be able to return another borrower's chunks. Test
     this with a mismatched id — cross-facility leakage is the worst bug
     available here.
   - They validate input shape before use and never interpolate a caller-supplied
     string into SQL

4. **File upload**
   - Content type and size are checked before parsing
   - Only text-based PDFs are accepted; a scanned file is rejected with a reason,
     never silently processed
   - A parse failure cannot write a partial document row

5. **Prompt injection from borrower documents**
   - Document text is **untrusted input.** A credit agreement could contain text
     designed to steer the agent.
   - Confirm the defence is structural rather than instructional: every quote is
     verified verbatim against the cited chunk, every number must trace to a
     `calc_log` entry or a quote, and the guardrail runs in **code after** the
     agent returns. An injected instruction cannot fabricate a number that
     survives the guardrail.
   - Confirm prohibited actions force escalation regardless of what the document
     says.

6. **Secrets hygiene**
   - `.env` is gitignored and has never been committed — check the history, not
     just the working tree
   - `.env.example` lists every variable with no real values
   - No key, token or connection string is hard-coded in any source file

## Output

A findings report, most severe first. For each: the file and line, what fails,
the concrete failure scenario, and the fix.

If nothing fails, say so plainly and list what was checked — an empty report must
mean "checked and clean", never "did not look".

Do not apply fixes unless asked. Report first.
