/**
 * The casefile that is current for an exception: its newest one that has not
 * been superseded. A `superseded` casefile (a re-investigation retired it) uses
 * this to point the analyst at the one that replaced it.
 *
 * Takes the client as a parameter so it runs under the anon reader on a Server
 * Component and under a fake in tests.
 */
interface Reader {
  from: (table: string) => any;
}

export async function currentCasefileId(db: Reader, exceptionId: string): Promise<string | null> {
  const res = await db
    .from("casefiles")
    .select("id, status, created_at")
    .eq("exception_id", exceptionId)
    .order("created_at", { ascending: false });
  if (res.error) throw new Error(`select casefiles: ${res.error.message}`);
  const rows = (res.data ?? []) as { id: string; status: string }[];
  return rows.find((r) => r.status !== "superseded")?.id ?? null;
}
