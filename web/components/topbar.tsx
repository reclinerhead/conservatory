"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The top bar from design/DESIGN.md §5: leaf mark and wordmark, nav pills,
// the primary "Add a plant". Only Collection has a page yet; the other four
// are drawn in their places so the bar keeps its shape as phases land, and
// are plainly not links. The search box arrives with the collection (#8).
const NAV: Array<{ label: string; href: string | null }> = [
  { label: "Collection", href: "/" },
  { label: "Species", href: null },
  { label: "Locations", href: null },
  { label: "Reminders", href: null },
  { label: "Flower Show", href: null },
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
  return (
    <header className="bg-surface border-b border-line">
      <div className="mx-auto flex w-full max-w-page flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:gap-x-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2 font-display text-xl font-medium text-ink hover:text-ink hover:no-underline sm:gap-2.5 sm:text-2xl">
          <LeafMark className="text-moss" />
          <span>The Conservatory</span>
        </Link>
        {/* On a phone the nav takes the whole second row and the Add button
            stays on the first, beside the wordmark: two rows, as DESIGN.md
            §5 asks. From sm up it is one row. */}
        <nav aria-label="Main" className="order-3 flex basis-full flex-wrap gap-0.5 sm:order-none sm:ml-4 sm:basis-auto">
          {NAV.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                className={`nav-pill ${pathname === item.href ? "nav-pill-on" : ""}`}
              >
                {item.label}
              </Link>
            ) : (
              <span key={item.label} className="nav-pill text-ink-3" aria-disabled title="Coming in a later phase">
                {item.label}
              </span>
            ),
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/add" className="btn btn-primary text-white hover:text-white hover:no-underline">
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <span className="hidden sm:inline">Add a plant</span>
            <span className="sm:hidden">Add</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
