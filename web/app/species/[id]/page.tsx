import { BASE_PATH } from "@/lib/base-path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CareFigures, CareRewrite } from "@/components/care";
import { OpenPhoto, PhotoLightbox, type PhotoSlide } from "@/components/lightbox";
import { QrIcon, TagCodeBox } from "@/components/tag-code";
import { Term } from "@/components/term";
import { LeafMark } from "@/components/topbar";
import { CARE_CELLS, careScopeLine, careWrittenLine, type CareKey } from "@/lib/care";
import { dayLabel, displayName, speciesLabel, STATUS_LABEL, TILE_TINTS } from "@/lib/collection";
import type { GlossaryKey } from "@/lib/glossary";
import { withReadDb } from "@/lib/jobs";
import { familyExample, genusExample, relativeCount } from "@/lib/relatives";
import { readSpecies, type SpeciesView } from "@/lib/species";
import { tagCode } from "@/lib/tag-code";
import {
  aboutState,
  collectionRows,
  filmStrip,
  inCollectionLine,
  latinRuns,
  namingLine,
  photoCountLine,
  plantLabel,
  rowMeta,
  speciesCrumbs,
  speciesGallery,
  specimenCount,
  speciesTitle,
  stripCaption,
  type GalleryItem,
  type SpeciesListRow,
} from "@/lib/species-page";

// /species/[id]: one species, design/mockups/species.html in its Phase 2
// subset. Breadcrumb, title block, the species photo with In your collection
// beside it and the film strip of every photo under both (#123), About this
// species, the care sheet, Relatives you already have, the taxonomy card and
// the pot tags card (#36). Everything is what Fern wrote; before it has looked a
// species up, each block keeps its space and says so. Lineage and events
// arrive with their phases; their space is not faked.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = withReadDb((db) => readSpecies(db, Number(id)), null);
  return { title: s ? `${speciesTitle(s)} · The Conservatory` : "The Conservatory" };
}

