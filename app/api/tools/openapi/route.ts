import { NextResponse } from "next/server";
import { buildOpenApi } from "@/lib/agent/openapi";

export const runtime = "nodejs";
// servers[0].url comes from PUBLIC_BASE_URL at request time; do not bake it in at build.
export const dynamic = "force-dynamic";

/** Public on purpose: it describes the tools and carries no secret. */
export function GET() {
  return NextResponse.json(buildOpenApi());
}
