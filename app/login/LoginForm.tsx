"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type SignInState } from "./actions";

const initial: SignInState = { error: null };

/** How long the filled credentials stay on screen before the form submits itself. */
const FILL_PAUSE_MS = 450;

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

export function LoginForm({ next, demo }: { next: string; demo: { username: string; password: string } }) {
  const [state, action] = useActionState(signIn, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [filled, setFilled] = useState(false);

  /**
   * Submit only AFTER React has committed the filled values.
   *
   * Calling requestSubmit() straight from the click handler posts whatever is
   * in the DOM at that moment — which is still empty, because the state set
   * beside it has not rendered yet. Hanging it off an effect keyed on `filled`
   * guarantees the inputs hold the credentials before the form is sent.
   *
   * The pause is deliberate rather than incidental: the credentials visibly
   * land in the fields, so a viewer sees what was entered instead of the page
   * simply jumping.
   */
  useEffect(() => {
    if (!filled) return;
    const timer = setTimeout(() => formRef.current?.requestSubmit(), FILL_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [filled]);

  const field =
    "rounded-md border border-border-strong bg-bg px-3 py-2 text-body text-text outline-none focus:border-model";

  return (
    <>
      <div className="rounded-lg border border-border-strong bg-surface p-6">
        <form ref={formRef} action={action} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <label className="flex flex-col gap-1">
            <span className="text-label text-text-muted">Username</span>
            <input
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label text-text-muted">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </label>
          {state.error && (
            <p role="alert" className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-body text-danger">
              {state.error}
            </p>
          )}
          <SubmitButton />
        </form>
      </div>

      <DemoAccess
        demo={demo}
        filled={filled}
        onUse={() => {
          setUsername(demo.username);
          setPassword(demo.password);
          setFilled(true);
        }}
      />
    </>
  );
}

/**
 * The demo credential, as a control rather than a note: one click fills both
 * fields and signs in. It still READS as the credential, because an analyst
 * opening this page cold needs to see what the credential is, not just a button
 * that does something to them.
 */
function DemoAccess({
  demo,
  filled,
  onUse,
}: {
  demo: { username: string; password: string };
  filled: boolean;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onUse}
      disabled={filled}
      aria-label={`Fill the demo credentials and sign in as ${demo.username}`}
      className="group w-full rounded-md border border-border bg-surface p-3 text-left transition-colors duration-fast hover:border-model disabled:cursor-not-allowed"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-label text-text-muted">Demo access</span>
        <span className="text-label text-model-bright">
          {filled ? "Signing in…" : "Click to fill and sign in"}
        </span>
      </span>
      <span className="mt-1 block text-body text-text-secondary">
        Username <span className="font-mono text-text">{demo.username}</span> · Password{" "}
        <span className="font-mono text-text">{demo.password}</span>
      </span>
    </button>
  );
}
