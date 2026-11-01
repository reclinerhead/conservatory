import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoAdder } from "@/components/photo-adder";
import { PlantEditor } from "@/components/plant-editor";
import { Term } from "@/components/term";
import { LeafMark } from "@/components/topbar";
import { dayLabel, displayName, metaLine, STATUS_LABEL, tileName } from "@/lib/collection";
import { withReadDb } from "@/lib/jobs";
import { relativeCount, relativesLine, relativesOf } from "@/lib/relatives";
import { speciesList } from "@/lib/species";
import { knownLocations, readSpecimen } from "@/lib/specimens";

// /plants/[id]: one specimen. Breadcrumb, title block, its photos as a
// timeline, the editable facts, and its species in the side column with how
// many relatives it has and a link to the species page. Minimal on purpose:
// care, events and tags arrive with the phases that bring them.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plant = withReadDb((db) => readSpecimen(db, Number(id)), null);
  return { title: plant ? `${tileName({ ...plant, scientificName: plant.species.scientificName, cultivar: plant.species.cultivar })} · The Conservatory` : "The Conservatory" };
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
  const name = tileName({ nickname: plant.nickname, scientificName: sp.scientificName, cultivar: sp.cultivar });
  const [hero, ...rest] = plant.photos;
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
          {name}
        </span>
      </nav>

      {/* Title block, DESIGN.md §5: name, the Latin name in italics, a row of tags. */}
      <div className="flex flex-col gap-2.5">
        <h1 className="text-h1 leading-[1.05] sm:text-page-title">{plant.nickname ?? <Binomial scientificName={sp.scientificName} cultivar={sp.cultivar} />}</h1>
        <p className="font-display text-section leading-tight text-ink-2">
          {plant.nickname ? (
            <Binomial scientificName={sp.scientificName} cultivar={sp.cultivar} />
          ) : (
            <span className="font-sans text-body">No nickname yet</span>
          )}{" "}
          <span className="font-sans text-body">
            <Term k="scientific-name">
              <span className="sr-only">scientific name</span>
            </Term>
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {plant.status !== "alive" ? <span className="tag tag-warn">{STATUS_LABEL[plant.status]}</span> : null}
          <span className="tag">{metaLine(plant)}</span>
          <span className="tag">{plant.photos.length === 1 ? "1 photo" : `${plant.photos.length} photos`}</span>
        </div>
      </div>

      {/* Photos, newest first. The hero is the newest; each opens the original. */}
      <section aria-label="Photos" className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        {hero ? (
          <Photo photo={hero} hero />
        ) : (
          <div className="flex h-[320px] items-center justify-center rounded-[22px] border border-line bg-sage sm:col-span-2 sm:h-[480px]">
            <LeafMark size={96} className="text-[#6B8F66]" />
          </div>
        )}
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-1">
            {rest.slice(0, 2).map((p) => (
              <Photo key={p.id} photo={p} />
            ))}
          </div>
          <div className="flex flex-1 flex-col justify-end gap-2 rounded-tile bg-sage px-4 py-3">
            <PhotoAdder
              plantId={plant.id}
              countLine={plant.photos.length === 0 ? "No photos yet." : plant.photos.length === 1 ? "1 photo of this plant." : `${plant.photos.length} photos of this plant, newest first.`}
            />
          </div>
        </div>
        {rest.length > 2 ? (
          <ul className="grid grid-cols-2 gap-3.5 sm:col-span-3 sm:grid-cols-4 lg:grid-cols-6">
            {rest.slice(2).map((p) => (
              <li key={p.id}>
                <Photo photo={p} small />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

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

function Photo({ photo, hero = false, small = false }: { photo: { url: string; thumbUrl: string; takenAt: string | null; uploadedAt: string }; hero?: boolean; small?: boolean }) {
  const caption = photo.takenAt ? `Taken ${dayLabel(photo.takenAt)}` : `Added ${dayLabel(photo.uploadedAt)}`;
  const h = hero ? "h-[320px] sm:h-[480px]" : small ? "h-[120px]" : "h-[160px] sm:h-[233px]";
  return (
    <figure className={`relative m-0 overflow-hidden border border-line bg-sage ${hero ? "rounded-[22px] sm:col-span-2" : "rounded-tile"} ${h}`}>
      <a href={photo.url} target="_blank" rel="noreferrer" className="block h-full" title="Open the full-size photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hero ? photo.url : photo.thumbUrl} alt="" loading={hero ? "eager" : "lazy"} className="h-full w-full object-cover" />
      </a>
      <figcaption
        className={`pointer-events-none absolute bottom-3 left-3 rounded-pill bg-[rgba(30,42,28,.82)] font-semibold text-white ${small ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-[13px]"}`}
      >
        {caption}
      </figcaption>
    </figure>
  );
}
