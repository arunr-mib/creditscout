import { CalcValue } from "@/components/CalcValue";

export default function Home() {
  return (
    <div className="space-y-6">
      <h1 className="text-title text-text">Portfolio</h1>
      <p className="text-body text-text-secondary">
        Shell only. Screens arrive at build stage 9.
      </p>
      <div className="rounded-md border border-border bg-surface p-6">
        <p className="mb-3 text-label uppercase tracking-wide text-text-muted">
          Reference component — the model/code colour rule
        </p>
        <CalcValue label="DSCR" value={1.31} calcId="calc_a3f9" />
      </div>
    </div>
  );
}
