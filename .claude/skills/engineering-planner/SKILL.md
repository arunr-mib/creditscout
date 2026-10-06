---
name: engineering-planner
description: Turn the CreditScout PRD into an engineering document — architecture, data models with RLS, API design, feature breakdown, and a build sequence where every stage is runnable. Use when the PRD has changed and the architecture needs to catch up, or when starting a new subsystem.
---

# Engineering Planner

## Purpose

Translate product requirements into an engineering plan that answers every
structural question **once**, so that later prompts build on a shared foundation
instead of re-deciding the data shape each time.

Run this when `docs/prd.md` changes materially, or when a new subsystem needs an
architecture before anyone writes code.

## Inputs

Read all of these before producing anything:

- `docs/prd.md` — the product requirements, including §2.3 AI behaviour spec
- `docs/mental-model.md` — the three layers, maker-checker, and the seven nouns
- `docs/superpowers/specs/2026-10-01-creditscout-design.md` — the owner-owned spec
- `docs/engineering/engineering-doc.md` — the current architecture, if it exists
- `docs/parking-lot.md` — what is deliberately deferred; do not re-open it
- `CLAUDE.md` — hard constraints

## Instructions

1. **Plan first, write second.** Produce the plan as output and wait for approval
   before writing any file. A missing table caught here costs 30 seconds; caught
   mid-build it costs hours.

2. Produce these sections, in this order:
   - **Architecture overview** — components and how they connect
   - **Data models** — every table with column names, types, nullability,
     foreign keys, constraints, **and RLS policies**. State which role can read
     and which can write.
   - **API design** — every route with method, request body, response shape, and
     auth. Separate analyst-facing routes from agent tool routes.
   - **Feature breakdown** — every PRD user story mapped to components, tables
     and routes. **A story with no route does not exist.**
   - **Build sequence** — ordered stages where each produces something runnable.
     State the dependency and the runnable proof for each.

3. **Honour the non-negotiables** from `CLAUDE.md`:
   - `calc/dscr.js` and `guardrails/*.js` are zero-dependency and import-free
   - The calculator never defaults a missing value to zero and never infers
   - `calc_id` is injected by the caller, never generated inside the pure function
   - Embeddings are 1536-dimensional
   - Supabase is cloud, never local
   - Synthetic data only, marked `SYNTHETIC — FOR DEMONSTRATION`

4. **Keep the boundary intact.** The model decides what to inspect and never
   produces a number. Code produces every number and never decides. A human
   always approves. If a design choice blurs this, reject it and say why.

5. **Order the build sequence by dependency, but call out risk separately.** If a
   late-dependency stage is the riskiest, say so and recommend spiking it early.

6. **Do not invent requirements.** If the PRD is silent on something structural,
   list it as an open question with an owner rather than deciding it quietly.

## Output

`docs/engineering/engineering-doc.md`, containing all five sections above, plus:

- A **spec amendments** table listing any change that requires owner approval
- An **open items** list with owners
- Risks, each with a mitigation or an explicit acceptance

Report what changed and what still needs a decision from the owner.
