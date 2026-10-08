# Loan Onboarding Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A route-driven wizard that onboards a new borrower/loan — create borrower → upload all documents → the Credit-scout Agent extracts cited covenant terms from the loan agreement → review & approve — reusing the existing ingest, propose, and covenant-setup machinery.

**Architecture:** New routes under `app/borrowers/` wrap existing pieces in a stepper. The only new backend is a `createLoan` server action (inserts a `facilities` row). Document upload reuses `UploadPackage`/`POST /api/ingest`; term extraction + review + approval reuse the self-contained `CovenantSetup` component (which already calls `POST /api/covenant-terms/propose` and the `approveTerms` action). The covenant-setup page's data loader is extracted so the standalone page and the wizard share it.

**Tech Stack:** Next.js 15 App Router (Server Components + Server Actions), TypeScript, Tailwind (design tokens only), Supabase Postgres, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-07-onboarding-flow-design.md`

## Global Constraints

- **No test framework.** `node:test` + `node:assert/strict`, run with `npm test`. Pure logic gets unit tests; React/route tasks verify with `npx tsc --noEmit` + `npm run build`.
- **DB table stays `facilities`.** No migration, no column/table rename. User-facing copy says **"loan"**; code identifiers and the table are unchanged.
- **Design tokens only** (`docs/design.md`): no arbitrary Tailwind values, **no shadows** (`boxShadow: none`). Reuse existing tokens.
- **Synthetic data only.** Every generated document carries the literal marker `SYNTHETIC — FOR DEMONSTRATION`; borrower name fictional.
- **Do not touch** the F1/F5 boarding-lag or F3 uncited-clause twists, their fixtures, or seed. The 4th borrower is separate.
- **Reuse, do not reimplement:** `POST /api/ingest`, `POST /api/covenant-terms/propose`, `components/CovenantSetup.tsx` + `approveTerms` (`@/app/actions`), `components/UploadPackage.tsx`.
- **Commit after every task**, conventional prefix `feat(onboarding):` (or `feat(ux):` for the relabel).

## Review Focus

- **Blank/whitespace borrower name** → `createLoan` must reject and write no row (Task 1 tests this).
- **Invalid or unknown loan id** in the onboarding route → `notFound()`, never a crash (Task 5 renders via the existing UUID guard; Task 2's helper is only called with a loaded loan).
- **"Continue" gate before an agreement exists** → the documents step must block advancing until a doc of type `agreement` is ingested, not just any file (Task 2 `onboardingStep` returns `documents` until an agreement is present; Task 6 tests the gate off that helper).
- **Re-entering a partially-onboarded loan** → the step is derived from DB state, so a loan with approved terms lands on "done", a proposed-but-unapproved loan lands on "review", never re-proposing silently (Task 2 tests all transitions).
- **Propose/approve failure inside the wizard** → surfaced by `CovenantSetup`'s existing error handling (reused unchanged); the wizard must not swallow it (Task 7 verifies the component renders with its own error path intact).

---

### Task 1: `createLoan` server action

**Files:**
- Modify: `app/actions.ts` (add `createLoan`; this is where `approveTerms` already lives)
- Create: `lib/onboarding.ts` (pure validation helper, so it is unit-testable without a server)
- Test: `lib/onboarding.test.js`

**Interfaces:**
- Produces: `validateNewLoan(input: { borrower_name?: unknown; industry?: unknown }): { ok: true; value: { borrower_name: string; industry: string | null } } | { ok: false; error: string }`
- Produces: `createLoan(input: { borrower_name: string; industry?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }>` — inserts one `facilities` row via the service role and returns its id.

- [ ] **Step 1: Write the failing test** (`lib/onboarding.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNewLoan } from "./onboarding.ts";

test("validateNewLoan trims and accepts a real borrower name", () => {
  const r = validateNewLoan({ borrower_name: "  Summit Freight  ", industry: "Logistics" });
  assert.deepEqual(r, { ok: true, value: { borrower_name: "Summit Freight", industry: "Logistics" } });
});

