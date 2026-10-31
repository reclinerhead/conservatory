"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SpeciesHit } from "@/app/api/species/route";
import { Term } from "@/components/term";
import type { JobView } from "@/lib/jobs";
import { percent, planPills, type Pill } from "@/lib/pills";
import { shrinkToJpeg } from "@/lib/shrink";

// One plant per screen (#7). Everything Échoes learned about older users and
// mis-taps: large targets, one tap to name, every commit saved at once, and
// a Change link that reverses it cleanly. The same screen serves the person
// who comes back to a strip of waiting photos and the one standing in front
// of the plant: an unsettled job polls until Fern answers, with the pill area
// reserved so nothing moves when they arrive.

type Props = {
  initialJob: JobView;
  waiting: number;
  position: number;
  nextJobId: number | null;
  lastSpecimen: { id: number; name: string } | null;
};

type Named = { specimenId: number; name: string; nextJobId: number | null };

export function Namer({ initialJob, waiting, position, nextJobId: initialNext, lastSpecimen }: Props) {
  const router = useRouter();
  const [job, setJob] = useState<JobView>(initialJob);
  const [named, setNamed] = useState<Named | null>(
    initialJob.confirmation ? { specimenId: initialJob.confirmation.specimenId, name: initialJob.confirmation.name, nextJobId: initialNext } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [cultivar, setCultivar] = useState("");
  const [hits, setHits] = useState<SpeciesHit[]>([]);
  const [armedDismiss, setArmedDismiss] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const addRef = useRef<HTMLInputElement>(null);

  const settled = job.status === "identified" || job.status === "rejected" || job.status === "failed";
  const plan = planPills(job.candidates);
  const nextJobId = named?.nextJobId ?? initialNext;

  // On-the-spot flow: poll until Fern has answered.
  useEffect(() => {
    if (settled) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        if (!r.ok || stopped) return;
        const fresh = (await r.json()) as JobView;
        if (!stopped) setJob(fresh);
      } catch {
        /* next tick */
      }
    };
    const id = setInterval(tick, 1500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [settled, job.id]);

  // Autocomplete over the species already in the collection.
  useEffect(() => {
    let stopped = false;
    const run = async () => {
      try {
        const r = await fetch(`/api/species?q=${encodeURIComponent(typed)}`, { cache: "no-store" });
        if (!r.ok || stopped) return;
        setHits((await r.json()) as SpeciesHit[]);
      } catch {
        /* no suggestions */
      }
    };
    const t = setTimeout(run, typed ? 150 : 0);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
    // Refetched after a naming or a Change too: both move plants in and out of the roster.
  }, [typed, named]);

  async function confirm(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${job.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, cultivar: cultivar.trim() || undefined }),
      });
      const data = (await r.json()) as Named & { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      setNamed(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  async function change() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${job.id}/confirm`, { method: "DELETE" });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `server ${r.status}`);
      setNamed(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not undo");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!armedDismiss) {
      setArmedDismiss(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${job.id}/dismiss`, { method: "POST" });
      const data = (await r.json()) as { nextJobId: number | null; error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      router.push(data.nextJobId ? `/name/${data.nextJobId}` : "/name");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not remove");
      setBusy(false);
    }
  }

  async function addPhoto(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { blob, mime } = await shrinkToJpeg(file);
      const form = new FormData();
      form.append("file", new File([blob], file.name, { type: mime }));
      form.append("organ", "auto");
      const r = await fetch(`/api/jobs/${job.id}/photos`, { method: "POST", body: form });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `server ${r.status}`);
      const fresh = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      if (fresh.ok) setJob((await fresh.json()) as JobView);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not add the photo");
    } finally {
      setBusy(false);
    }
  }

  const photo = job.photos[photoIndex] ?? job.photos[0];
  const genusExample = plan.pills[0]?.genus ? `Here, the genus is ${plan.pills[0].genus}.` : undefined;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-h2 leading-tight">Name this plant</h1>
          <p className="mt-1 text-meta text-ink-2 tabular-nums">
            {named
              ? waiting > 0
                ? `${waiting} still waiting`
                : "Nothing else is waiting"
              : waiting > 0
                ? `${position} of ${waiting} waiting`
                : "Nothing else is waiting"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!named && nextJobId ? (
            <Link href={`/name/${nextJobId}`} className="btn btn-ghost hover:no-underline">
              Skip for now
            </Link>
          ) : null}
          <Link href="/" className="btn btn-ghost hover:no-underline">
            Done for now
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {/* The photo */}
        <section className="card flex w-full flex-[1_1_360px] flex-col overflow-hidden lg:max-w-[560px]" aria-label="The photo">
          <div className="flex max-h-[70vh] min-h-[280px] items-center justify-center bg-sage">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.url} alt="" className="max-h-[70vh] w-full object-contain" />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 p-3">
            {job.photos.length > 1
              ? job.photos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPhotoIndex(i)}
                    aria-pressed={i === photoIndex}
                    className={`thumb overflow-hidden border-2 ${i === photoIndex ? "border-moss" : "border-transparent"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                  </button>
                ))
              : null}
            {!named && job.photos.length < 5 ? (
              <>
                <button type="button" disabled={busy} onClick={() => addRef.current?.click()} className="btn btn-soft btn-compact">
                  Add another photo of this plant
                </button>
                <input
                  ref={addRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void addPhoto(f);
                    e.target.value = "";
                  }}
                />
              </>
            ) : null}
            {photo?.takenAt ? <span className="ml-auto text-meta text-ink-3">Taken {photo.takenAt.slice(0, 10)}</span> : null}
          </div>
        </section>

        {/* The naming */}
        <section className="card flex w-full flex-[1_1_320px] flex-col gap-4 p-5" aria-label="The name">
          {named ? (
            <>
              <p className="text-meta text-ink-2">Named</p>
              <p className="text-section">
                <em className="sp text-ink">{named.name}</em>
              </p>
              <p className="text-body text-ink-2">
                It is in your collection now. You can give it a nickname and a place on its own page.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {nextJobId ? (
                  <Link href={`/name/${nextJobId}`} className="btn btn-primary text-white hover:text-white hover:no-underline">
                    Next plant
                  </Link>
                ) : (
                  <Link href="/" className="btn btn-primary text-white hover:text-white hover:no-underline">
                    Back to the Conservatory
                  </Link>
                )}
                <button type="button" disabled={busy} onClick={change} className="btn btn-ghost">
                  Change
                </button>
              </div>
            </>
          ) : !settled ? (
            <>
              <p className="text-lead font-bold">Fern is looking…</p>
              <p className="text-meta text-ink-2">Usually a few seconds. The suggestions appear here.</p>
              <div className="flex flex-col gap-2" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-pill border border-line bg-ground" />
                ))}
              </div>
            </>
          ) : (
            <>
              {plan.lowConfidence ? (
                <p className="text-body text-ink-2">
                  {plan.pills.length === 0 ? "Fern could not place this one. " : "Fern is not sure about this one. "}
                  Type the name if you know it{plan.pills.length > 0 ? ", or pick a guess below" : ""}.
                </p>
              ) : (
                <p className="text-body text-ink-2">
                  Tap the right name, or type one. <Term k="confidence">The number</Term> is how sure Fern is.
                </p>
              )}

              {plan.lowConfidence ? nameField() : null}

              {plan.pills.length > 0 ? (
                <div className="flex flex-col gap-2" role="group" aria-label="Fern's suggestions">
                  {plan.pills.map((p) => (
                    <PillButton key={`${p.kind}-${p.rank}`} pill={p} disabled={busy} onPick={() => confirm({ kind: p.kind, rank: p.rank })} />
                  ))}
                </div>
              ) : null}

              {!plan.lowConfidence ? nameField() : null}

              <label className="flex flex-col gap-1 text-meta text-ink-2">
                <span>
                  Name on the nursery tag, if any (<Term k="cultivar" />)
                </span>
                <input
                  type="text"
                  value={cultivar}
                  onChange={(e) => setCultivar(e.target.value)}
                  placeholder="Black Prince"
                  className="min-h-11 rounded-pill border border-line-2 bg-surface px-4 text-body text-ink placeholder:text-ink-3"
                />
              </label>

              <p className="text-meta text-ink-2">
                A <Term k="scientific-name" /> is two words in italics: the <Term k="genus" example={genusExample} /> and the{" "}
                <Term k="species" />.
              </p>

              <div className="mt-1 flex flex-wrap gap-2 border-t border-line pt-4">
                {lastSpecimen ? (
                  <button type="button" disabled={busy} onClick={() => confirm({ sameAsSpecimenId: lastSpecimen.id })} className="btn btn-soft">
                    Same plant as the last one
                    <span className="font-normal text-ink-2">({lastSpecimen.name})</span>
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={dismiss} onBlur={() => setArmedDismiss(false)} className="btn btn-ghost">
                  {armedDismiss ? "Tap again to remove this photo" : "Not a plant"}
                </button>
              </div>
            </>
          )}
          {error ? <p className="text-meta text-warn-ink">{error}</p> : null}
        </section>
      </div>
    </>
  );

  // A render function, not a nested component: a component declared inside
  // Namer would be a new type on every render, and React would remount the
  // input on each keystroke and drop the focus.
  function nameField() {
    const show = typed.length > 0 ? hits : hits.filter((h) => h.specimens > 0);
    return (
      <form
        className="relative flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) void confirm({ typedName: typed });
        }}
      >
        <label className="flex flex-col gap-1 text-meta text-ink-2">
          <span>{plan.lowConfidence ? "The name" : "Or type the name"}</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Echeveria, or Echeveria agavoides"
              autoComplete="off"
              className="min-h-11 min-w-0 flex-1 rounded-pill border border-line-2 bg-surface px-4 text-body text-ink placeholder:text-ink-3"
            />
            <button type="submit" disabled={busy || !typed.trim()} className="btn btn-primary">
              Name it
            </button>
          </div>
        </label>
        {show.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Already in your collection">
            {show.slice(0, 6).map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => confirm({ typedName: h.scientificName, cultivar: h.cultivar ?? undefined })}
                  className="chip chip-compact"
                >
                  <em className="sp text-ink">{h.scientificName}</em>
                  {h.cultivar ? <span>&lsquo;{h.cultivar}&rsquo;</span> : null}
                  <span className="font-normal opacity-80">{h.specimens}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </form>
    );
  }
}

function PillButton({ pill, disabled, onPick }: { pill: Pill; disabled: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-label={`${pill.scientificName}${pill.kind === "genus" ? ", genus, species unsure" : pill.commonName ? `, ${pill.commonName}` : ""}, ${percent(pill.score)}`}
      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-pill border border-line-2 bg-surface px-5 py-2 text-left hover:border-line-strong hover:bg-sage disabled:opacity-60"
    >
      <span className="min-w-0">
        <em className="sp block truncate text-lead text-ink">{pill.scientificName}</em>
        <span className="block truncate text-meta text-ink-2">
          {pill.kind === "genus" ? `genus · ${pill.note}` : pill.commonName ?? "species"}
        </span>
      </span>
      <span className="shrink-0 text-body font-bold tabular-nums text-moss">{percent(pill.score)}</span>
    </button>
  );
}
