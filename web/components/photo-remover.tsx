"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// "Remove" on a photo of the specimen page (#34), drawn only while the plant
// has more than one photo. Two taps on purpose, like "Remove this plant": the
// first arms it in place (the pill turns white and says "Yes, remove"), the
// second calls DELETE /api/plants/[id]/photos/[photoId] and refreshes, so the
// timeline, the count and the hero come back from the server. A tap anywhere
// else, Escape, or five seconds put it back. It sits in the photo's top-right
// corner beside the photo's link (never inside it), and every state draws
// over the photo, so nothing on the page moves. The pill is smaller than the
// button: the button's padding keeps the target at 44 px on the 120 px tiles.
const DISARM_MS = 5000;

type State = "rest" | "armed" | "busy" | "error";

const LABEL: Record<State, string> = { rest: "Remove", armed: "Yes, remove", busy: "Removing…", error: "Not removed" };

export function PhotoRemover({ plantId, photoId, caption, small = false }: { plantId: number; photoId: number; caption: string; small?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>("rest");
  const [error, setError] = useState("");

  useEffect(() => {
    if (state !== "armed" && state !== "error") return;
    const timer = window.setTimeout(() => setState("rest"), DISARM_MS);
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setState("rest");
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState("rest");
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [state]);

  async function press() {
    if (state === "busy") return;
    if (state !== "armed") {
      setState("armed");
      return;
    }
    setState("busy");
    try {
      const r = await fetch(`/api/plants/${plantId}/photos/${photoId}`, { method: "DELETE" });
      if (!r.ok) {
        if (r.status === 404 || r.status === 409) router.refresh(); // this page is out of date: another tab got there first
        throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `server ${r.status}`);
      }
      router.refresh(); // stays "Removing…" until the refreshed page drops this photo
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not remove it");
      setState("error");
    }
  }

  // "the photo taken Oct 12, 2026": every photo's button names its own photo.
  const what = `the photo ${caption.charAt(0).toLowerCase()}${caption.slice(1)}`;
  const name = { rest: `Remove ${what}`, armed: `Yes, remove ${what}`, busy: `Removing ${what}`, error: `Not removed: ${what}` }[state];
  const armed = state === "armed";
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => void press()}
        aria-label={name}
        aria-busy={state === "busy"}
        title={state === "error" ? `Could not remove it: ${error}` : undefined}
        className="group absolute right-0 top-0 flex max-w-full cursor-pointer p-3 focus-visible:outline-none"
      >
        <span
          className={`inline-flex min-w-0 items-center rounded-pill font-bold transition-colors duration-[120ms] group-focus-visible:shadow-[0_0_0_2px_#fff] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-moss ${
            small ? "gap-1 px-2 py-1 text-[11px]" : "gap-1.5 px-3 py-1.5 text-[13px]"
          } ${armed ? "bg-surface text-ink" : "bg-[rgba(30,42,28,.82)] text-white group-hover:bg-[rgba(30,42,28,.94)]"}`}
        >
          <svg aria-hidden width={small ? 12 : 14} height={small ? 12 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
            <path d="M4 7h16" />
            <path d="M9 7V4h6v3" />
            <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
            <path d="M10 11v6M14 11v6" />
          </svg>
          <span className="truncate">{LABEL[state]}</span>
        </span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {armed ? "Press again to remove it." : state === "error" ? `Could not remove it: ${error}` : ""}
      </span>
    </>
  );
}