test("validateNewLoan rejects a blank or whitespace name, with no value", () => {
  for (const name of ["", "   ", undefined, 42]) {
    const r = validateNewLoan({ borrower_name: name });
    assert.equal(r.ok, false);
    assert.match(r.error, /borrower name/i);
  }
});

test("validateNewLoan treats a blank industry as null, never empty string", () => {
  assert.deepEqual(validateNewLoan({ borrower_name: "X", industry: "   " }), { ok: true, value: { borrower_name: "X", industry: null } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/onboarding.test.js`
Expected: FAIL (`validateNewLoan` not exported).

- [ ] **Step 3: Write minimal implementation** (`lib/onboarding.ts`)

```ts
/** Pure validation for a new loan. No I/O, so it is unit-testable. */
export function validateNewLoan(input: { borrower_name?: unknown; industry?: unknown }):
  | { ok: true; value: { borrower_name: string; industry: string | null } }
  | { ok: false; error: string } {
  const name = typeof input.borrower_name === "string" ? input.borrower_name.trim() : "";
  if (name === "") return { ok: false, error: "A borrower name is required." };
  const industryRaw = typeof input.industry === "string" ? input.industry.trim() : "";
  return { ok: true, value: { borrower_name: name, industry: industryRaw === "" ? null : industryRaw } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/onboarding.test.js`
Expected: PASS.

- [ ] **Step 5: Add the server action** (`app/actions.ts`)

Add (follow the file's existing `"use server"` + `supabaseAdmin` pattern used by `approveTerms`):

```ts
import { validateNewLoan } from "@/lib/onboarding";

/**
 * Create a loan (a `facilities` row). The only new write in the onboarding
 * flow; everything else reuses existing routes/actions. Service role, because
 * the anon key is SELECT-only.
 */
export async function createLoan(input: { borrower_name: string; industry?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const v = validateNewLoan(input);
  if (!v.ok) return v;
  const { supabaseAdmin } = await import("@/lib/supabase/server");
  const db = supabaseAdmin();
  const res = await db.from("facilities").insert({ borrower_name: v.value.borrower_name, industry: v.value.industry }).select("id").single();
  if (res.error) return { ok: false, error: `Could not create the loan: ${res.error.message}` };
  return { ok: true, id: res.data.id as string };
}
```

- [ ] **Step 6: Verify types + tests**

Run: `npx tsc --noEmit` then `npm test`
Expected: clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/onboarding.ts lib/onboarding.test.js app/actions.ts
git commit -m "feat(onboarding): createLoan action + validateNewLoan"
```

---

### Task 2: `onboardingStep` — derive the current step from DB state

**Files:**
- Modify: `lib/onboarding.ts`
- Test: `lib/onboarding.test.js`

**Interfaces:**
- Consumes: document rows `{ doc_type: string | null }[]` and covenant-terms rows `{ status: string }[]` for the loan.
- Produces: `onboardingStep(input: { documents: { doc_type: string | null }[]; terms: { status: string }[] }): "documents" | "terms" | "done"`
  - no `agreement` document yet → `"documents"`
  - agreement present, no `approved` terms yet → `"terms"` (covers both "needs propose" and "proposed, awaiting approval" — `CovenantSetup` handles both)
  - an `approved` terms row exists → `"done"`

- [ ] **Step 1: Write the failing test** (append to `lib/onboarding.test.js`)

```js
import { onboardingStep } from "./onboarding.ts";

test("onboardingStep: no agreement yet -> documents", () => {
  assert.equal(onboardingStep({ documents: [], terms: [] }), "documents");
  assert.equal(onboardingStep({ documents: [{ doc_type: "financials" }], terms: [] }), "documents");
});

test("onboardingStep: agreement present, not yet approved -> terms", () => {
  assert.equal(onboardingStep({ documents: [{ doc_type: "agreement" }], terms: [] }), "terms");
  assert.equal(onboardingStep({ documents: [{ doc_type: "agreement" }], terms: [{ status: "proposed" }] }), "terms");
});

test("onboardingStep: an approved terms row -> done (never re-propose)", () => {
  assert.equal(onboardingStep({ documents: [{ doc_type: "agreement" }], terms: [{ status: "superseded" }, { status: "approved" }] }), "done");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/onboarding.test.js`
Expected: FAIL (`onboardingStep` not exported).

- [ ] **Step 3: Write minimal implementation** (append to `lib/onboarding.ts`)

```ts
export function onboardingStep(input: { documents: { doc_type: string | null }[]; terms: { status: string }[] }): "documents" | "terms" | "done" {
  if (input.terms.some((t) => t.status === "approved")) return "done";
  if (!input.documents.some((d) => d.doc_type === "agreement")) return "documents";
  return "terms";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/onboarding.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding.ts lib/onboarding.test.js
git commit -m "feat(onboarding): onboardingStep derives the wizard step from DB state"
```

---

### Task 3: Extract the covenant-setup data loader (DRY, so the wizard can embed it)

**Files:**
- Create: `lib/covenant-setup-data.ts` (move the data-loading from the page into a reusable function)
- Modify: `app/facilities/[id]/covenant-setup/page.tsx` (call the extracted loader)
- Test: none new (pure move; existing behavior preserved, verified by `tsc` + `build`)

**Interfaces:**
- Produces: `loadCovenantSetupProps(db: AnonReader, id: string): Promise<null | { facility: { id: string; borrower_name: string }; documents: DocumentRow[]; history: HistoryRow[]; clauses: Clause[]; initial: Proposal | null }>` — returns `null` when the loan does not exist (caller does `notFound()`). `DocumentRow`, `HistoryRow`, `Proposal` are re-exported from `@/components/CovenantSetup`; `Clause` from `@/components/termsReview` (match the current page's imports).

- [ ] **Step 1: Create the loader** (`lib/covenant-setup-data.ts`)

Move the body of `CovenantSetupPage` (the `facility`/`docs`/`terms`/`chunks`/`amendmentTitles` reads, the `history` map, and the `initial` proposal assembly with `checkTermsProvenance` + `termsWarnings`) verbatim into `loadCovenantSetupProps(db, id)`. Return `null` instead of `notFound()` when `facility.data` is absent. Keep every import it uses (`loadSourceChunks`, `loadAmendmentTitles`, `checkTermsProvenance`, `termsWarnings`, `amendmentDocs`, types). The function takes the `db` reader as a parameter (the page passes `anonReader()`), so the wizard can pass the same.

- [ ] **Step 2: Rewrite the page to use it** (`app/facilities/[id]/covenant-setup/page.tsx`)

```tsx
import { notFound } from "next/navigation";
import { CovenantSetup } from "@/components/CovenantSetup";
import { anonReader } from "@/lib/supabase/anon";
import { loadCovenantSetupProps } from "@/lib/covenant-setup-data";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CovenantSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const props = await loadCovenantSetupProps(anonReader(), id);
  if (!props) notFound();
  return <CovenantSetup {...props} />;
}
```

- [ ] **Step 3: Verify nothing changed behaviourally**

Run: `npx tsc --noEmit` then `npm run build`
Expected: clean build; the covenant-setup route still compiles with the same props.

- [ ] **Step 4: Commit**

```bash
git add lib/covenant-setup-data.ts "app/facilities/[id]/covenant-setup/page.tsx"
git commit -m "refactor(onboarding): extract loadCovenantSetupProps for reuse in the wizard"
```

---

### Task 4: The wizard stepper (chrome)

**Files:**
- Create: `components/OnboardingStepper.tsx`
- Test: none (presentational; verified by `tsc` + `build` and the screenshot in Task 8)

**Interfaces:**
- Produces: `OnboardingStepper({ current }: { current: "borrower" | "documents" | "terms" | "done" })` — renders the four labelled steps (`New borrower` · `Upload documents` · `Covenant terms` · `Done`) with the current one marked, prior ones as complete, later ones muted. Dark-native: use `surface`/`surface-raised`, `border`/`border-strong`, token colours; **no shadow**.

- [ ] **Step 1: Write the component** (`components/OnboardingStepper.tsx`)

```tsx
const STEPS: { key: "borrower" | "documents" | "terms" | "done"; label: string }[] = [
  { key: "borrower", label: "New borrower" },
  { key: "documents", label: "Upload documents" },
  { key: "terms", label: "Covenant terms" },
  { key: "done", label: "Done" },
];

export function OnboardingStepper({ current }: { current: "borrower" | "documents" | "terms" | "done" }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3">
      {STEPS.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "todo";
        const tone = state === "current" ? "text-text" : state === "done" ? "text-model-bright" : "text-text-muted";
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-sm border text-badge ${state === "current" ? "border-model text-model-bright" : "border-border-strong text-text-muted"}`}>
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className={`text-label ${tone}`}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="px-1 text-text-muted" aria-hidden="true">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/OnboardingStepper.tsx
git commit -m "feat(onboarding): wizard stepper (chrome)"
```

---

### Task 5: "New borrower" page (step 1)

**Files:**
- Create: `app/borrowers/new/page.tsx` (server component shell + stepper)
- Create: `components/NewBorrowerForm.tsx` (client form calling `createLoan`)
- Test: none new (validation is Task 1; UI verified by `tsc`/`build`/Task 8)

**Interfaces:**
- Consumes: `createLoan` (Task 1), `OnboardingStepper` (Task 4).
- Produces: on success, `router.push(\`/borrowers/${id}/onboarding?step=documents\`)`.

- [ ] **Step 1: Write the client form** (`components/NewBorrowerForm.tsx`)

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLoan } from "@/app/actions";

export function NewBorrowerForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createLoan({ borrower_name: name, industry });
      if (!r.ok) { setError(r.error); return; }
      router.push(`/borrowers/${r.id}/onboarding?step=documents`);
    });
  };

  const field = "rounded-md border border-border-strong bg-bg px-3 py-2 text-body text-text outline-none focus:border-model";
  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-label text-text-muted">Borrower name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-label text-text-muted">Industry (optional)</span>
        <input value={industry} onChange={(e) => setIndustry(e.target.value)} className={field} />
      </label>
      {error && <p role="alert" className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-body text-danger">{error}</p>}
      <button type="submit" disabled={pending} className="rounded-md border border-model bg-gradient-to-b from-model-bright to-model px-4 py-2 text-body font-medium leading-5 text-bg transition duration-fast ease-out hover:-translate-y-px active:translate-y-px disabled:opacity-40">
        {pending ? "Creating…" : "Create loan & continue"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Write the page** (`app/borrowers/new/page.tsx`)

```tsx
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { NewBorrowerForm } from "@/components/NewBorrowerForm";

export const dynamic = "force-dynamic";

export default function NewBorrowerPage() {
  return (
    <div className="space-y-8">
      <OnboardingStepper current="borrower" />
      <header className="space-y-1">
        <p className="text-label text-text-muted">Onboard a loan</p>
        <h1 className="text-title text-text">New borrower</h1>
        <p className="max-w-prose text-body text-text-secondary">Create the borrower and their loan. Next you&rsquo;ll upload the loan agreement and the Credit-scout Agent will extract the covenant terms from it.</p>
      </header>
      <NewBorrowerForm />
    </div>
  );
}
```

- [ ] **Step 3: Verify + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: clean; `/borrowers/new` route present.

- [ ] **Step 4: Commit**

```bash
git add app/borrowers/new/page.tsx components/NewBorrowerForm.tsx
git commit -m "feat(onboarding): New borrower step (create loan)"
```

---

### Task 6: Onboarding route — documents step (step 2)

**Files:**
- Create: `app/borrowers/[id]/onboarding/page.tsx` (server component; `?step=` + DB state select the sub-view)
- Modify: `components/UploadPackage.tsx` (add optional `fixedFacilityId?: string` to pin the loan and hide the selector; default behaviour unchanged)
- Test: none new (the gate logic is Task 2's `onboardingStep`; UI verified by Task 8)

**Interfaces:**
- Consumes: `onboardingStep` (Task 2), `loadCovenantSetupProps` (Task 3 — used by Task 7), `OnboardingStepper` (Task 4), `UploadPackage` (modified here).
- Produces: the documents sub-view with `UploadPackage fixedFacilityId={id}` and a "Continue to covenant terms" link enabled only when `onboardingStep` is `terms` or `done`.

- [ ] **Step 1: Add `fixedFacilityId` to `UploadPackage`**

In `components/UploadPackage.tsx`, accept `fixedFacilityId?: string`. When set, initialise the facility state to it and render the borrower as static text instead of the `<select>`. Change the dropzone copy from "Drop the quarterly package" to "Drop a document (agreement, amendment, financials, or certificate)" **only when `fixedFacilityId` is set** (keep the existing copy otherwise). No other behavior changes — it still POSTs `file`/`facility_id`/`doc_type`/`effective_date` to `/api/ingest`.

- [ ] **Step 2: Write the onboarding page — documents branch** (`app/borrowers/[id]/onboarding/page.tsx`)

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { UploadPackage } from "@/components/UploadPackage";
import { onboardingStep } from "@/lib/onboarding";
import { anonReader } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: requested } = await searchParams;
  if (!UUID.test(id)) notFound();
  const db = anonReader();
  const facility = await db.from("facilities").select("id, borrower_name").eq("id", id).maybeSingle();
  if (facility.error) throw new Error(`select facilities: ${facility.error.message}`);
  if (!facility.data) notFound();

  const [docs, terms] = await Promise.all([
    db.from("documents").select("doc_type").eq("facility_id", id),
    db.from("covenant_terms").select("status").eq("facility_id", id),
  ]);
  const derived = onboardingStep({ documents: docs.data ?? [], terms: terms.data ?? [] });
  const step = requested === "terms" && derived !== "documents" ? "terms" : derived; // never jump ahead of the agreement gate

  if (step === "terms" || step === "done") {
    // Task 7 fills this branch (embedded CovenantSetup). For now, link out.
    return (
      <div className="space-y-8">
        <OnboardingStepper current={step === "done" ? "done" : "terms"} />
        <p className="text-body text-text-secondary">Covenant-terms step — implemented in Task 7.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <OnboardingStepper current="documents" />
      <header className="space-y-1">
        <p className="text-label text-text-muted">{facility.data.borrower_name}</p>
        <h1 className="text-title text-text">Upload documents</h1>
        <p className="max-w-prose text-body text-text-secondary">Upload the loan agreement (required), any amendments, the quarter&rsquo;s financials, and the compliance certificate. The agreement is what the Credit-scout Agent reads to extract the covenant terms.</p>
      </header>
      <UploadPackage facilities={[{ id: facility.data.id, borrower_name: facility.data.borrower_name }]} fixedFacilityId={facility.data.id} />
      <div className="flex items-center gap-3">
        <Link href={`/borrowers/${id}/onboarding?step=terms`} aria-disabled={derived === "documents"} className={`rounded-md border px-4 py-2 text-body font-medium leading-5 transition duration-fast ${derived === "documents" ? "pointer-events-none border-border text-text-muted opacity-40" : "border-model bg-gradient-to-b from-model-bright to-model text-bg hover:-translate-y-px active:translate-y-px"}`}>
          Continue to covenant terms
        </Link>
        {derived === "documents" && <span className="text-label text-text-muted">Upload the loan agreement to continue.</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: clean; `/borrowers/[id]/onboarding` route present.

- [ ] **Step 4: Commit**

```bash
git add "app/borrowers/[id]/onboarding/page.tsx" components/UploadPackage.tsx
git commit -m "feat(onboarding): documents step with agreement gate (reuses UploadPackage)"
```

---

### Task 7: Onboarding route — covenant-terms step embedded in the chrome (steps 3–4)

**Files:**
- Modify: `app/borrowers/[id]/onboarding/page.tsx` (fill the `terms`/`done` branch with embedded `CovenantSetup`)
- Modify: `components/CovenantSetup.tsx` (copy only: the propose action/working state reads "The Credit-scout Agent is extracting the covenant terms from your loan agreement")
- Test: none new (reuses the component's own propose/approve + error handling)

**Interfaces:**
- Consumes: `loadCovenantSetupProps` (Task 3), `CovenantSetup` (reused), `OnboardingStepper` (Task 4).

- [ ] **Step 1: Replace the placeholder terms branch** with the embedded component:

```tsx
import { CovenantSetup } from "@/components/CovenantSetup";
import { loadCovenantSetupProps } from "@/lib/covenant-setup-data";
// ...
if (step === "terms" || step === "done") {
  const props = await loadCovenantSetupProps(db, id);
  if (!props) notFound();
  return (
    <div className="space-y-8">
      <OnboardingStepper current={step === "done" ? "done" : "terms"} />
      <header className="space-y-1">
        <p className="text-label text-text-muted">{facility.data.borrower_name}</p>
        <h1 className="text-title text-text">Covenant terms</h1>
        <p className="max-w-prose text-body text-text-secondary">The Credit-scout Agent reads the loan agreement you uploaded and proposes the covenant terms, each tied to the clause it came from. Review and approve to finish onboarding.</p>
      </header>
      <CovenantSetup {...props} />
      {step === "done" && (
        <Link href="/" className="inline-flex rounded-md border border-border-strong px-4 py-2 text-body text-text transition-colors hover:border-model">View it in the portfolio</Link>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update the propose copy in `CovenantSetup`**

Find the propose button label / working-state text in `components/CovenantSetup.tsx` (the `propose()` path and `ProposeTrace` heading) and make it read "The Credit-scout Agent is extracting the covenant terms from your loan agreement" (and the button "Extract covenant terms"). Copy only — do not change the `propose()` fetch or `approve()` logic.

- [ ] **Step 3: Verify + build**

Run: `npx tsc --noEmit` then `npm test` then `npm run build`
Expected: clean; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add "app/borrowers/[id]/onboarding/page.tsx" components/CovenantSetup.tsx
git commit -m "feat(onboarding): embed covenant-terms review in the wizard chrome"
```

---

### Task 8: "+ New Borrower" entry on the Portfolio

**Files:**
- Modify: `app/page.tsx` (add the button in the header, beside "Run Q{N}")
- Test: none new (verified by `build` + screenshot)

**Interfaces:**
- Consumes: nothing new; links to `/borrowers/new`.

- [ ] **Step 1: Add the button** in the Portfolio header's action area (next to `RunTestButton`):

```tsx
import Link from "next/link";
// ...in the <div className="flex flex-wrap items-end justify-between gap-4"> action cluster, wrap the CTA(s):
<div className="flex flex-wrap items-center gap-3">
  <Link href="/borrowers/new" className="rounded-md border border-border-strong px-4 py-2 text-body font-medium leading-5 text-text transition-colors duration-fast hover:border-model">
    + New borrower
  </Link>
  <RunTestButton label={`Run ${targetLabel}`} endpoint="/api/tests/run-quarter" body={{ test_period_end: targetPeriod }} />
</div>
```

- [ ] **Step 2: Verify + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(onboarding): + New borrower entry on the portfolio"
```

---

### Task 9: Relabel "facility" → "loan" in visible copy (app-wide)

**Files:**
- Modify: visible strings only, in `.tsx` files. Candidates (grep first): `app/page.tsx` ("Facilities tested" → "Loans tested"), `components/NavRail.tsx`, `components/portfolioModel.ts` badge/label strings if any, any casefile/terms/documents copy that says "facility/facilities" to a user.
- Test: existing tests must still pass (do not change identifiers, table names, or test fixtures).

- [ ] **Step 1: Find every user-visible "facility" string**

Run: `grep -rniE "facilit(y|ies)" app components --include="*.tsx" | grep -viE "facility_id|facilityId|facilities\(|from\(\"facilities\"|loadFacility|UploadFacility|interface |type "`
Review the hits; change only the ones rendered to a user (JSX text, labels, aria-labels, button text, help copy). Do NOT touch: variable/prop/type names, `facility_id`, Supabase `.from("facilities")`, function names like `loadFacilityChunks`, test files.

- [ ] **Step 2: Apply the copy edits**

Example (`app/page.tsx`): `{ label: "Facilities tested", ... }` → `{ label: "Loans tested", ... }`. The section heading "Borrowers" can stay (it is accurate). Keep wording natural ("loan", "the loan").

- [ ] **Step 3: Verify nothing broke**

Run: `npx tsc --noEmit` then `npm test` then `npm run build`
Expected: clean; all tests pass (no identifier changes).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ux): relabel 'facility' -> 'loan' in user-facing copy"
```

---

### Task 10: Generate a 4th synthetic borrower's documents

**Files:**
- Modify: `data/generate.mjs` (add a 4th fixture; keep F1/F3/F5 untouched)
- Output: `data/facilities/<NEW>/` — `credit-agreement.txt`, `amendment-1.txt`, `financials-<Q>.txt`, `compliance-certificate-<Q>.txt` (+ `--pdf` variants), each marked `SYNTHETIC — FOR DEMONSTRATION`.
- Test: none automated (generation script); verified by running it and onboarding with the output in Task 11.

- [ ] **Step 1: Read the existing generator**

Read `data/generate.mjs` to learn how F1/F3/F5 fixtures are structured (borrower, agreement sections incl. the DSCR covenant in a §7.11-style section, amendment with effective date, financials with the six calculator inputs on labelled lines, compliance certificate). Mirror that shape.

- [ ] **Step 2: Add a 4th borrower fixture**

Add a new fictional borrower (e.g. "Summit Freight Co.", industry "Logistics"), NOT reusing F1/F3/F5 names or the parked F2/F4/F6 identifiers. Give it a clean, boardable agreement (a DSCR covenant with a stated minimum, a definitions article, deductions/denominator components the calculator vocabulary supports), one amendment with an effective date, a quarter's financials with all six inputs on labelled lines, and a compliance certificate. Every file carries `SYNTHETIC — FOR DEMONSTRATION`. **Do not** seed it or add it to `data/seed.mjs`/`ingest-demo.mjs` — it must stay un-boarded so onboarding genuinely creates it.

- [ ] **Step 3: Generate the files**

Run: `node data/generate.mjs --pdf`
Expected: the new borrower's `.txt` (+ `.pdf`) files appear under `data/facilities/<NEW>/`; F1/F3/F5 unchanged (`git status` shows only the new files).

- [ ] **Step 4: Commit**

```bash
git add data/generate.mjs data/facilities/
git commit -m "feat(onboarding): 4th synthetic borrower for onboarding demo/testing"
```

---

### Task 11: End-to-end verification on the deploy

**Files:** none (verification only).

- [ ] **Step 1: Deploy** — confirm `main` auto-deploys to `credit-scout.vercel.app` (push happens via the commits above).
- [ ] **Step 2: Run the whole flow signed in:** Portfolio → **+ New borrower** → create "Summit Freight Co." → **Upload documents** (agreement + amendment + financials + certificate from `data/facilities/<NEW>/`, correct doc types + effective dates) → **Continue** → **Covenant terms**: click "Extract covenant terms", watch the agent read the agreement, review the cited proposal, **Approve** → land on "Done" → open the Portfolio and confirm the new loan appears (status "Not tested").
- [ ] **Step 3: Confirm the twists are intact** — Harbor/Northgate/Coastal still read as before; no fixture changed.
- [ ] **Step 4: Report** the result (screenshots of the extract + approved steps).

---

## Self-review notes (for the executor)

- **Spec coverage:** New borrower (T1,T5) · upload all docs in one step (T6) · agent extracts cited terms (T7 reuses propose) · review & approve embedded in chrome (T3,T4,T7) · "+ New borrower" entry (T8) · "loan" relabel app-wide (T9) · 4th synthetic borrower (T10) · demo-safe end-to-end (T11). Out-of-scope (test/investigation) correctly not built.
- **Reuse integrity:** propose/approve/ingest and `CovenantSetup` are used unchanged except for copy; the one new write is `createLoan`.
- **Known gap carried from the spec:** no document execution-status field — out of scope here.
