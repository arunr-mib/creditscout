import { GovernanceView } from "@/components/GovernanceView";
import type { PolicyTableRow } from "@/components/governanceModel";
import type { EvalRunLike } from "@/components/scoreboardModel";
import { anonReader } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";

const must = (res: { data: unknown; error: { message: string } | null }, what: string): unknown => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

/**
 * Governance & evals (spec §4.5 / §7.4). Read-only: it configures nothing.
 *
 * Server Component reading with the anon key under the RLS read policy — the
 * `policy` and `eval_runs` tables both carry `anon_read`. The policy is the
 * Risk Officer's, shown with the human-review boundary locked; the scoreboard
 * reads the latest cold and warm eval runs (empty until stage 10 runs the
 * harness, which is the honest state the screen names).
 */
export default async function GovernancePage() {
  const db = anonReader();

  const [policyRes, evalRes] = await Promise.all([
    db.from("policy").select("key, value"),
    db.from("eval_runs").select("mode, metrics, created_at").order("created_at", { ascending: false }),
  ]);

  const policy = (must(policyRes, "select policy") ?? []) as PolicyTableRow[];
  const runs = (must(evalRes, "select eval_runs") ?? []) as EvalRunLike[];

  return (
    <div className="space-y-6">
      <header className="max-w-prose space-y-1">
        <p className="text-label text-text-muted">Policy &amp; performance</p>
        <h1 className="text-title text-text">Governance</h1>
        <p className="pt-1 text-body text-text-secondary">Review investigation controls and evaluation results.</p>
      </header>

      <GovernanceView policy={policy} runs={runs} />
    </div>
  );
}
