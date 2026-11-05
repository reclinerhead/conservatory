"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { entry, type GlossaryKey } from "@/lib/glossary";

// The info mark from design/DESIGN.md §4: an 18 px ring after the term, an
// "i" in moss, and on tap a sage note block that explains the term. The note
// floats over the page (anchored under the mark) rather than expanding in
// place, so opening one never moves anything else: the no-layout-shift rule
// outranks the mockup's inline block. A note that would cross the window's
// right edge (a mark near the side column's edge) slides left until it fits,
// so it never widens the page. Closes on tap outside, Escape, or the mark
// again.
const NOTE_GUTTER = 16;

export function Term({ k, children, example }: { k: GlossaryKey; children?: React.ReactNode; example?: string }) {
  const e = entry(k);
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const noteRef = useRef<HTMLSpanElement>(null);

  // Before the note paints: past the right edge, slide it left by the
  // overflow, never so far that its left edge leaves the gutter.
  useLayoutEffect(() => {
    const note = noteRef.current;
    if (!open || !note) return;
    const r = note.getBoundingClientRect();
    const over = r.right - (document.documentElement.clientWidth - NOTE_GUTTER);
    if (over > 0) note.style.translate = `${-Math.min(over, Math.max(0, r.left - NOTE_GUTTER))}px 0`;
  }, [open]);

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
    <span ref={ref} className="relative inline">
      {children ?? e.term}
      <button
        type="button"
        aria-label={`What does ${e.term} mean?`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-flex h-[18px] w-[18px] translate-y-[-1px] items-center justify-center rounded-full border border-line-strong bg-surface align-middle font-sans text-[11px] font-bold leading-none text-moss hover:bg-sage"
      >
        i
      </button>
      {open ? (
        <span
          ref={noteRef}
          id={id}
          role="note"
          className="absolute left-0 top-full z-20 mt-2 block w-[min(22rem,calc(100vw-2rem))] rounded-tile border border-line bg-sage p-4 text-body font-normal normal-case not-italic tracking-normal text-ink shadow-hover"
        >
          <span className="block font-bold">{e.term}</span>
          <span className="mt-1 block">{e.text}</span>
          {example ? <span className="mt-2 block text-ink-2">{example}</span> : null}
          {e.more ? (
            <a href={e.more} target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold">
              More on Wikipedia
            </a>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
