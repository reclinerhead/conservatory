import Link from "next/link";
import { LeafMark } from "@/components/topbar";
import { cardNames, metaLine, STATUS_LABEL, type Tile } from "@/lib/collection";

/**
 * The specimen card from DESIGN.md §4: photo or tinted tile in a square,
 * the name (the common name, else the species), the italic species under a
 * common name, meta line, tags. One link. `compact` is the species page's
 * variant: a 16 px radius, as the mockup's `rel`, and no common name, since every card
 * there is the page's own species and its common name is the page's title.
 */
export function SpecimenCard({ tile, tint, compact = false }: { tile: Tile; tint: string; compact?: boolean }) {
  const { name, species } = cardNames(compact ? { ...tile, commonName: null } : tile);
  return (
    <Link
      href={`/plants/${tile.id}`}
      className={`card card-link flex h-full flex-col overflow-hidden text-ink hover:text-ink hover:no-underline ${compact ? "rounded-[16px]" : ""}`}
    >
      {tile.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tile.thumbUrl}
          srcSet={tile.imageUrl ? `${tile.thumbUrl} 240w, ${tile.imageUrl} 1280w` : undefined}
          sizes="(min-width: 1280px) 200px, (min-width: 640px) 30vw, 45vw"
          alt=""
          loading="lazy"
          width={320}
          height={320}
          className="aspect-square w-full object-cover"
        />
      ) : (
        <div className={`flex aspect-square items-center justify-center ${tint}`}>
          <LeafMark size={compact ? 60 : 72} className="text-[#6B8F66]" />
        </div>
      )}
      <div className="flex flex-col gap-1 px-3 pb-3.5 pt-3 sm:px-4 sm:pb-4 sm:pt-3.5">
        <p className="text-lead font-bold leading-snug">{name}</p>
        {/* The line under the name is reserved, so a card keeps its height when Fern finds a common name.
            The compact card never shows a common name, so it has no line to reserve. */}
        {species ? (
          <p className="sp">{species}</p>
        ) : compact ? null : (
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