export default async function SpeciesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const speciesId = Number(id);
  if (!Number.isInteger(speciesId) || speciesId <= 0) notFound();
  const s = withReadDb((db) => readSpecies(db, speciesId), null);
  if (!s) notFound();

  const common = displayName(s.commonName);
  const crumbs = speciesCrumbs(s);
  const gallery = speciesGallery(s.photos, s.reference, s.heroPhotoId);
  const hero = gallery.at(0);
  const strip = filmStrip(gallery);
  const ownerShown = gallery.filter((g) => g.kind === "owner").length;
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, this box's day
  // In your collection: every plant of the species, the living first, each
  // with how many photos it has. One or two plants get larger rows.
  const rows = collectionRows(s.tiles);
  const roomy = rows.length <= 2;
  const photosOf = new Map<number, number>();
  for (const ph of s.photos) photosOf.set(ph.specimenId, (photosOf.get(ph.specimenId) ?? 0) + 1);
  // The lightbox's slides, in the gallery's order: the species photo, then
  // every other photo of the species. A photo no longer navigates
  // on tap, so where it led goes under it in the lightbox: its plant's page,
  // or the reference's file page on Commons, where its licence lives. With
  // more than one of the household's photos, each can be made the species
  // photo there (#77); the one that leads is it, chosen or not.
  const slides: PhotoSlide[] = gallery.map((g, i) => ({
    key: g.key,
    src: g.url,
    alt: g.alt,
    caption: g.caption,
    photoId: ownerShown > 1 ? g.photoId : undefined,
    main: i === 0,
    link:
      g.kind === "owner"
        ? { href: g.href, label: `Open plant #${g.specimenId}`, external: false }
        : g.href !== g.url
          ? { href: g.href, label: "The image and its licence on Wikimedia Commons", external: true }
          : undefined,
  }));
  const about = aboutState(s);
  const living = s.tiles.filter((t) => t.status === "alive").length;
  const naming = namingLine(s.naming);

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-6 px-4 pb-14 pt-6 sm:gap-7 sm:px-8 sm:pt-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 ? (
              <span aria-hidden className="text-ink-3">
                ›
              </span>
            ) : null}
            {c.current ? (
              <span aria-current="page" className="font-semibold text-ink">
                {c.italic ? <em>{c.label}</em> : c.label}
              </span>
            ) : (
              <Link href={c.href!} className="font-semibold text-ink-2 hover:text-ink">
                {c.italic ? <em>{c.label}</em> : c.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/* Title block, DESIGN.md §5: the common name, the binomial with its
          author upright in ink-3, then the chips; Print pot tags on the right.
          Both lines are always there, so the block keeps its height when Fern
          fills in the common name. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2.5">
          <h1 className="text-h1 leading-[1.05] sm:text-page-title">{common ?? <Binomial s={s} />}</h1>
          <p className="font-display text-section leading-tight text-ink-2">
            {common ? (
              <Binomial s={s} withAuthor />
            ) : (
              <span className="font-sans text-body">
                No common name on file{s.enrichedAt ? "" : " yet"}{" "}
                <Term k="scientific-name">
                  <span className="sr-only">scientific name</span>
                </Term>
              </span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {s.family ? (
              <span className="tag">
                <Term k="family">Family {s.family}</Term>
              </span>
            ) : null}
            {s.rank === "genus" ? <span className="tag">Known to genus</span> : null}
            <span className="tag">{living === 1 ? "1 in your collection" : `${living} in your collection`}</span>
            {/* The care sheet's light and watering headlines, as on Get to
                know (#107). Drawn only with a sheet; the row is there either
                way. On a phone a long headline truncates, its mark kept. */}
            {s.care.kind === "sheet" ? (
              <>
                <span className="tag max-w-full gap-0">
                  <span className="min-w-0 truncate">{s.care.cells.light.headline}</span>
                  <Term k="light">
                    <span className="sr-only">light</span>
                  </Term>
                </span>
                <span className="tag tag-water max-w-full gap-0">
                  <span className="min-w-0 truncate">{s.care.cells.water.headline}</span>
                  <Term k="watering">
                    <span className="sr-only">watering</span>
                  </Term>
                </span>
              </>
            ) : null}
          </div>
        </div>
        <Link href={`/tags?species=${s.id}`} className="btn btn-soft hover:no-underline">
          <QrIcon />
          Print pot tags
        </Link>
      </div>

      {/* The top of the page (#123). The species photo in a square (#77, #83)
          and, beside it from 640 px (under it on a phone), In your collection:
          one row per plant, by its number, each a link to its page. The panel
          is exactly the hero's height: it is laid over its grid cell, so more
          rows than fit scroll inside it and the film strip never moves. Under
          both, every photo of the species in one row that scrolls sideways,
          newest first, the reference last. Dashed tiles hold the place of the
          household's first photo and of a reference Fern has not fetched, so
          the strip is the same height empty or full. The hero and every strip
          photo open the one lightbox, where any of the plants' photos can be
          made the species photo. */}
      <PhotoLightbox
        slides={slides}
        title={`Photos of ${speciesTitle(s)}`}
        choice={ownerShown > 1 ? { endpoint: `${BASE_PATH}/api/species/${s.id}`, noun: "species photo" } : undefined}
      >
        <div className="gallery">
          {hero ? (
            <figure className="relative m-0 aspect-square overflow-hidden rounded-[22px] border border-line bg-sage">
              <OpenPhoto slideKey={hero.key} label={seeFullSize(hero)} className="h-full w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={hero.url} alt="" loading="eager" className="h-full w-full object-cover" />
              </OpenPhoto>
              <figcaption className="pointer-events-none absolute bottom-4 left-4 max-w-[calc(100%-2rem)] truncate rounded-pill bg-[rgba(30,42,28,.82)] px-3 py-1.5 text-[13px] font-semibold text-white">
                {hero.caption}
              </figcaption>
            </figure>
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-[22px] border border-line bg-sage">
              <LeafMark size={96} className="text-[#6B8F66]" />
            </div>
          )}
          <div className="relative sm:self-stretch">
            <section aria-labelledby="coll-h" className="card flex flex-col overflow-hidden sm:absolute sm:inset-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-5 sm:px-6">
                <h2 id="coll-h" className="text-section leading-tight">
                  In your collection
                </h2>
                <span className="text-meta text-ink-2 tabular-nums">{inCollectionLine(s.tiles)}</span>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 [scrollbar-color:var(--color-line-strong)_transparent] [scrollbar-width:thin] sm:px-3.5">
                {rows.length === 0 ? <li className="px-2.5 py-2 text-meta text-ink-2">No plants of this species are on file.</li> : null}
                {rows.map((t, i) => (
                  <li key={t.id} className="border-t border-sage first:border-t-0">
                    <Link
                      href={`/plants/${t.id}`}
                      className={`flex items-center rounded-thumb text-ink hover:bg-ground hover:text-ink hover:no-underline focus-visible:-outline-offset-2 ${roomy ? "gap-4 p-2.5 lg:gap-5" : "gap-3 px-2.5 py-2"}`}
                    >
                      {t.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.thumbUrl}
                          alt=""
                          width={112}
                          height={112}
                          className={`flex-none object-cover ${roomy ? "size-20 rounded-[16px] sm:size-[72px] lg:size-28" : "size-14 rounded-thumb"}`}
                        />
                      ) : (
                        <div
                          aria-hidden
                          className={`flex flex-none items-center justify-center ${TILE_TINTS[i % TILE_TINTS.length]} ${roomy ? "size-20 rounded-[16px] sm:size-[72px] lg:size-28" : "size-14 rounded-thumb"}`}
                        >
                          <LeafMark size={roomy ? 40 : 28} className="text-[#6B8F66]" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`font-bold leading-snug tabular-nums ${roomy ? "text-h3" : "text-lead"}`}>{plantLabel(t.id)}</p>
                        <p className="text-meta text-ink-2 tabular-nums">
                          {/* A narrow row breaks between the parts, never inside a date or a count, and the dot stays with the part before it. */}
                          {rowMeta(t, photosOf.get(t.id) ?? 0).map((part, j, parts) => (
                            <span key={j} className={j > 0 ? "whitespace-nowrap" : undefined}>
                              {part}
                              {j < parts.length - 1 ? "\xA0· " : ""}
                            </span>
                          ))}
                        </p>
                      </div>
                      {t.status !== "alive" ? <span className="tag flex-none">{STATUS_LABEL[t.status]}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <section aria-labelledby="strip-h" className="card flex flex-col gap-3 px-5 pb-3 pt-5 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="strip-h" className="text-section leading-tight">
              Every photo
            </h2>
            <span className="text-meta text-ink-2 tabular-nums">
              {ownerShown > 1 ? `${photoCountLine(ownerShown)} · newest first` : photoCountLine(ownerShown)}
            </span>
          </div>
          <ul className="strip">
            {ownerShown === 0 ? <EmptyTile caption="Your photos">Your own photo takes the lead here once you add one.</EmptyTile> : null}
            {strip.map((g) => (
              <li key={g.key}>
                <figure className="m-0">
                  <div className="aspect-square overflow-hidden rounded-[16px] border border-line bg-sage">
                    <OpenPhoto slideKey={g.key} label={seeFullSize(g)} className="h-full w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={g.thumbUrl}
                        srcSet={`${g.thumbUrl} 240w, ${g.url} 1280w`}
                        sizes="(min-width: 640px) 144px, 120px"
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </OpenPhoto>
                  </div>
                  <figcaption className="mt-1.5 truncate text-center text-meta text-ink-2 tabular-nums">{stripCaption(g, today)}</figcaption>
                </figure>
              </li>
            ))}
            {s.reference ? null : (
              <EmptyTile caption="Wikipedia">
                {s.enrichedAt ? "Wikipedia has no reference image for this one." : "Fern has not fetched a reference image yet."}
              </EmptyTile>
            )}
          </ul>
        </section>
      </PhotoLightbox>

      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-7">
          {/* About this species: the Wikipedia lead, its source and date. */}
          <section aria-labelledby="about-h" className="card flex flex-col gap-3 p-5 sm:px-8 sm:py-7">
            <h2 id="about-h" className="text-section leading-tight">
              About this species
            </h2>
            <div className="min-h-[9.5rem]">
              {about.kind === "summary" ? (
                <div className="flex flex-col gap-3.5">
                  {about.paragraphs.map((p, i) => (
                    <p key={i} className="max-w-[70ch] text-lead leading-[1.65]">
                      {latinRuns(p, [s.scientificName, s.canonicalName, s.genus]).map((r, j) => (r.latin ? <em key={j}>{r.text}</em> : r.text))}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[9.5rem] flex-col justify-center gap-1 rounded-tile bg-ground px-5 py-4">
                  <p className="text-lead font-bold">
                    {about.kind === "pending" ? "Fern has not looked this one up yet" : "Wikipedia has no page for this name"}
                  </p>
                  <p className="max-w-[60ch] text-meta text-ink-2">
                    {about.kind === "pending"
                      ? "It fetches a summary and a reference image the next time the identification queue is quiet, usually within a minute of a plant being named."
                      : about.unknownToGbif
                        ? "GBIF does not know the name either, so it may be a trade name or a spelling slip. The name on the nursery tag can go in the cultivar field instead."
                        : "The taxonomy beside this is still GBIF's, and everything else on this page is yours."}
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-sage pt-3.5">
              <span className="text-meta text-ink-2">
                {about.kind === "summary"
                  ? `Summary from Wikipedia · fetched ${dayLabel(s.enrichedAt)}`
                  : about.kind === "pending"
                    ? "Summaries come from Wikipedia"
                    : `Looked up ${dayLabel(s.enrichedAt)}`}
              </span>
              {s.summaryUrl ? (
                <a href={s.summaryUrl} target="_blank" rel="noreferrer" className="text-[14px] font-semibold">
                  Read the full article
                </a>
              ) : null}
            </div>
          </section>

          <CareBlock s={s} />

          <RelativesBlock s={s} />
        </div>

        <aside className="flex w-full flex-[1_1_300px] flex-col gap-5 lg:max-w-sidebar">
          <Taxonomy s={s} naming={naming} />
          <PotTags s={s} living={living} />
        </aside>
      </div>
    </main>
  );
}

/**
 * The care sheet: the mockup's six cells, each under a heading band in its
 * topic's tint (CARE_LOOK) with its icon and its term's mark, then the
 * headline, two or three sentences, and the figures behind a tap. Written by
 * Fern (fern/care.py) and only read here. The six cells are always drawn, so
 * the block keeps its shape before the sheet exists; the foot says why it is
 * not there yet, or who wrote it and when, beside Rewrite.
 */
// Each care cell's heading band: its tint pair (design/tokens.css) and its
// line icon, one path on a 24 px grid. The classes are written out whole so
// Tailwind sees them.
const CARE_LOOK: Record<CareKey, { band: string; icon: string }> = {
  light: {
    band: "bg-sun text-sun-ink",
    icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8",
  },
  water: {
    band: "bg-water text-water-ink",
    icon: "M12 3.2c3.2 3.6 6 6.9 6 10.6a6 6 0 0 1-12 0c0-3.7 2.8-7 6-10.6z",
  },
  soil: {
    band: "bg-soil text-soil-ink",
    icon: "M5 6h14v4H5zM6.5 10l1.2 9a1.2 1.2 0 0 0 1.2 1h6.2a1.2 1.2 0 0 0 1.2-1l1.2-9",
  },
  hardiness: {
    band: "bg-frost text-frost-ink",
    icon: "M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5",
  },
  fertilizing: {
    band: "bg-feed text-feed-ink",
    icon: "M12 21v-9M12 13.5c0-3.5-2.5-6-7-6 0 3.5 2.5 6 7 6zM12 10.5c0-3 2-5.5 6.5-5.5 0 3-2 5.5-6.5 5.5zM7.5 21h9",
  },
  dormancy: {
    band: "bg-rest text-rest-ink",
    icon: "M20 14.2A8.2 8.2 0 1 1 9.8 4a6.6 6.6 0 0 0 10.2 10.2z",
  },
};

function CareBlock({ s }: { s: SpeciesView }) {
  const c = s.care;
  const sheet = c.kind === "sheet" ? c : null;
  const foot =
    c.kind === "sheet"
      ? `${c.level === "genus" ? "Genus-level advice: this plant is named only to its genus or is a hybrid, and care works at that level. " : ""}${careWrittenLine(c)}.${
          c.lastTryFailed ? " The last rewrite failed, so this is the sheet before it; Fern tries again a day later." : ""
        }`
      : c.kind === "writing"
        ? "Fern writes it from GBIF's taxonomy and Wikipedia's summary the next time the identification queue is quiet, usually within a minute."
        : c.kind === "failed"
          ? `Fern's last try, on ${dayLabel(c.triedAt) ?? "an earlier day"}, failed (${c.error.slice(0, 140)}). It tries again a day later.`
          : c.kind === "unplaced"
            ? c.enriched
              ? "GBIF could not place this name, so there is nothing to write a care sheet from."
              : "Fern writes the care sheet once it has placed this species with GBIF."
            : "No care model is configured on this box, so Fern has not written one. It needs AI_GATEWAY_API_KEY in the environment file.";
  return (
    <section aria-labelledby="care-h" className="card flex flex-col gap-4 p-5 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="care-h" className="text-section leading-tight">
          Care sheet
        </h2>
        <span className="text-meta text-ink-2">{sheet ? careScopeLine(sheet) : "Written once for each species"}</span>
      </div>
      <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {CARE_CELLS.map((d) => {
          const cell = sheet?.cells[d.key];
          const look = CARE_LOOK[d.key];
          const example = d.key === "hardiness" && sheet?.zone ? `Your household is in zone ${sheet.zone}; this sheet says ${cell?.headline}.` : undefined;
          return (
            <li key={d.key} className="flex flex-col rounded-tile bg-ground sm:min-h-[17.5rem]">
              {/* The band's corners are rounded here rather than clipped by
                  the cell, so the notes that float out of it are never cut. */}
              <p className={`flex items-center gap-2.5 rounded-t-tile px-3 py-2 text-[12px] font-bold uppercase tracking-[.04em] ${look.band}`}>
                <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-surface">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d={look.icon} />
                  </svg>
                </span>
                <Term k={d.term} example={example}>
                  {d.label}
                </Term>
              </p>
              <div className="flex flex-1 flex-col gap-1 px-4 pb-3.5 pt-3">
                {cell ? (
                  <>
                    <p className="font-semibold leading-snug">{cell.headline}</p>
                    <p className="text-meta text-ink-2">{cell.text}</p>
                    {cell.figures.length > 0 ? <CareFigures figures={cell.figures} /> : null}
                  </>
                ) : (
                  <>
                    <span aria-hidden className="mt-1 block h-4 w-2/3 rounded-pill bg-sage" />
                    <span aria-hidden className="mt-2 block h-3 w-full rounded-pill bg-sage" />
                    <span aria-hidden className="block h-3 w-full rounded-pill bg-sage" />
                    <span aria-hidden className="block h-3 w-4/5 rounded-pill bg-sage" />
                    <span aria-hidden className="mt-auto block h-3 w-2/5 rounded-pill bg-sage" />
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex min-h-[2.75rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-sage pt-3.5">
        <p className="max-w-[64ch] text-meta text-ink-2">{foot}</p>
        <CareRewrite speciesId={s.id} writing={c.kind === "writing"} canRewrite={s.careModel && (c.kind === "sheet" || c.kind === "failed")} />
      </div>
    </section>
  );
}

/**
 * Relatives you already have: the household's other species in this genus,
 * then in this family under another genus (lib/relatives.ts). The block is
 * always drawn, so a lonely species and a crowded one keep the page's shape:
 * with none, or before Fern has placed the species, a reserved panel says so.
 * The genus and family marks take their examples from the plants on screen.
 */
function RelativesBlock({ s }: { s: SpeciesView }) {
  const r = s.relatives;
  const genusEx = genusExample(s, r);
  const familyEx = familyExample(r);
  const lonely = r.placed && relativeCount(r) === 0;
  return (
    <section id="relatives" aria-labelledby="rel-h" className="card flex flex-col gap-4 p-5 sm:px-8 sm:py-7">
      <h2 id="rel-h" className="text-section leading-tight">
        Relatives you already have
      </h2>

      {!r.placed || lonely ? (
        <div className="flex min-h-[200px] flex-col justify-center gap-1.5 rounded-tile border border-dashed border-line-2 bg-ground px-5 py-4">
          <p className="text-lead font-bold">
            {r.placed ? "Nothing else in this genus or family yet" : s.enrichedAt ? "GBIF could not place this name" : "Fern has not placed this one yet"}
          </p>
          <p className="max-w-[62ch] text-meta text-ink-2">
            {r.placed ? (
              <>
                <em>{s.canonicalName ?? s.scientificName}</em> is your only{" "}
                <Term k="genus" example={genusEx}>
                  <em>{r.genus}</em>
                </Term>
                , and nothing else you own is in{" "}
                <Term k="family" example={familyEx}>
                  {r.family}
                </Term>
                . Name another and it shows up here.
              </>
            ) : s.enrichedAt ? (
              "Relatives are matched on genus and family, and without them there is nothing to match this one against."
            ) : (
              "Relatives are matched on genus and family. Fern looks those up the next time the identification queue is quiet."
            )}
          </p>
        </div>
      ) : (
        <>
          <RelativeGroup
            heading={
              <>
                Same{" "}
                <Term k="genus" example={genusEx}>
                  genus
                </Term>{" "}
                · <em>{r.genus}</em>
              </>
            }
            rows={r.sameGenus}
            none={
              <>
                No other <em>{r.genus}</em> yet
              </>
            }
          />
          <RelativeGroup
            heading={
              <>
                Same{" "}
                <Term k="family" example={familyEx}>
                  family
                </Term>{" "}
                · {r.family}
              </>
            }
            rows={r.sameFamily}
            none={<>Nothing else in {r.family} yet</>}
          />
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-sage pt-3.5">
        <span className="text-meta text-ink-2">Matched on genus and family, among the plants you own.</span>
        {r.placed ? (
          <Link href={`/?q=${encodeURIComponent(r.family)}`} className="text-[14px] font-semibold">
            Every species in {r.family}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** One group of relatives: a heading, then four across (two on a phone), or a dashed cell when the group is empty. */
function RelativeGroup({ heading, rows, none }: { heading: React.ReactNode; rows: SpeciesListRow[]; none: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="font-sans text-[15px] font-bold text-ink-2">{heading}</h3>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.length === 0 ? (
          <li className="col-span-2 flex flex-col justify-center gap-1 rounded-[16px] border border-dashed border-line-2 px-4 py-3 sm:col-span-1 sm:aspect-square">
            <p className="font-bold text-ink-2">{none}</p>
            <p className="text-meta text-ink-2">The next one you name lands here.</p>
          </li>
        ) : (
          rows.map((row, i) => (
            <li key={row.id}>
              <RelativeCard row={row} tint={TILE_TINTS[(i + 2) % TILE_TINTS.length]} />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** The mockup's `rel` card: a square photo (owner's, else the reference, else a tinted tile), the name, the binomial under a common name, the count. One link. */
function RelativeCard({ row, tint }: { row: SpeciesListRow; tint: string }) {
  const common = displayName(row.commonName);
  return (
    <Link
      href={`/species/${row.id}`}
      className="card card-link flex h-full flex-col overflow-hidden rounded-[16px] text-ink hover:text-ink hover:no-underline"
    >
      {row.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.thumbUrl}
          srcSet={row.imageUrl ? `${row.thumbUrl} 240w, ${row.imageUrl} 1280w` : undefined}
          sizes="(min-width: 1024px) 190px, (min-width: 640px) 30vw, 45vw"
          alt=""
          loading="lazy"
          width={320}
          height={320}
          className="aspect-square w-full object-cover"
        />
      ) : (
        <div className={`flex aspect-square items-center justify-center ${tint}`}>
          <LeafMark size={52} className="text-[#6B8F66]" />
        </div>
      )}
      <div className="flex flex-col gap-0.5 px-3 pb-3 pt-2.5">
        <p className={`font-bold leading-snug ${common ? "" : "font-display font-normal italic"}`}>{speciesTitle(row)}</p>
        {common ? <p className="sp break-words text-[13px]">{speciesLabel(row.scientificName, row.cultivar)}</p> : null}
        <p className="text-meta text-ink-2 tabular-nums">{specimenCount(row.specimens)}</p>
      </div>
    </Link>
  );
}

/** The italic binomial, its author upright and small in ink-3, then the cultivar upright in quotes.
 *  With the author (the subtitle), the scientific-name mark sits on the binomial itself, before the author. */
function Binomial({ s, withAuthor = false }: { s: SpeciesView; withAuthor?: boolean }) {
  return (
    <>
      <em>{s.scientificName}</em>
      {withAuthor ? (
        <span className="font-sans text-body">
          <Term k="scientific-name">
            <span className="sr-only">scientific name</span>
          </Term>
        </span>
      ) : null}
      {withAuthor && s.authorship ? (
        <span className="font-sans text-[16px] not-italic text-ink-3">
          {" "}
          <Term k="authorship">{s.authorship}</Term>
        </span>
      ) : null}
      {s.cultivar ? <span className="not-italic"> &lsquo;{s.cultivar}&rsquo;</span> : null}
    </>
  );
}

const RANKS: Array<{ k: GlossaryKey; label: string; value: (s: SpeciesView) => string | null; italic?: boolean }> = [
  { k: "kingdom", label: "Kingdom", value: (s) => s.kingdom },
  { k: "phylum", label: "Phylum", value: (s) => s.phylum },
  { k: "class", label: "Class", value: (s) => s.class },
  { k: "order", label: "Order", value: (s) => s.order },
  { k: "family", label: "Family", value: (s) => s.family },
  { k: "genus", label: "Genus", value: (s) => s.genus, italic: true },
  { k: "species", label: "Species", value: (s) => (s.rank && s.rank !== "genus" ? (s.canonicalName ?? s.scientificName) : null), italic: true },
];

/** The taxonomy card: GBIF's ranks, every row always drawn, the owner's cultivar, and how the name came in. */
function Taxonomy({ s, naming }: { s: SpeciesView; naming: string | null }) {
  // The header already says when GBIF had no match; the rows only say what is missing.
  const missing = s.enrichedAt ? (s.gbifKey === null ? "unknown" : "not given") : "not known yet";
  return (
    <section className="card p-5" aria-labelledby="tax-h">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="tax-h" className="text-h3">
          <Term k="taxonomy">Taxonomy</Term>
        </h3>
        {s.gbifKey !== null ? (
          <a href={`https://www.gbif.org/species/${s.gbifKey}`} target="_blank" rel="noreferrer" className="text-meta font-semibold">
            from GBIF
          </a>
        ) : (
          <span className="text-meta text-ink-2">{s.enrichedAt ? "no GBIF match" : "not looked up yet"}</span>
        )}
      </div>
      <dl className="mt-2.5 flex flex-col">
        {RANKS.map((r) => {
          const v = r.value(s);
          return (
            <div key={r.k} className="flex items-baseline justify-between gap-3 border-b border-sage py-2.5">
              <dt className="text-meta text-ink-2">
                <Term k={r.k}>{r.label}</Term>
              </dt>
              <dd className="text-right">
                {v ? (
                  r.italic ? (
                    <em className="font-display">{v}</em>
                  ) : (
                    v
                  )
                ) : r.k === "species" && s.rank === "genus" ? (
                  <span className="text-meta text-ink-3">genus only</span>
                ) : (
                  <span className="text-meta text-ink-3">{missing}</span>
                )}
              </dd>
            </div>
          );
        })}
        {s.cultivar ? (
          <div className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-meta text-ink-2">
              <Term k="cultivar">Your cultivar</Term>
            </dt>
            <dd className="text-right">&lsquo;{s.cultivar}&rsquo;</dd>
          </div>
        ) : null}
      </dl>
      {s.rank === "genus" ? (
        <p className="mt-2 text-meta text-ink-2">Named to the genus, as most nursery hybrids are; care advice works at this level anyway.</p>
      ) : null}
      {naming ? <p className="mt-3 text-meta text-ink-2">{naming}</p> : null}
    </section>
  );
}

/**
 * The mockup's "Pot tags" card: a sample code (the newest living plant's),
 * how many living plants of this species have no tag yet, and the way to the
 * print page narrowed to this species.
 */
function PotTags({ s, living }: { s: SpeciesView; living: number }) {
  const ready = s.tags.ready;
  return (
    <section className="card p-5" aria-labelledby="tags-h">
      <h3 id="tags-h" className="mb-3 text-h3">
        Pot tags
      </h3>
      <div className="flex items-center gap-3.5">
        <TagCodeBox code={s.tags.sampleId === null ? null : tagCode(s.tags.sampleId)} label={`QR code for plant #${s.tags.sampleId}`} />
        <div className="flex min-w-0 flex-col">
          <p className="font-semibold">Each plant gets its own QR tag that opens its page.</p>
          <p className="mt-1 text-meta text-ink-2">
            {living === 0
              ? "No living plants of this species to tag."
              : ready === 0
                ? "Every plant of this species is tagged."
                : `${ready === 1 ? "1 tag" : `${ready} tags`} ready for this species.`}
          </p>
          <Link href={`/tags?species=${s.id}`} className="mt-1.5 self-start font-semibold">
            Print label sheet
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The label of a photo's button: "See your photo of plant #281 full size". */
function seeFullSize(item: GalleryItem): string {
  return `See ${item.alt.charAt(0).toLowerCase()}${item.alt.slice(1)} full size`;
}

/** A film strip tile's place held for a photo that is not there yet, at a tile's size with a caption's line under it, saying why. */
function EmptyTile({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <li>
      <div className="flex aspect-square items-center justify-center rounded-[16px] border border-dashed border-line-2 bg-ground px-3 text-center">
        <p className="line-clamp-4 text-tag leading-snug text-ink-2">{children}</p>
      </div>
      <p className="mt-1.5 truncate text-center text-meta text-ink-2">{caption}</p>
    </li>
  );
}
