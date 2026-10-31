"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

// The top bar from design/DESIGN.md §5: leaf mark and wordmark, nav pills,
// the search box, the primary "Add a plant". Collection and Species have
// pages; the other three are drawn in their places so the bar keeps its
// shape as phases land, and are plainly not links.
const NAV: Array<{ label: string; href: string | null; also?: string }> = [
  { label: "Collection", href: "/", also: "/plants/" },
  { label: "Species", href: "/species", also: "/species/" },
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
  const isOn = (item: (typeof NAV)[number]) => pathname === item.href || (item.also !== undefined && pathname.startsWith(item.also));
  return (
    <header className="bg-surface border-b border-line">
      <div className="mx-auto flex w-full max-w-page flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:gap-x-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2 font-display text-xl font-medium text-ink hover:text-ink hover:no-underline sm:gap-2.5 sm:text-2xl">
          <LeafMark className="text-moss" />
          <span>The Conservatory</span>
        </Link>
        {/* On a phone the Add button stays on the first row beside the
            wordmark, the nav takes the second and the search the third.
            From sm the nav joins the first row; from lg the search does
            too and the bar is the mockup's one row. */}
        <nav aria-label="Main" className="order-3 flex basis-full flex-wrap gap-0.5 sm:order-none sm:ml-4 sm:basis-auto">
          {NAV.map((item) =>
            item.href ? (
              <Link key={item.label} href={item.href} aria-current={isOn(item) ? "page" : undefined} className={`nav-pill ${isOn(item) ? "nav-pill-on" : ""}`}>
                {item.label}
              </Link>
            ) : (
              <span key={item.label} className="nav-pill text-ink-3" aria-disabled title="Coming in a later phase">
                {item.label}
              </span>
            ),
          )}
        </nav>
        <div className="order-4 flex basis-full items-center lg:order-none lg:ml-auto lg:basis-auto">
          {/* The search reads the URL, which a static page can only do behind
              a Suspense boundary; the fallback is the same box, not yet live. */}
          <Suspense fallback={<SearchBox live={false} />}>
            <SearchBox live />
          </Suspense>
        </div>
        <div className="ml-auto flex items-center gap-3 lg:ml-0">
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

/**
 * "Search nickname or species". On the collection and on the species list it
 * filters as you type, through the URL (?q=) with the native history API, so
 * no request leaves the phone. On a species page Enter goes to the species
 * list with the search applied; anywhere else, to the collection.
 */
const LIVE_SEARCH = new Set(["/", "/species"]);
function SearchBox({ live }: { live: boolean }) {
  return live ? <LiveSearchBox /> : <SearchForm value="" />;
}

function LiveSearchBox() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  // Typed text is local; when the URL's q changes under us (back button, a
  // link), the box follows it. Adjusting state during render, per React.
  const [seen, setSeen] = useState(urlQ);
  const [value, setValue] = useState(urlQ);
  if (seen !== urlQ) {
    setSeen(urlQ);
    setValue(urlQ);
  }
  const live = LIVE_SEARCH.has(pathname);
  const target = pathname.startsWith("/species") ? "/species" : "/";
  return (
    <SearchForm
      value={value}
      onChange={(v) => {
        setValue(v);
        if (live) {
          const url = new URL(window.location.href);
          if (v.trim()) url.searchParams.set("q", v);
          else url.searchParams.delete("q");
          window.history.replaceState(null, "", url.pathname + url.search);
        }
      }}
      onSubmit={() => {
        if (!live) router.push(value.trim() ? `${target}?q=${encodeURIComponent(value.trim())}` : target);
      }}
    />
  );
}

function SearchForm({ value, onChange, onSubmit }: { value: string; onChange?: (v: string) => void; onSubmit?: () => void }) {
  return (
    <form
      role="search"
      action="/"
      className="relative flex w-full items-center lg:w-[260px]"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <svg aria-hidden className="pointer-events-none absolute left-3.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={!onChange}
        placeholder="Search nickname or species"
        aria-label="Search the collection"
        autoComplete="off"
        className="field w-full pl-10"
      />
    </form>
  );
}
