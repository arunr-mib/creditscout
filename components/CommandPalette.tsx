"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABEL, filterSearch, type SearchItem } from "./searchModel";

/**
 * Global search / command palette (audit 3.9). ⌘K (or Ctrl-K) opens it; typing
 * filters borrowers, cases, documents, terms and lessons; ↑/↓ move, Enter
 * navigates, Esc closes. A native <dialog> traps focus so there is no custom
 * focus handling to get wrong.
 */
export function CommandPalette({ items }: { items: SearchItem[] }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => filterSearch(items, query), [items, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQuery("");
      setActive(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const go = (item: SearchItem) => {
    setOpen(false);
    router.push(item.href);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="flex items-center justify-between gap-2 rounded-full border border-brand-on/20 bg-brand-on/10 px-3 py-1 text-label text-brand-on-2 transition-colors duration-fast hover:bg-brand-on/20 hover:text-brand-on focus-visible:ring-mint focus-visible:ring-offset-brand md:w-menu"
      >
        <span>Search…</span>
        <kbd className="hidden rounded-sm border border-brand-on/20 px-1 font-mono text-badge md:inline">⌘K</kbd>
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-label="Search"
        className="m-auto mt-16 w-full max-w-dialog rounded-2xl border border-border-strong bg-surface p-0 text-text-secondary backdrop:bg-brand/60"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Search borrowers, cases, documents, terms, lessons…"
          aria-label="Search query"
          className="w-full rounded-t-2xl border-b border-border bg-transparent px-4 py-3 text-body text-text placeholder:text-text-muted focus-visible:outline-none"
        />
        <ul className="max-h-[320px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-4 text-label text-text-muted">No matches. Try a borrower, period, or case.</li>
          ) : (
            results.map((item, i) => (
              <li key={`${item.href}-${i}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    i === active ? "bg-surface-raised" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-body text-text">{item.label}</span>
                    {item.sublabel && <span className="block truncate text-label text-text-muted">{item.sublabel}</span>}
                  </span>
                  <span className="shrink-0 rounded-sm border border-border px-2 text-badge text-text-muted">{KIND_LABEL[item.kind]}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </dialog>
    </>
  );
}
