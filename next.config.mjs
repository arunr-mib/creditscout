/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: [],
  // The upload goes through a Server Action (default body limit 1 MB); the
  // ingest code enforces its own 10 MB cap. Note Vercel itself caps a function
  // request body at 4.5 MB on the platform.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  // orchestratorAgentId() reads lib/agent/agents.json with fs at runtime. Next
  // does not trace a dynamic readFileSync, so without this the file is absent
  // from the serverless bundle and the deploy cannot find the orchestrator agent
  // id. Include it in the bundles of every route that starts or drives an
  // investigation (the Server Actions on / and /casefiles/[id], and the
  // investigate routes). (A FOUNDRY_ORCHESTRATOR_AGENT_ID env var overrides it.)
  outputFileTracingIncludes: {
    "/": ["./lib/agent/agents.json"],
    "/casefiles/[id]": ["./lib/agent/agents.json"],
    "/api/investigate": ["./lib/agent/agents.json"],
    "/api/investigate/sync": ["./lib/agent/agents.json"],
  },
};
