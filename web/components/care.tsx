"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { CareFigure } from "@/lib/care";

// The care sheet's two moving parts. Everything else in the block is server
// rendered from what Fern wrote (app/species/[id]/page.tsx).

/**
 * "2 figures" under a care cell: on tap, the figures the model gave and what
 * each rests on, in a note that floats over the page like the glossary's, so
 * opening it never moves anything. Closes on tap outside, Escape, or again.
 */
export function CareFigures({ figures }: { figures: CareFigure[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative mt-auto pt-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[32px] items-center gap-1.5 rounded-pill text-[13px] font-semibold text-moss hover:text-moss-deep"
      >
        <span aria-hidden className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line-strong bg-surface text-[11px]">
          #
        </span>
        {figures.length === 1 ? "1 figure" : `${figures.length} figures`} and what they rest on
      </button>
      {open ? (
        <div
          id={id}
          role="note"
          className="absolute left-0 top-full z-20 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-tile border border-line bg-sage p-4 text-body text-ink shadow-hover"
        >
          <dl className="flex flex-col gap-2.5">
            {figures.map((f, i) => (
              <div key={i}>
                <dt className="text-meta font-semibold text-ink-2">{f.label}</dt>
                <dd className="font-semibold">{f.value}</dd>
                <dd className="text-meta text-ink-2">{f.basis}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Rewrite": clears the sheet so Fern writes it again on its next idle tick
 * (POST /api/species/[id]/care). While a sheet is on its way the page
 * refreshes itself every few seconds for a few minutes, so the new sheet
 * appears without a reload; it gives up quietly if Fern is not running.
 */
export function CareRewrite({ speciesId, writing, canRewrite }: { speciesId: number; writing: boolean; canRewrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!writing) return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > 36) clearInterval(t); // three minutes
      else router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [writing, router]);

  async function rewrite() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/species/${speciesId}/care`, { method: "POST" });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (writing) return <span className="text-meta text-ink-2">Fern is writing it now</span>;
  if (!canRewrite) return null;
  return (
    <span className="flex items-center gap-3">
      {error ? <span className="text-meta text-warn-ink">{error}</span> : null}
      <button type="button" onClick={() => void rewrite()} disabled={busy} className="btn btn-ghost btn-compact">
        {busy ? "Clearing…" : "Rewrite"}
      </button>
    </span>
  );
}
