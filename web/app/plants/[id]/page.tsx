import Link from "next/link";
import { notFound } from "next/navigation";
import { OpenPhoto, PhotoLightbox, type PhotoSlide } from "@/components/lightbox";
import { PhotoAdder } from "@/components/photo-adder";
import { PhotoRemover } from "@/components/photo-remover";
import { PlantEditor } from "@/components/plant-editor";
import { TagCodeBox } from "@/components/tag-code";
import { Term } from "@/components/term";
import { LeafMark } from "@/components/topbar";
import { cardNames, dayLabel, displayName, metaLine, STATUS_LABEL } from "@/lib/collection";
import { withReadDb } from "@/lib/jobs";
import { relativeCount, relativesLine, relativesOf } from "@/lib/relatives";
import { speciesList } from "@/lib/species";
import { knownLocations, readSpecimen } from "@/lib/specimens";
import { tagCode } from "@/lib/tag-code";

// /plants/[id]: one specimen. Breadcrumb, title block, its photos as a
// timeline (its main photo first, #46, each opening the lightbox), the
// editable facts, and its species in the side column with how many relatives
// it has and a link to the species page, then how it was named and, while it
// lives, its pot tag (#36). Care and events arrive with the phases that
// bring them.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plant = withReadDb((db) => readSpecimen(db, Number(id)), null);
  return { title: plant ? `${cardNames({ ...plant.species, nickname: plant.nickname }).name} · The Conservatory` : "The Conservatory" };
}

