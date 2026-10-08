import Link from "next/link";
import { anonReader } from "@/lib/supabase/anon";
import { quarterLabel } from "@/lib/tests/extract-financials";

export const dynamic = "force-dynamic";

const must = (res: { data: unknown; error: { message: string } | null }, what: string): unknown => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

interface ReviewRow { id: string; casefile_id: string; decision: string; reason: string | null; pattern_tag: string | null; lesson_text: string | null; created_at: string | null }
interface CasefileRow { id: string; exception_id: string }
interface ExceptionRow { id: string; facility_id: string; test_period_end: string }
interface FacilityRow { id: string; borrower_name: string }

/**
 * Analyst-approved lessons (audit 3.7 / §2). A review's reasoning — an approve's
 * confirmed summary, or an override's verbatim reason — is embedded as a lesson
 * and retrieved on similar later cases. This is the memory loop made legible: a
 * lesson is the lender's accumulated judgement, tied to the case it came from.
 */
export default async function LessonsPage() {
  const db = anonReader();
  const [reviewsRes, casefilesRes, exceptionsRes, facilitiesRes] = await Promise.all([
    db.from("reviews").select("id, casefile_id, decision, reason, pattern_tag, lesson_text, created_at").not("lesson_text", "is", null).order("created_at", { ascending: false }),
    db.from("casefiles").select("id, exception_id"),
    db.from("exceptions").select("id, facility_id, test_period_end"),
    db.from("facilities").select("id, borrower_name"),
  ]);

  const reviews = (must(reviewsRes, "reviews") ?? []) as ReviewRow[];
  const casefiles = new Map((((must(casefilesRes, "casefiles") ?? []) as CasefileRow[])).map((c) => [c.id, c]));
  const exceptions = new Map((((must(exceptionsRes, "exceptions") ?? []) as ExceptionRow[])).map((e) => [e.id, e]));
  const nameOf = new Map((((must(facilitiesRes, "facilities") ?? []) as FacilityRow[])).map((f) => [f.id, f.borrower_name]));

  const lessons = reviews.map((r) => {
    const cf = casefiles.get(r.casefile_id);
    const ex = cf ? exceptions.get(cf.exception_id) : undefined;
    return {
      ...r,
      source: ex ? `${nameOf.get(ex.facility_id) ?? "Unknown"} · ${quarterLabel(ex.test_period_end)}` : null,
    };
  });

  return (
    <div className="space-y-12">
      <header className="max-w-prose space-y-1">
        <p className="text-label text-text-muted">Precedents</p>
        <h1 className="text-title text-text">Lessons</h1>
        <p className="pt-1 text-body text-text-secondary">
          What analysts have decided, kept as precedent. A lesson is retrieved on later cases that look similar, so the
          same reasoning does not have to be rebuilt each quarter.
        </p>
      </header>

      {lessons.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-body text-text-secondary">No lessons yet.</p>
          <p className="mt-1 text-label text-text-muted">
            Approve or override a casefile and its reasoning is saved here, ready to inform a similar future case.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {lessons.map((l) => (
            <li key={l.id} className="rounded-lg border border-border-strong bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {l.pattern_tag && <span className="rounded-sm border border-border-strong px-2 py-px text-label text-text-secondary">{l.pattern_tag}</span>}
                  <span className="text-label text-text-muted">from {l.decision.replace("_", " ")}</span>
                </div>
                {l.source && (
                  <Link href={`/casefiles/${l.casefile_id}`} className="text-label text-text-secondary underline-offset-2 hover:underline">
                    {l.source}
                  </Link>
                )}
              </div>
              <p className="mt-3 max-w-prose whitespace-pre-wrap text-body text-text">{l.lesson_text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
