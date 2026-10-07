/**
 * The specialist agent names, as a standalone client-safe constant.
 *
 * The live investigation trace (`components/traceModel.ts`, which ships to the
 * browser) colours a step teal-for-model when its `tool` is one of these. It
 * must NOT import `prompt.ts` to get them — that module carries every
 * orchestrator and specialist instruction string, which would then ship to the
 * client bundle. This file holds only the names; `prompt.ts` re-exports them so
 * existing server-side consumers are unchanged.
 */
export const SPECIALIST_NAMES = ["document_agent", "definition_agent", "research_agent"] as const;
export type SpecialistName = (typeof SPECIALIST_NAMES)[number];
