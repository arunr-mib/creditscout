import { DOC_TYPES, DEFAULT_K, MAX_K } from "../retrieval.ts";

/**
 * The OpenAPI 3.0 description of the agent tool endpoints, as data. Foundry
 * registers this document; a spec that drifts from the routes fails at
 * agent-registration time, far from here. lib/agent/openapi.test.js asserts that
 * every path below has a route and every route has a path.
 *
 * Spec §8.3: commit this file after every change.
 */

export const DEFAULT_BASE_URL = "http://localhost:3000";
export const SECURITY_SCHEME = "ToolKey";

/** The header name as it appears on the wire (the auth check reads it case-insensitively). */
export const HEADER_NAME = "X-CreditScout-Tool-Key";

const secured = [{ [SECURITY_SCHEME]: [] }];

const errorBody = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
    },
  },
});

const unauthorizedResponse = errorBody('Missing, wrong or unconfigured tool key. The body is always {"error":"unauthorized"}.');

const number = { type: "number" };
const uuid = { type: "string", format: "uuid" };

const dscrTerms = {
  type: "object",
  description: "Executable covenant terms, as approved for the facility.",
  required: ["threshold", "numerator", "denominator"],
  properties: {
    test_period: { type: "object", properties: { basis: { type: "string" }, period_end: { type: "string", format: "date" } } },
    threshold: {
      type: "object",
      required: ["min_dscr"],
      properties: { min_dscr: number, citation: { type: "string" } },
    },
    numerator: {
      type: "object",
      required: ["addbacks", "deductions"],
      properties: {
        base: { type: "string" },
        addbacks: {
          type: "array",
          description: "A missing or null cap means the add-back is uncapped, never zero.",
          items: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
              amount_source: { type: "string" },
              cap: { type: "number", nullable: true },
              citation: { type: "string" },
            },
          },
        },
        deductions: { type: "array", items: { type: "string", enum: ["unfinanced_capex", "cash_taxes"] } },
      },
    },
    denominator: {
      type: "object",
      required: ["components"],
      properties: {
        components: { type: "array", items: { type: "string", enum: ["scheduled_principal", "cash_interest"] } },
        citation: { type: "string" },
      },
    },
    effective_amendments: { type: "array", items: { type: "object" } },
  },
};

const dscrFinancials = {
  type: "object",
  description:
    "The period's figures, each quoted from a cited document. A figure you cannot cite is missing: omit it and the tool says so. Never send 0 for a figure you do not have.",
  // Deliberately no `required` list: the description tells the agent to omit a
  // figure it cannot cite, so the schema must not call it mandatory. A mandatory
  // field invites the model to send 0, a fabricated figure that looks real.
  properties: {
    ebitda: number,
    addback_amounts: { type: "object", additionalProperties: number, description: "Keyed by add-back name from the terms." },
    unfinanced_capex: number,
    cash_taxes: number,
    scheduled_principal: number,
    cash_interest: number,
  },
};

const citation = { type: "string" };

/**
 * Where each figure in `financials` was read: the same keys, one citation
 * string per figure. The route verifies every figure against the labelled line
 * of the chunk its citation names, in the test period's financials, before it
 * calculates anything (spec §4.2). Required as a whole; an individual figure's
 * citation missing is reported as missing evidence (HTTP 200), not a malformed
 * request.
 */
const dscrFinancialCitations = {
  type: "object",
  description:
    'For every figure sent in financials, the citation of the financials chunk it was read from, in the label form search_documents returns (for example "Fin Q2 2026 §1"). Same keys as financials, addback_amounts included. A figure with no citation, a citation that is not the test period\'s financials, or a figure that is not the one printed on that field\'s labelled line in the cited chunk returns an error body (HTTP 200) and no calculation.',
  properties: {
    ebitda: citation,
    addback_amounts: { type: "object", additionalProperties: citation, description: "Keyed by add-back name, exactly as in financials.addback_amounts." },
    unfinanced_capex: citation,
    cash_taxes: citation,
    scheduled_principal: citation,
    cash_interest: citation,
  },
};

const dscrSuccess = {
  type: "object",
  required: ["calc_id", "components", "dscr", "threshold", "pass", "margin", "calculator_version"],
  properties: {
    calc_id: { ...uuid, description: "Cite this id. Every figure in your explanation must trace to a calculation with an id." },
    components: { type: "object", description: "Every intermediate figure, including the add-backs claimed versus applied." },
    dscr: number,
    threshold: number,
    pass: { type: "boolean" },
    margin: number,
    calculator_version: { type: "string" },
  },
};

const dscrCalculatorError = {
  type: "object",
  required: ["error"],
  description:
    "The calculation could not be performed (for example a missing input, or a figure the cited financials chunk does not state). This is evidence, not an outage; no calc_id exists.",
  properties: { error: { type: "string" } },
};

