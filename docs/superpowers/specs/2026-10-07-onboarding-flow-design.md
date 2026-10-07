# Loan Onboarding Flow — Design Spec

**Date:** 2026-10-07
**Owner:** Arun Rajendiran (product) · Claude Code (engineering)
**Status:** Proposed — awaiting owner review
**Context:** A guided UI flow to onboard a new borrower/loan, so the demo can show the Credit-scout Agent **extracting covenant terms from an uploaded loan agreement** (grounded, agentic RAG — not hallucinated), followed by human approval. Extends the design in `docs/superpowers/specs/2026-10-01-creditscout-design.md`.

---

## 1. Goal

Today, loans (DB table `facilities`) exist only via the seed script. There is no UI to bring a new borrower in. This flow adds one, and in doing so makes the product's grounding claim *visible*: upload your loan agreement → the agent reads **that file** and proposes the covenant terms with citations → a human reviews and approves.

**Success:** an analyst (or a demo viewer) can, entirely in the UI, create a borrower, upload a loan agreement, watch the agent propose cited covenant terms from it, and approve them — after which the loan appears in the Portfolio.

## 2. Scope

**In scope**
- A **route-driven wizard** (Approach 2): a stepper header ties together URL-driven steps; the complex "review & approve terms" step reuses the existing covenant-setup page.
- A **"+ New Borrower"** entry on the Portfolio header.
- A **create-loan** server action (inserts a `facilities` row) — the one genuinely new backend piece.
- Reuse, unchanged: `POST /api/ingest` (upload→chunk→embed), `POST /api/covenant-terms/propose` (the definition-agent reads the ingested agreement and writes a `proposed` row), the covenant-setup screen + its approve action, `POST /api/covenant-terms/approve`.
- **Terminology:** user-facing copy says **"loan"** (the DB table stays `facilities`; no migration). Align visible labels (e.g. "Facilities tested" → "Loans tested").
- A **4th synthetic borrower**'s documents (loan agreement + amendment + a quarter's financials + compliance certificate, each marked `SYNTHETIC — FOR DEMONSTRATION`) generated as demo upload material.

**Out of scope**
- Running the first test and the investigation — the **existing Portfolio → test → casefile flow**, deliberately not part of onboarding. (The financials and compliance certificate **are** uploaded during onboarding, so they're on file; only the test run + investigation happen later.)
- A document execution-status field (noted as a known gap; today execution is encoded in the title, e.g. "Waiver Request Letter — unexecuted").
- Renaming the `facilities` table or any other DB change.
- The F1/F5 boarding-lag and F3 uncited-clause twists — untouched; the new borrower is separate.

## 3. The flow (route-driven wizard)

A persistent stepper (1→4) sits above every step. State is carried by the URL: once the loan row exists, its id is in the path.

1. **New Borrower** — `/borrowers/new`. Form: borrower name, industry, (optional) loan reference. Submitting calls the **create-loan** action → inserts a `facilities` row → redirects to step 2 for that id.
2. **Upload documents** — `/borrowers/[id]/onboarding?step=documents`. **All documents in one place**: the loan agreement (required), any amendments, the quarter's financials, and the compliance certificate — each tagged with its **document type + effective date** → `POST /api/ingest` (reuses the existing UploadPackage fields). "Continue" is enabled once the **agreement** is ingested (it is what the agent needs to propose terms); the financials/certificate are ingested here too so they are on file for the first test later, but they are not required to proceed.
3. **Agent extracts the terms** — same route, `?step=propose`. Copy: *"The Credit-scout Agent is extracting the covenant terms from your loan agreement."* Calls `POST /api/covenant-terms/propose` for the loan; shows a working state while the definition-agent reads the ingested chunks; on success a `proposed` covenant_terms row exists and we advance to step 4.
4. **Review & approve** — redirect to the **existing** `/facilities/[id]/covenant-setup` page (rendered inside the stepper chrome, or linked as the final step), which already shows the proposed terms, their citations, uncited-clause warnings, edits, and the approve action. Approving writes the versioned `approved` row.

**Done:** a confirmation that the loan is set up, with a link to the Portfolio, where it now appears (status "Not tested" until the quarter is run).

## 4. Architecture

- **New route group** `app/borrowers/new/page.tsx` and `app/borrowers/[id]/onboarding/page.tsx` (server components; `?step=` selects the sub-view). A small **stepper** component renders the 1→4 progress on each.
- **New server action** `createLoan({ borrower_name, industry })` on the service role — the only new write. Returns the new id for the redirect. Validates required fields; never defaults silently.
- **Reused, unchanged:** ingest route, propose route, `CovenantSetup` component + approve action, covenant-setup page.
- **Data flow:** create row → ingest documents (chunks+embeds under the loan id) → propose (definition-agent reads those chunks, writes `proposed` terms with citations) → approve (writes `approved` v1). Exactly the pipeline the seed + covenant-setup use today, driven from the UI.
- **Entry point:** a "+ New Borrower" button in the Portfolio header, beside "Run Q{N}".

## 5. Synthetic borrower data

Extend `data/generate.mjs` (or add a sibling fixture) to emit a 4th borrower under `data/facilities/` — a realistic loan agreement (definitions article, DSCR covenant in a §7.11-style section), one amendment with an effective date, a quarter's financials (six calculator inputs on labelled lines), and a compliance certificate. All carry `SYNTHETIC — FOR DEMONSTRATION`; the borrower name is fictional and distinct from F1/F3/F5. These files are the **upload material** for testing and the demo — they are NOT seeded, so onboarding genuinely creates the loan.

## 6. Error handling & edge cases

- **Create-loan**: missing name → inline error, no row written. A duplicate borrower name is allowed (distinct ids).
- **Ingest**: a non-text or oversized PDF → the route's existing error is surfaced in the step; the agreement requirement blocks "Continue" until one ingests.
- **Propose**: the definition-agent can fail (model/deployment error, unusable output) — surface the route's existing messages and allow retry; never fabricate terms. If no agreement is on file, propose is not offered.
- **Approve**: unchanged — the server re-verifies provenance (the S-1 control); the UI edit/approve path is the existing one.
- **Resuming**: because state is in the URL + DB, a half-finished onboarding can be re-entered at the right step from the loan id (its proposed/approved rows decide the step).

## 7. Testing

- **Unit (`node:test`)**: `createLoan` validation (missing/blank fields rejected; valid input shapes the insert). A small pure helper that decides the current onboarding step from a loan's documents + terms rows (no documents → step 2; agreement but no proposed terms → step 3; proposed → step 4; approved → done).
- **Manual/live**: run the whole flow on the deploy with the 4th synthetic borrower — create → upload agreement → propose (watch the agent read it) → approve → see it in the Portfolio.

## 8. Decisions (resolved with the owner)

- **Step 4 review & approve: embedded in the wizard chrome (B).** Render the existing `CovenantSetup` component inside the onboarding stepper (the onboarding route loads the same data the covenant-setup page loads and passes it to the component; the approve server action is reused unchanged). The stepper stays visible so the flow reads as one guided sequence. (This supersedes the earlier "navigate away" lean — the approval UI is already a reusable component, so embedding costs little and demos far better.)
- **Relabel "facility" → "loan" app-wide.** Align all visible copy (e.g. "Facilities tested" → "Loans tested", the Portfolio/casefile wording). The DB table `facilities` and all code identifiers are unchanged — copy only.
