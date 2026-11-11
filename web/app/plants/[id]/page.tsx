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

// /plants/[id]: one specimen. Breadcrumb (through its species' page), title
// block, its photos as a timeline (its main photo first, #46, each opening
// the lightbox), the editable facts, and its species in the side column with
// how many relatives it has, then how it was named and, while it
// lives, its pot tag (#36). Care and events arrive with the phases that
// bring them.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plant = withReadDb((db) => readSpecimen(db, Number(id)), null);
  return { title: plant ? `${cardNames(plant.species).name} · The Conservatory` : "The Conservatory" };
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
  // Named as its dashboard card is: the common name, else the species.
  const { name, species } = cardNames(sp);
  const binomial = <Binomial scientificName={sp.scientificName} cultivar={sp.cultivar} />;
  const mark = (
    <span className="font-sans text-body">
      <Term k="scientific-name">
        <span className="sr-only">scientific name</span>
      </Term>
    </span>
  );
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
        {/* The species is one tap up: its page is where the care sheet and
            the relatives live. The plant itself goes by its tag number,
            since it shares the species' name. */}
        <Link href={`/species/${sp.id}`} className="font-semibold text-ink-2">
          {species ? name : binomial}
        </Link>
        <span aria-hidden>›</span>
        <span aria-current="page" className="font-semibold text-ink tabular-nums">
          Plant #{plant.id}
        </span>
      </nav>

      {/* Title block, DESIGN.md §5, as the species page draws it: the common
          name, the Latin name in italics under it with the info mark, a row of
          tags. With no common name the binomial is the title and the line under
          it says so. The line is always there, so the block keeps its height
          when Fern fills in the common name. */}
      <div className="flex flex-col gap-2.5">
        <h1 className="text-h1 leading-[1.05] sm:text-page-title">{species ? name : binomial}</h1>
        <p className="font-display text-section leading-tight text-ink-2">
          {species ? (
            <>
              {binomial} {mark}
            </>
          ) : (
            <span className="font-sans text-body">No common name on file {mark}</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {plant.status !== "alive" ? <span className="tag tag-warn">{STATUS_LABEL[plant.status]}</span> : null}
          <span className="tag">{metaLine(plant)}</span>
          <span className="tag">{plant.photos.length === 1 ? "1 photo" : `${plant.photos.length} photos`}</span>
        </div>
      </div>

      {/* Photos, in the species page's shape (#83): the main photo is the hero
          (#46), in a square, and beside it (under it on a phone) the rest as equal
          square tiles, newest first, then "Add a photo" as one more tile. Each
          opens the lightbox, where another can be made the main photo, and while
          there is more than one, carries Remove. Removing the hero makes the next
          newest the hero; its key keeps the new hero's Remove fresh. */}
      <PhotoLightbox slides={slides} title={`Photos of ${name}`} choice={several ? { endpoint: `/api/plants/${plant.id}`, noun: "main photo" } : undefined}>
        <section aria-label="Photos" className="gallery">
          {hero ? (
            <Photo key={hero.id} photo={hero} removeFrom={removeFrom} several={several} hero />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-[22px] border border-line bg-sage">
              <LeafMark size={96} className="text-[#6B8F66]" />
            </div>
          )}
          <ul className="gallery-tiles">
            {rest.map((p) => (
              <li key={p.id}>
                <Photo photo={p} removeFrom={removeFrom} />
              </li>
            ))}
            <li>
              <PhotoAdder
                plantId={plant.id}
                countLine={plant.photos.length === 0 ? "No photos yet." : plant.photos.length === 1 ? "1 photo so far." : "Open one to choose the main photo."}
              />
            </li>
          </ul>
        </section>
      </PhotoLightbox>

      <div className="flex flex-wrap items-start gap-7">
        <section aria-labelledby="facts-h" className="card flex min-w-0 flex-[999_1_560px] flex-col gap-5 p-5 sm:px-8 sm:py-7">
          <h2 id="facts-h" className="text-section leading-tight">
            About this <Term k="specimen" />
          </h2>
          <PlantEditor
            id={plant.id}
            facts={{ location: plant.location, acquiredOn: plant.acquiredOn, status: plant.status }}
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
}: {
  photo: PlantPhoto;
  removeFrom: number | null;
  several?: boolean;
  hero?: boolean;
}) {
  const caption = photoCaption(photo, several);
  const when = photoCaption(photo);
  return (
    <figure className={`relative m-0 aspect-square overflow-hidden border border-line bg-sage ${hero ? "rounded-[22px]" : "rounded-[16px]"}`}>
      <OpenPhoto slideKey={`photo-${photo.id}`} label={`See the photo ${when.charAt(0).toLowerCase()}${when.slice(1)} full size`} className="h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={hero ? photo.url : photo.thumbUrl}
          srcSet={hero ? undefined : `${photo.thumbUrl} 240w, ${photo.url} 1280w`}
          sizes={hero ? undefined : "(min-width: 640px) 180px, 45vw"}
          alt=""
          loading={hero ? "eager" : "lazy"}
          className="h-full w-full object-cover"
        />
      </OpenPhoto>
      {/* The species gallery's captions: a pill on the hero, a bar across the foot of a tile. */}
      <figcaption
        className={`pointer-events-none absolute bg-[rgba(30,42,28,.82)] font-semibold text-white ${hero ? "bottom-3 left-3 rounded-pill px-3 py-1.5 text-[13px]" : "inset-x-0 bottom-0 truncate px-2 py-1 text-center text-[11px]"}`}
      >
        {caption}
      </figcaption>
      {removeFrom !== null ? <PhotoRemover plantId={removeFrom} photoId={photo.id} caption={when} small={!hero} /> : null}
    </figure>
  );
}