const documentHit = {
  type: "object",
  required: ["content", "citation", "section", "doc_title", "doc_type", "score"],
  properties: {
    content: { type: "string", description: "The chunk text. Quote from it verbatim." },
    citation: { type: "string", description: 'Cite exactly this string, for example "CA §7.11" or "Amd 2 §3".' },
    section: { type: "string", nullable: true },
    doc_title: { type: "string", nullable: true },
    doc_type: { type: "string", enum: [...DOC_TYPES], nullable: true },
    score: { type: "number", description: "Cosine similarity, higher is closer." },
  },
};

const pastCaseHit = {
  type: "object",
  required: ["lesson_text", "pattern_tag", "case_summary", "similarity"],
  properties: {
    lesson_text: { type: "string", nullable: true },
    pattern_tag: { type: "string", nullable: true },
    case_summary: { type: "string", nullable: true },
    similarity: { type: "number" },
  },
};

const json = (schema: object) => ({ "application/json": { schema } });

/** The document, with `servers[0].url` taken from `PUBLIC_BASE_URL` (or localhost for local work). */
export function buildOpenApi(env: Record<string, string | undefined> = process.env) {
  const base = (env.PUBLIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    openapi: "3.0.3",
    info: {
      title: "CreditScout agent tools",
      version: "1.0.0",
      description:
        "Tools the CreditScout agent calls. The agent cannot compute a ratio itself: it asks dscr_calculator for one and cites the calc_id that comes back.",
    },
    servers: [{ url: base }],
    security: secured,
    components: {
      securitySchemes: {
        [SECURITY_SCHEME]: { type: "apiKey", in: "header", name: HEADER_NAME },
      },
    },
    paths: {
      "/api/tools/dscr-calculator": {
        post: {
          operationId: "dscr_calculator",
          summary: "Compute DSCR from covenant terms and the period's financials",
          description:
            "The only source of a DSCR figure. Returns a calc_id for every successful calculation. Each financial figure is verified against its labelled line in the test period's financials chunk cited for it before anything is calculated. A missing input, or a figure that cannot be verified, returns an error body (HTTP 200), not a number.",
          security: secured,
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["terms", "financials", "financial_citations", "facility_id", "period_end"],
              properties: {
                terms: dscrTerms,
                financials: dscrFinancials,
                financial_citations: dscrFinancialCitations,
                facility_id: { ...uuid, description: "The facility whose financials the citations are read against." },
                period_end: { type: "string", format: "date", description: "The test period end; the citations must name that quarter's financials." },
                casefile_id: { ...uuid, description: "The casefile this calculation belongs to, if any." },
              },
            }),
          },
          responses: {
            "200": {
              description: "A calculation, or an explained failure to calculate (a missing input, or a figure its citation does not support).",
              content: json({ oneOf: [dscrSuccess, dscrCalculatorError] }),
            },
            "400": errorBody("The request is malformed; the error names the field."),
            "401": unauthorizedResponse,
          },
        },
      },
      "/api/tools/search-documents": {
        post: {
          operationId: "search_documents",
          summary: "Search one facility's documents",
          description:
            "Semantic search restricted to the given facility. Pass doc_types to read the right kind of document: without it a compliance certificate can outrank the credit agreement for a covenant definition.",
          security: secured,
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["facility_id", "query"],
              properties: {
                facility_id: uuid,
                query: { type: "string", maxLength: 2000 },
                doc_types: { type: "array", items: { type: "string", enum: [...DOC_TYPES] } },
                k: { type: "integer", minimum: 1, maximum: MAX_K, default: DEFAULT_K },
              },
            }),
          },
          responses: {
            "200": { description: "Matching chunks, best first.", content: json({ type: "array", items: documentHit }) },
            "400": errorBody("The request is malformed; the error names the field."),
            "401": unauthorizedResponse,
          },
        },
      },
      "/api/tools/search-past-cases": {
        post: {
          operationId: "search_past_cases",
          summary: "Search lessons learned from analyst reviews",
          description:
            "Memory search. It deliberately spans facilities: a lesson from one borrower informs the next. facility_id is context, not a filter. Returns an empty array when there are no lessons.",
          security: secured,
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["facility_id", "exception_profile"],
              properties: {
                facility_id: uuid,
                exception_profile: { type: "string", maxLength: 2000 },
                k: { type: "integer", minimum: 1, maximum: MAX_K, default: 3 },
                run_id: { type: "string", default: "demo" },
              },
            }),
          },
          responses: {
            "200": { description: "Matching lessons, best first.", content: json({ type: "array", items: pastCaseHit }) },
            "400": errorBody("The request is malformed; the error names the field."),
            "401": unauthorizedResponse,
          },
        },
      },
    },
  };
}