export default async function PlantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plantId = Number(id);
  if (!Number.isInteger(plantId) || plantId <= 0) notFound();
  const data = withReadDb((db) => {
    const plant = readSpecimen(db, plantId);
    return plant ? { plant, locations: knownLocations(db), relatives: relativesOf(plant.species, speciesList(db)) } : null;
  }, null);
  if (!data) notFound();
  const { plant, locations, relatives } = data;
  const sp = plant.species;
  const relCount = relativeCount(relatives);
  // Named as its dashboard card is: the nickname, else the common name, else the species.
  const { name, common, species } = cardNames({ ...sp, nickname: plant.nickname });
  const binomial = <Binomial scientificName={sp.scientificName} cultivar={sp.cultivar} />;
  const mark = (
    <span className="font-sans text-body">
      <Term k="scientific-name">
        <span className="sr-only">scientific name</span>
      </Term>
    </span>
  );
  const noNickname = <span className="font-sans text-body">No nickname yet</span>;
  // The lines under the title, in the card's order. The info mark follows the
  // binomial, or ends the first line when the binomial is the title.
  const lines: React.ReactNode[] = [];
  if (common) lines.push(common);
  if (species) lines.push(<>{binomial} {mark}</>);
  if (!plant.nickname) lines.push(species ? noNickname : <>{noNickname} {mark}</>);
  const [hero, ...rest] = plant.photos;
  const several = plant.photos.length > 1;
  const removeFrom = several ? plant.id : null; // a plant keeps at least one photo
  // The lightbox's slides, in the page's order: the main photo, then newest first.
  const slides: PhotoSlide[] = plant.photos.map((p) => ({
    key: `photo-${p.id}`,
    src: p.url,
    alt: `${name}, ${photoCaption(p).toLowerCase()}`,
    caption: photoCaption(p, several),
    photoId: p.id,
    main: p.main,
  }));
  const record = plant.named
    ? `Named ${plant.named.how === "pill" ? "from Fern's suggestion" : plant.named.how === "typed" ? "by typing the name" : "as another photo of a plant you had just named"} on ${dayLabel(plant.named.at)}.`
    : `Added on ${dayLabel(plant.createdAt)}.`;

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-6 px-4 pb-14 pt-6 sm:px-8 sm:pt-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
        <Link href="/" className="font-semibold text-ink-2">
          Collection
        </Link>
        <span aria-hidden>›</span>
        <span aria-current="page" className="font-semibold text-ink">
          {species ? name : binomial}
        </span>
      </nav>

      {/* Title block, DESIGN.md §5: the name, the common name under a nickname,
          the Latin name in italics, a row of tags. Two lines are always reserved
          under the title, so the block keeps its height when Fern fills in the
          common name or a nickname is saved. */}
      <div className="flex flex-col gap-2.5">
        <h1 className="text-h1 leading-[1.05] sm:text-page-title">{species ? name : binomial}</h1>
        <div className="flex flex-col gap-1">
          {lines.map((line, i) => (
            <p key={i} className="font-display text-section leading-tight text-ink-2">
              {line}
            </p>
          ))}
          {lines.length < 2 ? (
            <p aria-hidden className="invisible font-display text-section leading-tight">
              &nbsp;
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {plant.status !== "alive" ? <span className="tag tag-warn">{STATUS_LABEL[plant.status]}</span> : null}
          <span className="tag">{metaLine(plant)}</span>
          <span className="tag">{plant.photos.length === 1 ? "1 photo" : `${plant.photos.length} photos`}</span>
        </div>
      </div>

      {/* Photos: the main photo is the hero (#46), the rest newest first. Each opens
          the lightbox, where another can be made the main photo, and while there is
          more than one, carries Remove. Removing the hero makes the next newest the
          hero; its key keeps the new hero's Remove fresh. */}
      <PhotoLightbox slides={slides} title={`Photos of ${name}`} plantId={several ? plant.id : undefined}>
        <section aria-label="Photos" className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {hero ? (
            <Photo key={hero.id} photo={hero} removeFrom={removeFrom} several={several} hero />
          ) : (
            <div className="flex h-[320px] items-center justify-center rounded-[22px] border border-line bg-sage sm:col-span-2 sm:h-[480px]">
              <LeafMark size={96} className="text-[#6B8F66]" />
            </div>
          )}
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-1">
              {rest.slice(0, 2).map((p) => (
                <Photo key={p.id} photo={p} removeFrom={removeFrom} />
              ))}
            </div>
            <div className="flex flex-1 flex-col justify-end gap-2 rounded-tile bg-sage px-4 py-3">
              <PhotoAdder
                plantId={plant.id}
                countLine={
                  plant.photos.length === 0
                    ? "No photos yet."
                    : plant.photos.length === 1
                      ? "1 photo of this plant."
                      : `${plant.photos.length} photos of this plant. Open one to choose the main photo.`
                }
              />
            </div>
          </div>
          {rest.length > 2 ? (
            <ul className="grid grid-cols-2 gap-3.5 sm:col-span-3 sm:grid-cols-4 lg:grid-cols-6">
              {rest.slice(2).map((p) => (
                <li key={p.id}>
                  <Photo photo={p} removeFrom={removeFrom} small />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </PhotoLightbox>

      <div className="flex flex-wrap items-start gap-7">
        <section aria-labelledby="facts-h" className="card flex min-w-0 flex-[999_1_560px] flex-col gap-5 p-5 sm:px-8 sm:py-7">
          <h2 id="facts-h" className="text-section leading-tight">
            About this <Term k="specimen" />
          </h2>
          <PlantEditor
            id={plant.id}
            facts={{ nickname: plant.nickname, location: plant.location, acquiredOn: plant.acquiredOn, status: plant.status }}
            locations={locations}
            photoCount={plant.photos.length}
          />
        </section>

        <aside className="flex w-full flex-[1_1_300px] flex-col gap-5 lg:max-w-sidebar">
          <section className="card p-5" aria-labelledby="species-h">
            <h3 id="species-h" className="mb-3 text-h3">
              Its species
            </h3>
            <dl className="flex flex-col gap-2.5 text-body">
              <div className="flex flex-col">
                <dt className="text-meta text-ink-2">
                  <Term k="species">Species</Term>
                </dt>
                <dd className="font-display italic">
                  {sp.scientificName}
                  {sp.cultivar ? <span className="not-italic"> &lsquo;{sp.cultivar}&rsquo;</span> : null}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-meta text-ink-2">
                  <Term k="common-name">Common name</Term>
                </dt>
                <dd>{displayName(sp.commonName) ?? <span className="text-ink-3">not known yet</span>}</dd>
              </div>
              {sp.cultivar ? (
                <div className="flex flex-col">
                  <dt className="text-meta text-ink-2">
                    <Term k="cultivar">Cultivar</Term>
                  </dt>
                  <dd>{sp.cultivar}</dd>
                </div>
              ) : null}
              <div className="flex flex-col">
                <dt className="text-meta text-ink-2">
                  <Term k="genus">Genus</Term>
                </dt>
                <dd className="font-display italic">{sp.genus ?? <span className="font-sans not-italic text-ink-3">not known yet</span>}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-meta text-ink-2">
                  <Term k="family">Family</Term>
                </dt>
                <dd>{sp.family ?? <span className="text-ink-3">not known yet</span>}</dd>
              </div>
            </dl>
            <p className="mt-4 text-meta text-ink-2">
              {relCount > 0 ? <Link href={`/species/${sp.id}#relatives`}>{relativesLine(relatives)}</Link> : relativesLine(relatives)}
            </p>
            <Link href={`/species/${sp.id}`} className="btn btn-soft btn-compact mt-3 hover:no-underline">
              Open the species page
            </Link>
          </section>
          <section className="card p-5" aria-labelledby="record-h">
            <h3 id="record-h" className="mb-3 text-h3">
              In your records
            </h3>
            <p className="text-body">{record}</p>
            <p className="mt-1 text-meta text-ink-2">
              Identification by Pl@ntNet; what you confirmed is what counts.
            </p>
          </section>
          {plant.status === "alive" ? (
            <section className="card p-5" aria-labelledby="tag-h">
              <h3 id="tag-h" className="mb-3 text-h3">
                Pot tag
              </h3>
              <div className="flex items-center gap-3.5">
                <TagCodeBox code={tagCode(plant.id)} label={`QR code for plant #${plant.id}`} />
                <div className="flex min-w-0 flex-col">
                  <p className="font-semibold">{plant.taggedAt ? `Tagged ${dayLabel(plant.taggedAt)}` : "No tag yet"}</p>
                  <p className="text-meta text-ink-2 tabular-nums">Tag #{plant.id} opens this page.</p>
                  <Link href={`/tags?plant=${plant.id}`} className="mt-1.5 self-start font-semibold">
                    Print this tag
                  </Link>
                </div>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function Binomial({ scientificName, cultivar }: { scientificName: string; cultivar: string | null }) {
  return (
    <>
      <em>{scientificName}</em>
      {cultivar ? <span className="not-italic"> &lsquo;{cultivar}&rsquo;</span> : null}
    </>
  );
}

type PlantPhoto = { id: number; url: string; thumbUrl: string; takenAt: string | null; uploadedAt: string; main: boolean };

/** "Taken Oct 31, 2026", or "Added" when no date was in the photo; " · Main photo" on the main one when there are several. */
function photoCaption(photo: PlantPhoto, several = false): string {
  const when = photo.takenAt ? `Taken ${dayLabel(photo.takenAt)}` : `Added ${dayLabel(photo.uploadedAt)}`;
  return several && photo.main ? `${when} · Main photo` : when;
}

function Photo({
  photo,
  removeFrom,
  several = false,
  hero = false,
  small = false,
}: {
  photo: PlantPhoto;
  removeFrom: number | null;
  several?: boolean;
  hero?: boolean;
  small?: boolean;
}) {
  const caption = photoCaption(photo, several);
  const when = photoCaption(photo);
  const h = hero ? "h-[320px] sm:h-[480px]" : small ? "h-[120px]" : "h-[160px] sm:h-[233px]";
  return (
    <figure className={`relative m-0 overflow-hidden border border-line bg-sage ${hero ? "rounded-[22px] sm:col-span-2" : "rounded-tile"} ${h}`}>
      <OpenPhoto slideKey={`photo-${photo.id}`} label={`See the photo ${when.charAt(0).toLowerCase()}${when.slice(1)} full size`} className="h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hero ? photo.url : photo.thumbUrl} alt="" loading={hero ? "eager" : "lazy"} className="h-full w-full object-cover" />
      </OpenPhoto>
      <figcaption
        className={`pointer-events-none absolute bottom-3 left-3 rounded-pill bg-[rgba(30,42,28,.82)] font-semibold text-white ${small ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-[13px]"}`}
      >
        {caption}
      </figcaption>
      {removeFrom !== null ? <PhotoRemover plantId={removeFrom} photoId={photo.id} caption={when} small={small} /> : null}
    </figure>
  );
}
