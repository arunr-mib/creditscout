/**
 * The agent tag: a small sky chip with an agent-blue dot. It marks what the
 * CreditScout Agent (or a specialist it delegated to) did or said, and nothing
 * else — never a status, never an interactive control.
 */
export function AgentTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-agent-bg px-2 py-px text-badge text-agent-ink">
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-agent" />
      {children}
    </span>
  );
}
