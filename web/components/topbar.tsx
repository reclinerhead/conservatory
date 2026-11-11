"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The top bar from design/DESIGN.md §5: leaf mark and wordmark, a nav pill
// for each page that exists, the primary "Add a plant". Collection is lit on
// the species and plant pages it leads to. One row at every width: on a
// phone the wordmark is the leaf alone. The search is the life list's
// (components/species-grid.tsx).
const NAV: Array<{ label: string; href: string; also?: string[] }> = [
  { label: "Collection", href: "/", also: ["/species/", "/plants/"] },
  { label: "Tags", href: "/tags" },
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

export function TopBar() {
  const pathname = usePathname();
  const isOn = (item: (typeof NAV)[number]) => pathname === item.href || (item.also ?? []).some((p) => pathname.startsWith(p));
  return (
    <header className="bg-surface border-b border-line">
      <div className="mx-auto flex w-full max-w-page items-center gap-x-2 px-4 py-3 sm:gap-x-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2 font-display text-xl font-medium text-ink hover:text-ink hover:no-underline sm:gap-2.5 sm:text-2xl">
          <LeafMark className="text-moss" />
          <span className="max-sm:sr-only">The Conservatory</span>
        </Link>
        <nav aria-label="Main" className="flex gap-0.5 sm:ml-4">
          {NAV.map((item) => (
            <Link key={item.label} href={item.href} aria-current={isOn(item) ? "page" : undefined} className={`nav-pill ${isOn(item) ? "nav-pill-on" : ""}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <Link href="/add" className="btn btn-primary ml-auto text-white hover:text-white hover:no-underline">
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
