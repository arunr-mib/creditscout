import { boardingState } from "@/components/portfolioModel";
import type { SearchItem } from "@/components/searchModel";
import { anonReader } from "@/lib/supabase/anon";
import { quarterLabel } from "@/lib/tests/extract-financials";

/** The badge counts on the section tabs. A tab with nothing waiting shows no badge rather than a zero. */
export interface NavCounts {
  queue: number;
  documents: number;
  terms: number;
  lessons: number;
}

/**
 * The data the primary nav needs: the badge counts and the global-search index
 * (audit §2, 3.9). Read once in the layout, with the anon key under RLS. A read
 * failure degrades to an empty rail rather than breaking every page.
 */
export async function loadNavData(): Promise<{ counts: NavCounts; search: SearchItem[] }> {
  try {
    const db = anonReader();
    const [facilitiesRes, testsRes, exceptionsRes, casefilesRes, documentsRes, termsRes, reviewsRes] = await Promise.all([
      db.from("facilities").select("id, borrower_name, industry"),
      db.from("tests").select("id, facility_id, test_period_end").eq("run_id", "demo"),
      db.from("exceptions").select("id, facility_id, status, test_period_end, test_id"),
      db.from("casefiles").select("id, exception_id, status, recommendation, created_at").eq("run_id", "demo"),
      db.from("documents").select("id, facility_id, doc_type, title, effective_date"),
      db.from("covenant_terms").select("facility_id, terms, status, version").eq("status", "approved"),
      db.from("reviews").select("id, casefile_id, decision, pattern_tag, reason, lesson_text, created_at"),
    ]);

    const facilities = (facilitiesRes.data ?? []) as { id: string; borrower_name: string; industry: string | null }[];
    const tests = (testsRes.data ?? []) as { id: string; facility_id: string; test_period_end: string }[];
    const demoTestIds = new Set(tests.map((t) => t.id));
    const exceptions = ((exceptionsRes.data ?? []) as { id: string; facility_id: string; status: string; test_period_end: string; test_id: string }[]).filter(
      (e) => demoTestIds.has(e.test_id),
    );
    const casefiles = (casefilesRes.data ?? []) as { id: string; exception_id: string; status: string; recommendation: string | null; created_at: string | null }[];
    const documents = (documentsRes.data ?? []) as { id: string; facility_id: string; doc_type: string; title: string; effective_date: string | null }[];
    const terms = (termsRes.data ?? []) as { facility_id: string; terms: unknown; status: string; version: number }[];
    const reviews = (reviewsRes.data ?? []) as { id: string; casefile_id: string; decision: string; pattern_tag: string | null; reason: string | null; lesson_text: string | null; created_at: string | null }[];

    const nameOf = new Map(facilities.map((f) => [f.id, f.borrower_name]));
    const approvedFor = (fid: string) => terms.find((t) => t.facility_id === fid) ?? null;

    // The live casefile per exception (newest non-failed/non-superseded).
    const liveCf = new Map<string, (typeof casefiles)[number]>();
    for (const c of casefiles) {
      if (c.status === "failed" || c.status === "superseded") continue;
      const held = liveCf.get(c.exception_id);
      if (!held || (c.created_at ?? "") > (held.created_at ?? "")) liveCf.set(c.exception_id, c);
    }

    const notBoarded = documents.filter((d) => boardingState({ doc_type: d.doc_type, title: d.title, effective_date: d.effective_date }, approvedFor(d.facility_id) as never) === "not_boarded");
    const lessons = reviews.filter((r) => r.lesson_text != null);

    const counts: NavCounts = {
      queue: exceptions.filter((e) => e.status !== "closed").length,
      documents: notBoarded.length,
      terms: new Set(notBoarded.map((d) => d.facility_id)).size,
      lessons: lessons.length,
    };

    const search: SearchItem[] = [];
    for (const f of facilities) search.push({ kind: "borrower", label: f.borrower_name, sublabel: f.industry ?? undefined, href: "/" });
    for (const e of exceptions) {
      const cf = liveCf.get(e.id);
      if (!cf) continue;
      search.push({
        kind: "case",
        label: `${nameOf.get(e.facility_id) ?? "Unknown"} — ${quarterLabel(e.test_period_end)}`,
        sublabel: cf.recommendation ? `recommends ${cf.recommendation}` : cf.status,
        href: `/casefiles/${cf.id}`,
      });
    }
    for (const d of documents) search.push({ kind: "document", label: d.title, sublabel: `${nameOf.get(d.facility_id) ?? ""} · ${d.doc_type}`, href: "/documents" });
    for (const t of terms) search.push({ kind: "terms", label: `${nameOf.get(t.facility_id) ?? ""} — Terms v${t.version}`, sublabel: t.status, href: "/terms" });
    for (const l of lessons) search.push({ kind: "lesson", label: l.pattern_tag ?? "Lesson", sublabel: l.reason?.slice(0, 80) ?? undefined, href: "/lessons" });
    for (const p of [
      { label: "Governance", href: "/governance" },
      { label: "Documents", href: "/documents" },
      { label: "Terms", href: "/terms" },
      { label: "Lessons", href: "/lessons" },
    ]) search.push({ kind: "page", label: p.label, href: p.href });

    return { counts, search };
  } catch {
    return { counts: { queue: 0, documents: 0, terms: 0, lessons: 0 }, search: [] };
  }
}
