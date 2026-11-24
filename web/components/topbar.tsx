"use client";

import { HOME_HREF } from "@/lib/base-path";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The top bar from design/DESIGN.md §5: leaf mark and wordmark, a nav pill
// for each page that exists, the primary "Add a plant". Collection is lit on
// the species and plant pages it leads to. One row at every width: on a
// phone the wordmark is the leaf alone. The search is the life list's
// (components/species-grid.tsx). To-do (#103) carries the number still to
// do, zero included, so the bar keeps its shape: it is the notice, on every
// page, that something is waiting. On a phone the pills are tighter and a
// size down so the three and the button stay on the one row at 360 px.
//
// Where there is a launcher (HOME_HREF: a station, and the house since #131)
// the bar starts with Home (#115), the way back to it: a soft pill, 44 px, the house icon
// with the word from lg up and the icon alone below it. To make room, the
// wordmark is the leaf alone below lg there, not only on a phone; and on a
// phone Home takes the leaf's place, and the pills and Add give up a little
// side padding, so the row is no wider at 360 px than without it. Without a
// launcher nothing changes.
const NAV: Array<{ label: string; href: string; also?: string[]; counted?: true }> = [
  { label: "Collection", href: "/", also: ["/species/", "/plants/"] },
  { label: "Tags", href: "/tags" },
  { label: "To-do", href: "/todo", counted: true },
];

export function LeafMark({ size = 30, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 4c-8 0-14 5-14 13 0 1 .1 2 .3 3" />
      <path d="M20 4c0 8-5 14-13 14" />
      <path d="M6 21c2-6 6-10 11-13" />
    </svg>
  );
}

export function TopBar({ todoCount }: { todoCount: number }) {
  const pathname = usePathname();
  const isOn = (item: (typeof NAV)[number]) => pathname === item.href || (item.also ?? []).some((p) => pathname.startsWith(p));
  return (
    <header className="bg-surface border-b border-line">
      <div className="mx-auto flex w-full max-w-page items-center gap-x-2 px-4 py-3 sm:gap-x-6 sm:px-8">
        {/* Home (#115): back to the launcher, at the origin's root on a station
            and at its own address at the house (#131). Not this app's page
            either way, so a plain <a>: <Link> would prefix the base path and
            land on the collection. */}
        {HOME_HREF && (
          <a href={HOME_HREF} className="btn btn-soft hover:no-underline max-lg:px-3">
            <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5.5 10v9.5h13V10" />
              <path d="M10 19.5v-5h4v5" />
            </svg>
            <span className="max-lg:sr-only">Home</span>
          </a>
        )}
        <Link href="/" className={`flex items-center gap-2 font-display text-xl font-medium text-ink hover:text-ink hover:no-underline sm:gap-2.5 sm:text-2xl ${HOME_HREF ? "max-sm:hidden" : ""}`}>
          <LeafMark className="text-moss" />
          <span className={HOME_HREF ? "max-lg:sr-only" : "max-sm:sr-only"}>The Conservatory</span>
        </Link>
        <nav aria-label="Main" className="flex gap-0.5 sm:ml-4">
          {NAV.map((item) => (
            <Link key={item.label} href={item.href} aria-current={isOn(item) ? "page" : undefined} className={`nav-pill whitespace-nowrap max-sm:text-meta ${HOME_HREF ? "max-sm:px-1.5" : "max-sm:px-2"} ${isOn(item) ? "nav-pill-on" : ""}`}>
              {item.label}
              {item.counted ? (
                <>
                  {" "}
                  <span className="font-normal tabular-nums opacity-80">
                    {todoCount}
                    <span className="sr-only"> still to do</span>
                  </span>
                </>
              ) : null}
            </Link>
          ))}
        </nav>
        <Link href="/add" className={`btn btn-primary ml-auto text-white hover:text-white hover:no-underline ${HOME_HREF ? "max-sm:px-3" : ""}`}>
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          <span className="hidden sm:inline">Add a plant</span>
          <span className="sm:hidden">Add</span>
        </Link>
      </div>
    </header>
  );
}
