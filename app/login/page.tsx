import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { Logo } from "@/components/Logo";
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
            <Logo className="h-8 w-auto" />
            <h1 className="text-title text-text">Sign in</h1>
            <p className="text-body text-text-secondary">Enter the demo credentials to open the analyst workspace.</p>
          </div>

          {/* The form and the demo-credential card share state (one click fills
              and submits), so the card is rendered by LoginForm, not here. */}
          <LoginForm next={safeNext(next)} demo={creds} />

          <Link href="/welcome" className="text-label text-text-muted underline-offset-2 hover:underline">
            ← Back to overview
          </Link>
        </div>
      </div>
    </main>
  );
}
