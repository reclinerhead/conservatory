"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState } from "react";
import Lightbox, { type ControllerRef } from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";

// A photo full size without leaving the page (#46): the plant's page and the
// species page wrap their photo section in PhotoLightbox and make each photo
// an OpenPhoto. yet-another-react-lightbox with its Zoom and Counter plugins
// and nothing else: the page's own grid is the thumbnails, and the viewport
// is the size. Its colours come from the tokens (globals.css); the
// stylesheets are imported here, so only the two pages that use it load them.
//
// Under each slide, its caption from the page and one action: on a plant's
// page "Use as main photo" (or "Main photo" on the one it is known by), on
// the species page the link the photo used to be (its plant's page, or the
// reference's licence on Commons). The open slide is held by key, not by
// position, so when saving a main photo refreshes the page and reorders the
// photos main first, the lightbox stays on the photo just chosen.

export type PhotoSlide = {
  key: string;
  src: string; // the stored photo, never a thumbnail
  alt: string;
  caption: string; // the page's pill, e.g. "Taken Oct 31, 2026"
  photoId?: number; // a plant's own photo, which can be made its main photo
  main?: boolean; // the photo the plant is known by
  link?: { href: string; label: string; external: boolean };
};

const Open = createContext<(key: string) => void>(() => {});

/** The page's caption pill, as on the photos themselves. */
const PILL = "rounded-pill bg-[rgba(30,42,28,.82)] px-3 py-1.5 text-[13px] font-semibold text-white";
/** A white pill on the dark backdrop: 44 px, the app's button shape. */
const ACTION =
  "inline-flex min-h-[44px] items-center gap-2 rounded-pill bg-surface px-4 text-[14px] font-bold text-ink hover:bg-sage hover:text-ink hover:no-underline focus-visible:outline-white";

export function PhotoLightbox({
  slides,
  title,
  plantId,
  children,
}: {
  slides: PhotoSlide[];
  title: string; // names the dialog: "Photos of Granddaddy"
  plantId?: number; // set on a plant's page with more than one photo: offers "Use as main photo"
  children: React.ReactNode;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<number | null>(null); // saved as main, until the refresh shows it as such
  const controller = useRef<ControllerRef>(null);
  const index = Math.max(0, slides.findIndex((s) => s.key === openKey));
  const several = slides.length > 1;
  return (
    <Open value={setOpenKey}>
      {children}
      <Lightbox
        open={openKey !== null}
        close={() => setOpenKey(null)}
        index={index}
        slides={slides}
        plugins={several ? [Zoom, Counter] : [Zoom]}
        on={{ view: ({ index: i }) => setOpenKey((k) => (k === null ? null : (slides[i]?.key ?? k))) }}
        zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }}
        counter={{ separator: "of" }}
        carousel={{ finite: true, padding: 16 }}
        controller={{ ref: controller, closeOnBackdropClick: true }}
        labels={{ Previous: "Previous photo", Next: "Next photo", Close: "Close", Lightbox: title }}
        render={{
          buttonPrev: several ? undefined : () => null,
          buttonNext: several ? undefined : () => null,
          slideFooter: ({ slide }) => <Footer slide={slide as PhotoSlide} main={plantId === undefined ? undefined : { plantId, chosenId, onChosen: setChosenId, refocus: () => controller.current?.focus() }} />,
        }}
      />
    </Open>
  );
}

/** A photo on the page as a button that opens the lightbox on it. */
export function OpenPhoto({ slideKey, label, className = "", children }: { slideKey: string; label: string; className?: string; children: React.ReactNode }) {
  const open = useContext(Open);
  return (
    <button type="button" onClick={() => open(slideKey)} aria-label={label} title={label} className={`block cursor-zoom-in ${className}`}>
      {children}
    </button>
  );
}

// refocus: the pressed button goes disabled and then gives way to "Main photo",
// which would drop focus to the page, out of reach of the lightbox's keys
// (Escape, the arrows). Focus goes back to the lightbox before the save.
type MainProps = { plantId: number; chosenId: number | null; onChosen: (photoId: number) => void; refocus: () => void };

/**
 * Under the slide: the caption at the left, the action at the right, wrapping
 * to two rows on a phone. It lets taps through between the two, so a tap on
 * the backdrop beside them still closes the lightbox.
 */

function Footer({ slide, main }: { slide: PhotoSlide; main?: MainProps }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 p-4 sm:p-5">
      <span className={`${PILL} pointer-events-auto max-w-full truncate`}>{slide.caption}</span>
      {main && slide.photoId !== undefined ? (
        <MainPhoto {...main} slide={slide} />
      ) : slide.link ? (
        slide.link.external ? (
          <a href={slide.link.href} target="_blank" rel="noreferrer" className={`${ACTION} pointer-events-auto`}>
            {slide.link.label}
          </a>
        ) : (
          <Link href={slide.link.href} className={`${ACTION} pointer-events-auto`}>
            {slide.link.label}
          </Link>
        )
      ) : null}
    </div>
  );
}

/**
 * "Use as main photo" on any of the plant's photos but its main one, which
 * says "Main photo" in the same place instead, so nothing shifts as the
 * person moves through the slides. Saves with PATCH /api/plants/[id], then
 * refreshes: the page comes back with this photo as the hero. It says
 * "Saving…" until the refreshed page shows the photo as main.
 */
function MainPhoto({ plantId, chosenId, onChosen, refocus, slide }: MainProps & { slide: PhotoSlide }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = chosenId === slide.photoId;

  if (slide.main)
    return (
      <span className={`${PILL} pointer-events-auto inline-flex min-h-[44px] items-center gap-2 px-4`}>
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        Main photo
      </span>
    );

  async function choose() {
    refocus();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/plants/${plantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ heroPhotoId: slide.photoId }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      onChosen(slide.photoId as number);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "no answer");
    } finally {
      setBusy(false);
    }
  }

  const saving = busy || saved;
  return (
    <>
      <button
        type="button"
        onClick={() => void choose()}
        disabled={saving}
        aria-busy={saving}
        title={error ? `Not saved: ${error}` : undefined}
        className={`${ACTION} pointer-events-auto cursor-pointer disabled:cursor-default disabled:opacity-80`}
      >
        {saving ? "Saving…" : error ? "Not saved. Try again" : "Use as main photo"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {error ? `The main photo was not saved: ${error}` : saved ? "Saved as the main photo." : ""}
      </span>
    </>
  );
}
