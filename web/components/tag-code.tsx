// A pot tag's QR code, drawn from the path the server made (lib/tag-code.ts):
// one <path> in JSX, so no markup is injected and no QR library reaches the
// browser. Pure JSX, so the print page (a client component) and the plant
// and species pages (server components) all draw it.

/** The code, black on the paper's white: a mono laser prints any other dark as a dot screen and blurs the module edges. */
export function TagCodeSvg({ code, label, className = "" }: { code: { size: number; path: string }; label: string; className?: string }) {
  return (
    <svg viewBox={`0 0 ${code.size} ${code.size}`} shapeRendering="crispEdges" role="img" aria-label={label} className={className}>
      <path d={code.path} fill="#000" />
    </svg>
  );
}

/**
 * The side-panel tag from the species mockup's "Pot tags" card: the code in
 * an 84 px white tile whose padding is its quiet zone. Without
 * CONSERVATORY_URL the tile is a dashed placeholder of the same size that
 * says why, so nothing moves when the variable is set.
 */
export function TagCodeBox({ code, label }: { code: { size: number; path: string } | null; label: string }) {
  return code ? (
    <div className="flex h-[84px] w-[84px] flex-none items-center justify-center rounded-thumb border border-line bg-surface p-2">
      <TagCodeSvg code={code} label={label} className="h-full w-full" />
    </div>
  ) : (
    <div className="flex h-[84px] w-[84px] flex-none items-center justify-center rounded-thumb border border-dashed border-line-2 bg-ground p-1.5 text-center text-[11px] leading-tight text-ink-2">
      Needs CONSERVATORY_URL
    </div>
  );
}

/** The mockup's "Print pot tags" glyph: a QR code's three finder squares and a scrap of data. */
export function QrIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M21 14v7h-4" />
    </svg>
  );
}
