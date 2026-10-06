import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDscr } from "../../../calc/dscr.js";

/**
 * The wrapper around the pure calculator, and the ONLY place a `calc_id` is
 * minted. The model asks for a calculation; it cannot perform one, and it
 * cannot invent the id either. The guardrail later checks every figure in an
 * explanation against the `calc_log` row this function writes, so a number
 * without a row here is a number nothing can vouch for.
 *
 * Nothing in this file computes, rounds or adjusts a figure. It validates the
 * SHAPE of the request, calls `computeDscr`, and logs what came back.
 */

export interface ToolResult {
  status: number;
  body: Record<string, unknown>;
}

export interface CalculatorDeps {
  /** A service-role client. Defaults to `supabaseAdmin()`, loaded lazily so tests never import the server-only module. */
  client?: Pick<SupabaseClient, "from">;
  /** Where the calc_id comes from. Defaults to `crypto.randomUUID()`; tests inject a fixed one. */
  newId?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINANCIAL_FIELDS = ["ebitda", "unfinanced_capex", "cash_taxes", "scheduled_principal", "cash_interest"];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const bad = (error: string): ToolResult => ({ status: 400, body: { error } });

/**
 * Shape checks, returning the first field that is malformed or null.
 *
 * What is checked here is what the calculator would otherwise ACCEPT SILENTLY:
 * it reads `addbacks`, `deductions` and `components` with
 * `Array.isArray(x) ? x : []`, so `addbacks: {...}` (an object where a list
 * belongs) would be treated as "no add-backs" and return a confident, wrong
 * ratio. A figure that is present but not a number is likewise rejected rather
 * than coerced. What is merely ABSENT is not checked: the calculator reports a
 * missing input as `{error}`, which the agent reasons about as evidence.
 */
function malformedField(terms: unknown, financials: unknown): string | null {
  if (!isObject(terms)) return "terms must be an object";
  if (!isObject(financials)) return "financials must be an object";

  if (terms.threshold !== undefined && !isObject(terms.threshold)) return "terms.threshold must be an object";
  const minDscr = isObject(terms.threshold) ? terms.threshold.min_dscr : undefined;
  if (minDscr !== undefined && minDscr !== null && !isNumber(minDscr)) {
    return "terms.threshold.min_dscr must be a number";
  }

  if (terms.numerator !== undefined && !isObject(terms.numerator)) return "terms.numerator must be an object";
  if (isObject(terms.numerator)) {
    const { addbacks, deductions } = terms.numerator;
    if (addbacks !== undefined && !Array.isArray(addbacks)) return "terms.numerator.addbacks must be an array";
    if (deductions !== undefined && !Array.isArray(deductions)) return "terms.numerator.deductions must be an array";
  }

  if (terms.denominator !== undefined && !isObject(terms.denominator)) return "terms.denominator must be an object";
  if (isObject(terms.denominator) && terms.denominator.components !== undefined) {
    if (!Array.isArray(terms.denominator.components)) return "terms.denominator.components must be an array";
  }

  for (const field of FINANCIAL_FIELDS) {
    const v = financials[field];
    if (v !== undefined && v !== null && !isNumber(v)) return `financials.${field} must be a number`;
  }
  const amounts = financials.addback_amounts;
  if (amounts !== undefined && amounts !== null) {
    if (!isObject(amounts)) return "financials.addback_amounts must be an object";
    for (const [name, v] of Object.entries(amounts)) {
      if (v !== null && !isNumber(v)) return `financials.addback_amounts["${name}"] must be a number`;
    }
  }
  return null;
}

async function defaultClient(): Promise<Pick<SupabaseClient, "from">> {
  const { supabaseAdmin } = await import("../../supabase/server.ts");
  return supabaseAdmin();
}

/** Postgres foreign_key_violation: here, a casefile_id that names no casefile. */
const FOREIGN_KEY_VIOLATION = "23503";

export async function runDscrCalculator(body: unknown, deps: CalculatorDeps = {}): Promise<ToolResult> {
  if (!isObject(body)) return bad("request body must be a JSON object");
  const { terms, financials, casefile_id } = body;

  const problem = malformedField(terms, financials);
  if (problem) return bad(problem);

  if (casefile_id !== undefined && casefile_id !== null) {
    if (typeof casefile_id !== "string" || !UUID.test(casefile_id)) return bad("casefile_id must be a UUID");
  }

  // The id is minted here, before the call, and handed in. The pure function
  // never generates one, so its tests stay deterministic.
  const calcId = (deps.newId ?? randomUUID)();
  const result = computeDscr(terms as object, financials as object, { calcId }) as Record<string, unknown>;

  // A calculator error is evidence ("this input is missing"), not an outage:
  // 200, and no calc_log row, because there is no number to trace.
  if ("error" in result) return { status: 200, body: { error: result.error } };

  const client = deps.client ?? (await defaultClient());
  const { error } = await client.from("calc_log").insert({
    calc_id: calcId,
    casefile_id: casefile_id ?? null,
    inputs: { terms, financials },
    outputs: result,
    calculator_version: result.calculator_version,
  });
  if (error) {
    // Never return a number that was not logged: the guardrail could not vouch for it.
    if (error.code === FOREIGN_KEY_VIOLATION) return bad("casefile_id does not match any casefile");
    console.error("calc_log insert failed", error.message);
    return { status: 500, body: { error: "calculation could not be logged" } };
  }
  return { status: 200, body: result };
}
