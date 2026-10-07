/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: [],
  // The upload goes through a Server Action (default body limit 1 MB); the
  // ingest code enforces its own 10 MB cap. Note Vercel itself caps a function
  // request body at 4.5 MB on the platform.
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};
