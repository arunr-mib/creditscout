import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SPECIALIST_K,
  SPECIALIST_RUNNERS,
  runDefinitionAgent,
  runDocumentAgent,
  runResearchAgent,
} from "./specialists.ts";
import { SPECIALIST_INSTRUCTIONS, SPECIALIST_NAMES } from "./prompt.ts";

// No network. Retrieval and the model are both injected.

const CTX = { facilityId: "b0c54d3f-aa3d-4c02-af90-cbaff0490f60", periodEnd: "2026-06-30" };
const OTHER_FACILITY = "bddbabec-8625-4a05-8a55-4d02955c7b8d";

const HITS = [
  { content: "§7.11 … not less than 1.25 to 1.00.", citation: "CA §7.11", section: "§7.11", doc_title: "Credit Agreement", doc_type: "agreement", score: 0.9 },
  { content: "§3 … not to exceed $500,000 for any test period.", citation: "Amd 2 §3", section: "§3", doc_title: "Amendment No. 2", doc_type: "amendment", score: 0.8 },
];

function fakes({ hits = HITS, reply = '{"facts":[]}' } = {}) {
  const searches = [];
  const chats = [];
  return {
    searches,
    chats,
    search: async (input) => { searches.push(input); return hits; },
    chat: async (system, user) => { chats.push({ system, user }); return reply; },
  };
}

// ------------------------------------------------------ retrieval is ours

test("a specialist retrieves for itself, scoped to the casefile's facility", async () => {
  // The whole point of the fallback: a connected agent could not retrieve, so
  // every delegation was a step spent on text the orchestrator already held.
  const f = fakes();
  await runDocumentAgent({ question: "What is the minimum ratio?" }, CTX, f);
  assert.equal(f.searches.length, 1);
  assert.equal(f.searches[0].facilityId, CTX.facilityId);
  assert.equal(f.searches[0].query, "What is the minimum ratio?");
  assert.equal(f.searches[0].k, SPECIALIST_K);
});

test("facility_id cannot be steered: an argument naming another borrower is ignored", async () => {
  const f = fakes();
  await runDocumentAgent({ question: "q", facility_id: OTHER_FACILITY, facilityId: OTHER_FACILITY }, CTX, f);
  assert.equal(f.searches[0].facilityId, CTX.facilityId);
});

test("doc_types narrows the reading when given, and is absent when not", async () => {
  const f = fakes();
  await runDocumentAgent({ question: "q", doc_types: ["agreement", "amendment"] }, CTX, f);
  assert.deepEqual(f.searches[0].docTypes, ["agreement", "amendment"]);
  await runDocumentAgent({ question: "q" }, CTX, f);
  assert.equal(f.searches[1].docTypes, undefined);
  await runDocumentAgent({ question: "q", doc_types: [] }, CTX, f);
  assert.equal(f.searches[2].docTypes, undefined);
});

test("no matching text means no model call, and a claim-free answer", async () => {
  // No text, no tokens spent finding that out — and nothing is asserted about
  // documents that were never read.
  const f = fakes({ hits: [] });
  const out = JSON.parse(await runDocumentAgent({ question: "q" }, CTX, f));
  assert.match(out.error, /no document text matched/);
  assert.equal(f.chats.length, 0);
});

// -------------------------------------------------------- what it is sent

test("the excerpts are labelled one-per-citation, which is what the quote rules depend on", async () => {
  const f = fakes();
  await runDocumentAgent({ question: "What is the minimum ratio?" }, CTX, f);
  const { system, user } = f.chats[0];
  assert.equal(system, SPECIALIST_INSTRUCTIONS.document_agent.instructions);
  assert.match(user, /^EXCERPTS/);
  assert.match(user, /\[CA §7\.11\] Credit Agreement/);
  assert.match(user, /\[Amd 2 §3\] Amendment No\. 2/);
  assert.match(user, /QUESTION\nWhat is the minimum ratio\?/);
});

test("research_agent is told which period the gap belongs to", async () => {
  const f = fakes({ reply: '{"mechanism":"unsupported_addback"}' });
  await runResearchAgent({ gap: "we compute 1.08, they report 1.31" }, CTX, f);
  assert.equal(f.chats[0].system, SPECIALIST_INSTRUCTIONS.research_agent.instructions);
  assert.match(f.chats[0].user, /THE GAP \(test period ended 2026-06-30\)/);
  assert.match(f.chats[0].user, /we compute 1\.08, they report 1\.31/);
});

test("a missing or empty question is refused with the shape to send, not with a guess", async () => {
  for (const args of [{}, { question: "" }, { question: "   " }, null, "a string", { gap: "wrong field" }]) {
    const out = JSON.parse(await runDocumentAgent(args, CTX, fakes()));
    assert.match(out.error, /send \{"question"/, JSON.stringify(args));
  }
  for (const args of [{}, { gap: "" }, { question: "wrong field" }]) {
    const out = JSON.parse(await runResearchAgent(args, CTX, fakes()));
    assert.match(out.error, /send \{"gap"/, JSON.stringify(args));
  }
});

test("an over-long question is cut rather than refused, because the content still matters", async () => {
  const f = fakes();
  await runDocumentAgent({ question: "x".repeat(5000) }, CTX, f);
  assert.equal(f.searches[0].query.length, 2000);
});

// ------------------------------------------------------- definition_agent

test("definition_agent takes no arguments and reuses the analyst-facing mapper", async () => {
  // Same code path as the covenant setup screen: five targeted queries, and it
  // refuses to propose a threshold it cannot verify in a retrieved chunk.
  const asked = [];
  const propose = async (facilityId) => {
    asked.push(facilityId);
    return { found: true, terms: { threshold: { min_dscr: 1.25 } }, source_citations: [{ field: "threshold.min_dscr", citation: "CA §7.11", quote: "1.25 to 1.00" }], excerpts: HITS };
  };
  const out = JSON.parse(await runDefinitionAgent({ facility_id: OTHER_FACILITY }, CTX, { propose }));
  assert.deepEqual(asked, [CTX.facilityId]);
  assert.deepEqual(out.terms, { threshold: { min_dscr: 1.25 } });
  assert.equal(out.source_citations.length, 1);
  // `excerpts` is the whole retrieved corpus; returning it would swamp the
  // orchestrator's context, and the citations carry the provenance it needs.
  assert.equal(out.excerpts, undefined);
});

test("a mapping that could not be verified comes back as the reason, never as terms", async () => {
  const propose = async () => ({ found: false, reason: "The model proposed a minimum DSCR, but it could not be verified." });
  const out = JSON.parse(await runDefinitionAgent({}, CTX, { propose }));
  assert.match(out.error, /could not be verified/);
  assert.equal(out.terms, undefined);
});

// ----------------------------------------------------------- the registry

test("every specialist the prompt offers has a runner, and nothing else does", () => {
  assert.deepEqual(Object.keys(SPECIALIST_RUNNERS).sort(), [...SPECIALIST_NAMES].sort());
});

test("a specialist that throws is not caught here: the orchestrator turns it into evidence", async () => {
  await assert.rejects(
    () => runDocumentAgent({ question: "q" }, CTX, { search: async () => { throw new Error("pgvector is down"); } }),
    /pgvector is down/,
  );
});
