"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { QrIcon } from "@/components/tag-code";
import { LeafMark } from "@/components/topbar";
import { cardNames, metaLine, STATUS_LABEL, type Tile } from "@/lib/collection";

/** "Print pot tags" in the life list's header: the print page, narrowed to the place on screen (?at=). */
export function PrintTagsLink() {
  const at = useSearchParams().get("at");
  return (
    <Link href={at && at !== "all" ? `/tags?at=${encodeURIComponent(at)}` : "/tags"} className="btn btn-soft btn-compact hover:no-underline">
      <QrIcon />
      Print pot tags
    </Link>
  );
}

/**
 * The specimen card from DESIGN.md §4: photo or tinted tile 168 px tall,
 * the name (the common name, else the species), the italic species under a
 * common name, meta line, tags. One link. `compact` is the species page's variant: 140 px and a
 * 16 px radius, as the mockup's `rel`, and no common name, since every card
 * there is the page's own species and its common name is the page's title.
 */
export function SpecimenCard({ tile, tint, compact = false }: { tile: Tile; tint: string; compact?: boolean }) {
  const { name, species } = cardNames(compact ? { ...tile, commonName: null } : tile);
  const h = compact ? "h-[140px]" : "h-[168px]";
  return (
    <Link
      href={`/plants/${tile.id}`}
      className={`card card-link flex h-full flex-col overflow-hidden text-ink hover:text-ink hover:no-underline ${compact ? "rounded-[16px]" : ""}`}
    >
      {tile.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tile.thumbUrl} alt="" loading="lazy" width={320} height={320} className={`${h} w-full object-cover`} />
      ) : (
        <div className={`flex ${h} items-center justify-center ${tint}`}>
          <LeafMark size={compact ? 60 : 72} className="text-[#6B8F66]" />
        </div>
      )}
      <div className="flex flex-col gap-1 px-4 pb-4 pt-3.5">
        <p className="text-lead font-bold leading-snug">{name}</p>
        {/* The line under the name is reserved, so a card keeps its height when Fern finds a common name. */}
        {species ? (
          <p className="sp">{species}</p>
        ) : (
          <p aria-hidden className="invisible">
            &nbsp;
          </p>
        )}
        <p className="text-meta text-ink-2">{metaLine(tile)}</p>
        {tile.status !== "alive" ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="tag">{STATUS_LABEL[tile.status]}</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
