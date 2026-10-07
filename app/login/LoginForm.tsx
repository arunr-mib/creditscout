"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type SignInState } from "./actions";

const initial: SignInState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 rounded-md bg-model-bg px-4 py-2 text-card text-model-bright transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1">
        <span className="text-label text-text-muted">Username</span>
        <input
          name="username"
          autoComplete="username"
          autoFocus
          className="rounded-md border border-border-strong bg-bg px-3 py-2 text-body text-text outline-none focus:border-model"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-label text-text-muted">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className="rounded-md border border-border-strong bg-bg px-3 py-2 text-body text-text outline-none focus:border-model"
        />
      </label>
      {state.error && (
        <p role="alert" className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-body text-danger">
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
