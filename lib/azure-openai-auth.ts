/**
 * Auth for the data-plane Azure OpenAI calls — embeddings and the specialist /
 * definition chat.
 *
 * Locally the resource's api-key is used (simple, and the credential the owner
 * has). On a deployment the api-key is fragile to configure and the resource may
 * prefer Microsoft Entra, so when a service principal is set
 * (`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`AZURE_TENANT_ID`) we take an Entra
 * token instead — the SAME service principal that authenticates Foundry — and
 * send it as a Bearer. Then no api-key is needed on the deploy at all.
 *
 * The SP needs a data-plane role on the Azure OpenAI resource:
 * "Cognitive Services OpenAI User" (preferred) or "Cognitive Services User".
 */

/** Azure OpenAI's Entra data-plane scope (distinct from Foundry's https://ai.azure.com). */
const SCOPE = "https://cognitiveservices.azure.com/.default";
const SKEW_MS = 5 * 60_000;

let cached: { token: string; expiresAt: number } | null = null;

/** Only for tests. */
export function clearAzureOpenAiTokenCache(): void {
  cached = null;
}

async function entraToken(now: () => number): Promise<string | null> {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenantId = process.env.AZURE_TENANT_ID;
  if (!clientId || !clientSecret || !tenantId) return null; // no SP → use the api-key

  if (cached && cached.expiresAt - SKEW_MS > now()) return cached.token;

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`Azure OpenAI Entra token request failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const parsed = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token) throw new Error("the Azure OpenAI Entra token response carried no access_token");
  cached = { token: parsed.access_token, expiresAt: now() + (Number(parsed.expires_in) || 3600) * 1000 };
  return cached.token;
}

/**
 * The auth header(s) for a data-plane Azure OpenAI request: a Bearer Entra token
 * when a service principal is configured, otherwise the api-key. Throws if
 * neither is available, so a misconfigured deploy fails loudly, not silently.
 */
export async function azureOpenAiAuthHeaders(now: () => number = Date.now): Promise<Record<string, string>> {
  const token = await entraToken(now);
  if (token) return { authorization: `Bearer ${token}` };

  const key = process.env.AZURE_OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "Azure OpenAI auth is not configured: set AZURE_OPENAI_API_KEY, or a service principal (AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/AZURE_TENANT_ID) with a Cognitive Services OpenAI User role.",
    );
  }
  return { "api-key": key };
}
