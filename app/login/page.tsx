import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { demoCredentials } from "@/lib/auth/gate";

export const dynamic = "force-dynamic";

/** Only a safe internal path is echoed back into the form. */
function safeNext(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const creds = demoCredentials();

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
      <div className="w-full max-w-content">
        <div className="mx-auto flex max-w-sm flex-col gap-6">
          <div className="space-y-1">
            <p className="text-label text-text-muted">CreditScout</p>
            <h1 className="text-title text-text">Sign in</h1>
            <p className="text-body text-text-secondary">Enter the demo credentials to open the analyst workspace.</p>
          </div>

          <div className="rounded-lg border border-border-strong bg-surface p-6">
            <LoginForm next={safeNext(next)} />
          </div>

          <div className="rounded-md border border-border bg-surface p-3">
            <p className="text-label text-text-muted">Demo access</p>
            <p className="mt-1 text-body text-text-secondary">
              Username <span className="font-mono text-text">{creds.username}</span> · Password{" "}
              <span className="font-mono text-text">{creds.password}</span>
            </p>
          </div>

          <Link href="/welcome" className="text-label text-text-muted underline-offset-2 hover:underline">
            ← Back to overview
          </Link>
        </div>
      </div>
    </main>
  );
}
