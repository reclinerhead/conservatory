"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { JobView } from "@/app/api/jobs/[id]/route";
import { LeafMark } from "@/components/topbar";
import { exifTakenAt } from "@/lib/exif";
import { isSettled } from "@/lib/job-state";
import { NoRetry, withRetry } from "@/lib/retry";
import { decodeHeic, shrinkToJpeg } from "@/lib/shrink";

// /add (#58): one plant at a time, up to five photos, all of them on one job,
// so Fern asks Pl@ntNet with every photo of the plant together. The plant
// card is where a plant is put together; "Send this plant" moves it into the
// sent strip at the top and leaves an empty next plant at once. Photos go up
// one request each, then POST /api/jobs makes the job from their ids, so Fern
// never starts on half a plant. No organ chips: every photo goes as `auto`,
// which Pl@ntNet's docs say is fine; the tips aside says what helps instead.
// A HEIC the browser cannot draw is decoded in the page (#60). On a computer,
// photos can be dragged onto the page as well as chosen (#73).

type Photo = {
  key: string;
  file: File;
  preview: string;
  // reading: a HEIC this browser cannot draw, being decoded in the page (#60);
  // none: a file it cannot draw or decode, which still goes up for Fern to re-encode.
  look: "photo" | "reading" | "none";
};

type Plant = {
  key: string;
  photos: Photo[];
  state: "queued" | "sending" | "waiting" | "settled" | "error";
  sent: number; // photos the Conservatory has
  attempt: number; // the try of the request in flight
  jobId?: number;
  job?: JobView;
  error?: string;
};

const MAX_PHOTOS = 5; // Fern's MAX_IMAGES: the most Pl@ntNet takes for one plant
const ATTEMPTS = 4; // waits of 0.8, 1.6 and 3.2 s between them, as the plant page's Add a photo
const BASE_MS = 800;
const SEND_TIMEOUT_MS = 60_000; // a request the Wi-Fi dropped mid-way must not hang the plant
const POLL_MS = 1500;
const FULL = "This plant has five photos, the most Fern can send. Send it, or remove one first.";

/** A dropped file the page can send: an image by type, or a HEIC by name (Windows gives some no type). */
function isPhoto(f: File): boolean {
  return f.type.startsWith("image/") || /\.hei[cf]$/i.test(f.name);
}

function carriesFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

/** Why a plant did not go, in words; status is null when the Conservatory was never reached. */
function sendError(status: number | null): string {
  if (status === null) return "Couldn't reach the Conservatory. Check the Wi-Fi, then send it again.";
  if (status === 404) return "The Conservatory no longer has its photos. Send it again to send them afresh.";
  if (status === 413) return "One of its photos is too big to send. The limit is 25 MB.";
  if (status === 415) return "One of its files isn't a photo.";
  if (status === 503) return "Fern isn't running on the computer yet.";
  return `The Conservatory couldn't save it (error ${status}).`;
}

/** A 4xx other than 408 and 429 will not change on a retry. */
function refuseOrThrow(r: Response) {
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new NoRetry(`refused (${r.status})`);
  if (!r.ok) throw new Error(`server ${r.status}`);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function Uploader() {
  const [current, setCurrent] = useState<Photo[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false); // photos are being dragged over the page
  const cameraRef = useRef<HTMLInputElement>(null);
  const rollRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0); // a counter, not crypto.randomUUID, which a phone on the house's plain-http LAN does not have
  const uploaded = useRef(new Map<string, number>()); // photo key -> photos.id, once the Conservatory has it
  const decoded = useRef(new Map<string, Promise<File | null>>()); // photo key -> its HEIC as a JPEG, once the browser could not draw it
  const gone = useRef(new Set<string>()); // photos removed while their decode was still running
  const line = useRef<Promise<void>>(Promise.resolve()); // plants send one after another

  function pick(input: HTMLInputElement | null) {
    if (current.length >= MAX_PHOTOS) setNotice(FULL);
    else input?.click();
  }

  // notPhotos: dropped files already left out because they aren't photos. A
  // picker's `accept` keeps those out of a choice; nothing filters a drop.
  function add(files: File[], notPhotos = 0) {
    if (files.length === 0 && notPhotos === 0) return;
    const next = files.slice(0, MAX_PHOTOS - current.length).map<Photo>((file) => ({
      key: String(++nextKey.current),
      file,
      preview: URL.createObjectURL(file),
      look: "photo",
    }));
    const left = files.length - next.length;
    setCurrent((cur) => [...cur, ...next]);
    const said: string[] = [];
    if (left > 0) said.push(next.length === 0 ? FULL : `${count(left, "photo")} ${left === 1 ? "wasn't" : "weren't"} added: Fern can send five of one plant at most.`);
    if (notPhotos > 0) said.push(`${count(notPhotos, "file")} ${notPhotos === 1 ? "isn't a photo and wasn't" : "aren't photos and weren't"} added.`);
    setNotice(said.length > 0 ? said.join(" ") : null);
  }

  // Photos dragged in from the computer. The whole page takes the drop, so one
  // that misses the card still lands on the plant: left to itself the browser
  // would open the photo in place of the page, and lose the plants not yet
  // sent. While files are over the page the card lifts and its empty slots
  // show where they go. Enter and leave fire for every element crossed, so a
  // count of them, not a flag, says when the drag has left the window. No
  // mouse event fires during a drag, so a mouse move means it is over, and
  // clears a lift whose last leave never came.
  const dropped = useEffectEvent((files: File[]) => {
    const photos = files.filter(isPhoto);
    add(photos, files.length - photos.length);
  });
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault(); // the page accepts the drop
      e.dataTransfer!.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault(); // and the browser doesn't open the photo
      depth = 0;
      setDragging(false);
      dropped(Array.from(e.dataTransfer!.files));
    };
    const moved = () => {
      if (depth === 0) return;
      depth = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("mousemove", moved);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("mousemove", moved);
    };
  }, []);

  function removePhoto(key: string) {
    const p = current.find((x) => x.key === key);
    if (p) forget(p);
    setCurrent((cur) => cur.filter((x) => x.key !== key));
    setNotice(null);
  }

  function forget(p: Photo) {
    URL.revokeObjectURL(p.preview);
    gone.current.add(p.key);
  }

  // The <img> failing is the one sign this browser cannot draw the file (an
  // iPhone draws HEIC itself and never gets here). Decode it in the page, show
  // the JPEG, and keep it for the send; a file that isn't a HEIC, or one the
  // decoder can't read, gets "No preview" and goes up as it is (#60).
  function noPreview(p: Photo) {
    if (decoded.current.has(p.key)) return;
    patchPhoto(p.key, { look: "reading" });
    const job = decodeHeic(p.file).then((jpeg) => {
      if (gone.current.has(p.key)) return jpeg;
      if (!jpeg) patchPhoto(p.key, { look: "none" });
      else {
        URL.revokeObjectURL(p.preview);
        patchPhoto(p.key, { look: "photo", preview: URL.createObjectURL(jpeg) });
      }
      return jpeg;
    });
    decoded.current.set(p.key, job);
  }

  function patchPhoto(key: string, change: Partial<Photo>) {
    const mark = (ps: Photo[]) => ps.map((p) => (p.key === key ? { ...p, ...change } : p));
    setCurrent(mark);
    setPlants((cur) => cur.map((pl) => (pl.photos.some((p) => p.key === key) ? { ...pl, photos: mark(pl.photos) } : pl)));
  }

  function patch(key: string, change: Partial<Plant>) {
    setPlants((cur) => cur.map((pl) => (pl.key === key ? { ...pl, ...change } : pl)));
  }

  function enqueue(plant: Plant) {
    line.current = line.current.then(() => sendPlant(plant));
  }

  function sendThis() {
    if (current.length === 0) return;
    const plant: Plant = { key: String(++nextKey.current), photos: current, state: "queued", sent: 0, attempt: 0 };
    setPlants((cur) => [...cur, plant]);
    setCurrent([]);
    setNotice(null);
    enqueue(plant);
    // The button is at the foot of the card and the sent strip is at the top
    // of the page: go there, so Fern's status is what the person sees next.
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function sendAgain(plant: Plant) {
    patch(plant.key, { state: "queued", error: undefined });
    enqueue(plant);
  }

  function removePlant(plant: Plant) {
    for (const p of plant.photos) forget(p);
    setPlants((cur) => cur.filter((pl) => pl.key !== plant.key)); // photos it already sent are swept by the next upload a day later
  }

  // Every photo first, each its own request with retry, so a drop on the third
  // keeps the first two; then the job, so Fern only ever sees the whole plant.
  // Never throws: the line of plants behind it must keep moving.
  async function sendPlant(plant: Plant) {
    const have = uploaded.current;
    const ids = () => plant.photos.flatMap((p) => (have.has(p.key) ? [have.get(p.key)!] : []));
    patch(plant.key, { state: "sending", attempt: 0, sent: ids().length, error: undefined });
    for (const p of plant.photos) {
      if (have.has(p.key)) continue;
      const res = await sendPhoto(plant.key, p);
      if (!res.ok) {
        patch(plant.key, { state: "error", error: sendError(res.status) });
        return;
      }
      have.set(p.key, res.photoId);
      patch(plant.key, { sent: ids().length });
    }
    const made = await makeJob(plant.key, ids());
    if (!made.ok) {
      if (made.status === 404) for (const p of plant.photos) have.delete(p.key); // swept: send them afresh
      patch(plant.key, { state: "error", error: sendError(made.status) });
      return;
    }
    patch(plant.key, { state: "waiting", jobId: made.jobId });
  }

  async function sendPhoto(plantKey: string, p: Photo): Promise<{ ok: true; photoId: number } | { ok: false; status: number | null }> {
    let status: number | null = null;
    try {
      const takenAt = exifTakenAt(await p.file.arrayBuffer()); // from the original: the decode and the shrink both drop EXIF
      const jpeg = await decoded.current.get(p.key); // a decode still running is waited for, never run twice
      const { blob, mime } = await shrinkToJpeg(jpeg ?? p.file);
      const res = await withRetry(
        async (attempt) => {
          patch(plantKey, { attempt });
          status = null;
          const form = new FormData();
          form.append("file", new File([blob], p.file.name, { type: mime }));
          if (takenAt) form.append("takenAt", takenAt);
          const r = await fetch("/api/photos", { method: "POST", body: form, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
          status = r.status;
          refuseOrThrow(r);
          return (await r.json()) as { photoId: number };
        },
        { attempts: ATTEMPTS, baseMs: BASE_MS },
      );
      return { ok: true, photoId: res.photoId };
    } catch {
      return { ok: false, status };
    }
  }

  async function makeJob(plantKey: string, photoIds: number[]): Promise<{ ok: true; jobId: number } | { ok: false; status: number | null }> {
    let status: number | null = null;
    try {
      const res = await withRetry(
        async (attempt) => {
          patch(plantKey, { attempt });
          status = null;
          const r = await fetch("/api/jobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ photoIds }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          });
          status = r.status;
          refuseOrThrow(r);
          return (await r.json()) as { jobId: number };
        },
        { attempts: ATTEMPTS, baseMs: BASE_MS },
      );
      return { ok: true, jobId: res.jobId };
    } catch {
      return { ok: false, status };
    }
  }

  // Ask after every sent plant until Fern has answered: all of them every
  // 1.5 s, the next round once the last has answered.
  const watching = plants.flatMap((pl) => (pl.state === "waiting" && pl.jobId ? [pl.jobId] : [])).join(",");
  useEffect(() => {
    if (!watching) return;
    const ids = watching.split(",").map(Number);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await Promise.all(
        ids.map(async (id) => {
          try {
            const r = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
            if (!r.ok) return;
            const job = (await r.json()) as JobView;
            if (stopped) return;
            setPlants((cur) =>
              cur.map((pl) =>
                pl.jobId !== id || (pl.job?.status === job.status && pl.job?.nextAttemptAt === job.nextAttemptAt)
                  ? pl
                  : { ...pl, job, state: isSettled(job) ? "settled" : "waiting" },
              ),
            );
          } catch {
            /* try again next round */
          }
        }),
      );
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [watching]);

  const sending = plants.filter((pl) => pl.state === "queued" || pl.state === "sending").length;
  const failed = plants.filter((pl) => pl.state === "error").length;

  let summary: string;
  if (dragging && current.length < MAX_PHOTOS) summary = "Let go to add them to this plant.";
  else if (notice) summary = notice;
  else if (current.length === 0) summary = plants.length === 0 ? "Take or choose the photos of one plant." : "Ready for the next plant.";
  else summary = `${count(current.length, "photo")} of this plant, ready to send.${current.length === MAX_PHOTOS ? " That's the most Fern can send." : ""}`;

  return (
    <div className="flex flex-col gap-7">
      {/* The plants sent, as one strip at the top in the dashboard's pending
          strip's shape. It arrives with the first press of "Send this plant",
          a shift the person's own press makes, and after that its height never
          changes however many plants follow. */}
      {plants.length > 0 ? (
        <SentStrip
          plants={plants}
          onNoPreview={noPreview}
          onSendAgain={() => plants.filter((pl) => pl.state === "error").forEach(sendAgain)}
          onRemove={() => plants.filter((pl) => pl.state === "error").forEach(removePlant)}
        />
      ) : null}

      <section
        aria-labelledby="plant-h"
        className={`card flex flex-col gap-5 p-5 transition-[border-color,box-shadow] duration-[120ms] sm:px-8 sm:py-7 ${dragging ? "border-line-strong shadow-hover" : ""}`}
      >
        <h2 id="plant-h" className="text-section leading-tight">
          {plants.length === 0 ? "This plant" : "The next plant"}
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={() => pick(cameraRef.current)} className="btn btn-primary min-h-14">
            <CameraIcon />
            Take a photo
          </button>
          <button type="button" onClick={() => pick(rollRef.current)} className="btn btn-soft min-h-14">
            <RollIcon />
            Choose from the camera roll
          </button>
          {/* Said only where there is a mouse to drag with. */}
          <p className="hidden self-center text-body text-ink-2 pointer-fine:block">or drop photos here</p>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <input
            ref={rollRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>

        {/* Five slots, always drawn, so a photo fills a slot and moves nothing. */}
        <ul aria-label="Its photos" className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {Array.from({ length: MAX_PHOTOS }, (_, i) => {
            const p = current[i];
            return p ? (
              <li key={p.key} className="flex flex-col gap-2">
                <Thumb photo={p} onNoPreview={() => noPreview(p)} className="aspect-square w-full" />
                <button type="button" onClick={() => removePhoto(p.key)} aria-label={`Remove photo ${i + 1}`} className="btn btn-ghost btn-compact w-full px-3">
                  Remove
                </button>
              </li>
            ) : (
              <li key={`slot-${i}`} aria-hidden className="flex flex-col gap-2">
                <div
                  className={`flex aspect-square w-full items-center justify-center rounded-thumb border-2 border-dashed transition-colors duration-[120ms] ${dragging ? "border-moss bg-sage" : "border-line-2 bg-ground"}`}
                >
                  <span className={`font-display text-[22px] ${dragging ? "text-moss" : "text-line-strong"}`}>{i + 1}</span>
                </div>
                <div className="h-10" />
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p aria-live="polite" className="min-h-[2lh] text-body text-ink-2 sm:min-h-[1lh]">
            {summary}
          </p>
          <div className="min-h-11 sm:w-[260px] sm:flex-none">
            {current.length > 0 ? (
              <button type="button" onClick={sendThis} className="btn btn-primary w-full">
                Send this plant
              </button>
            ) : plants.length > 0 && sending === 0 && failed === 0 ? (
              <Link href="/" className="btn btn-soft w-full hover:no-underline">
                Back to the Conservatory
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {/* What helps Fern, from Pl@ntNet's own ranking of the organs (flower,
          fruit, leaf, the whole plant; bark least). No coin for scale: Pl@ntNet
          is a classifier with no notion of size. Read the first time, then out
          of the way under the card. */}
      <aside aria-label="Photo tips" className="rounded-tile bg-sage px-5 py-5 sm:px-7 sm:py-6">
        <h2 className="text-h3 leading-tight">For the best guess, three photos of each plant</h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3 md:gap-7">
          <Tip icon={<FlowerIcon />} lead="The flower, if it has one." why="A flower tells Fern the most, and a fruit or seed head nearly as much." />
          <Tip icon={<LeafIcon />} lead="One leaf, filling the frame." why="Close, in daylight, against something plain if you can." />
          <Tip icon={<PlantIcon />} lead="The whole plant." why="How it grows is a clue of its own, and the photo you'll want on its page." />
        </ul>
      </aside>
    </div>
  );
}

function Tip({ icon, lead, why }: { icon: React.ReactNode; lead: string; why: string }) {
  return (
    <li className="flex gap-3.5">
      <span className="mt-px flex-none text-moss">{icon}</span>
      <p className="text-body text-ink-2">
        <strong className="font-bold text-ink">{lead}</strong> {why}
      </p>
    </li>
  );
}

function Thumb({ photo, onNoPreview, className }: { photo: Photo; onNoPreview: () => void; className: string }) {
  return (
    <div className={`overflow-hidden rounded-thumb bg-tile-2 ${className}`}>
      {photo.look !== "photo" ? (
        <div className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center">
          <LeafMark size={34} className={`text-moss ${photo.look === "reading" ? "animate-pulse motion-reduce:animate-none" : ""}`} />
          <span className="text-meta text-ink-2">{photo.look === "reading" ? "Reading the photo…" : "No preview"}</span>
        </div>
      ) : (
        // Not draggable: a preview dragged about the page must never be taken for a photo dropped in.
        // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, nothing for next/image to optimise
        <img src={photo.preview} alt="" draggable={false} onError={onNoPreview} className="size-full object-cover" />
      )}
    </div>
  );
}

/** "1 is still sending and 2 are with Fern". */
function listOf(parts: string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** What Fern said about a settled plant, for the strip's line. */
function answerLine(plant: Plant, which: string): React.ReactNode {
  const job = plant.job;
  const top = job?.candidates.find((c) => c.kind === "species");
  if (job?.status === "identified" && top)
    return (
      <>
        Fern says <em className="sp">{top.scientificName}</em>
        {top.commonNames[0] ? ` (${top.commonNames[0]})` : ""} for {which}, at {Math.round(top.score * 100)}%.
      </>
    );
  if (job?.status === "rejected") return `Fern found no match for ${which}; you can name it yourself.`;
  return `Fern couldn't look at ${which}${job?.error ? ` (${job.error})` : ""}; the name is up to you.`;
}

// What the strip says follows the most pressing state among the plants: one
// that couldn't be sent first, since only this page has its photos; then
// plants Fern has answered, with the latest answer and the way to the confirm
// screen; then plants still sending; then plants with Fern. The rest are a
// sentence after it. The button's room is always kept, so the box is one size.
function SentStrip({
  plants,
  onNoPreview,
  onSendAgain,
  onRemove,
}: {
  plants: Plant[];
  onNoPreview: (photo: Photo) => void;
  onSendAgain: () => void;
  onRemove: () => void;
}) {
  const failed = plants.filter((pl) => pl.state === "error");
  const toName = plants.filter((pl) => pl.state === "settled");
  const sending = plants.filter((pl) => pl.state === "queued" || pl.state === "sending");
  const waiting = plants.filter((pl) => pl.state === "waiting");
  const are = (xs: Plant[]) => (xs.length === 1 ? "is" : "are");

  let heading: string;
  let line: React.ReactNode = "";
  let lead: Plant[]; // the plants the heading is about
  let action: React.ReactNode = null;
  if (failed.length > 0) {
    lead = failed;
    heading = `${count(failed.length, "plant")} couldn’t be sent`;
    line = failed[0].error ?? "";
    action = (
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onSendAgain} className="btn btn-primary">
          {failed.length === 1 ? "Send it again" : "Send them again"}
        </button>
        <button type="button" onClick={onRemove} className="btn btn-soft">
          {failed.length === 1 ? "Remove" : "Remove them"}
        </button>
      </div>
    );
  } else if (toName.length > 0) {
    lead = toName;
    heading = `${count(toName.length, "plant")} waiting for a name`;
    line = answerLine(toName[toName.length - 1], toName.length === 1 ? "it" : "the last one");
    action = (
      <Link href={`/name/${toName[0].jobId}`} className="btn btn-primary text-white hover:text-white hover:no-underline">
        {toName.length === 1 ? "Name it" : "Name them"}
      </Link>
    );
  } else if (sending.length > 0) {
    lead = sending;
    heading = `${count(sending.length, "plant")} sending`;
    const pl = sending.find((x) => x.state === "sending");
    const n = pl?.photos.length ?? 0;
    const tries = pl && pl.attempt > 1 ? `, try ${pl.attempt} of ${ATTEMPTS}` : "";
    line = !pl ? "Waiting its turn to send…" : n > 1 && pl.sent < n ? `Sending photo ${pl.sent + 1} of ${n}${tries}…` : `Sending${tries}…`;
  } else {
    lead = waiting;
    heading = `${count(waiting.length, "plant")} with Fern`;
    line = waiting.some((pl) => pl.job?.status === "identifying")
      ? "Fern is looking…"
      : waiting.some((pl) => pl.job?.status === "failed") // failed with a next attempt: Fern will retry (#61)
        ? "Fern couldn’t reach Pl@ntNet just now and will try again shortly."
        : "In the queue…";
  }
  if (!action) {
    // The strip's button, invisible (so out of the tab order and unread), keeping its room so a change of state moves nothing.
    action = (
      <span aria-hidden className="btn btn-primary invisible">
        Name it
      </span>
    );
  }

  const others = [
    lead !== toName && toName.length > 0 && `${toName.length} ${are(toName)} waiting for a name`,
    lead !== sending && sending.length > 0 && `${sending.length} ${are(sending)} still sending`,
    lead !== waiting && waiting.length > 0 && `${waiting.length} ${are(waiting)} with Fern`,
  ].filter((x): x is string => Boolean(x));
  const tail: string[] = [];
  if (others.length > 0) tail.push(`Besides ${lead.length === 1 ? "it" : "them"}, ${listOf(others)}.`);
  // Leaving loses a plant still to send or one that couldn't be sent, so the
  // page says it may be left only once neither is left.
  if (sending.length > 0) tail.push(`Keep this page open until ${sending.length === 1 ? "it’s" : "they’re"} sent.`);
  else if (failed.length === 0 && waiting.length > 0) tail.push("You can leave this page; Fern keeps going.");

  const latest = plants.slice(-3).reverse(); // the newest in front, where the person just saw it
  return (
    <section aria-labelledby="sent-h" className="card flex flex-wrap items-center gap-x-6 gap-y-4 border-line-2 bg-sage px-5 py-4">
      <div className="flex">
        {latest.map((pl, i) => {
          const p = pl.photos[0];
          return (
            <span key={pl.key} className={`thumb overflow-hidden border-2 border-sage bg-tile-2 ${i < 2 ? "-mr-2.5" : ""}`}>
              {p.look === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, nothing for next/image to optimise
                <img src={p.preview} alt="" draggable={false} onError={() => onNoPreview(p)} className="size-full object-cover" />
              ) : (
                <LeafMark size={26} className="text-moss" />
              )}
            </span>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-[1_1_300px] flex-col">
        <h2 id="sent-h" aria-live="polite" className="text-lead font-bold text-ink">
          {heading}
        </h2>
        <p aria-live="polite" className="mt-0.5 min-h-[1lh] text-meta text-ink-2">
          {line}
          {tail.length > 0 ? ` ${tail.join(" ")}` : ""}
        </p>
      </div>
      {action}
    </section>
  );
}

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function CameraIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" {...STROKE}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function RollIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" {...STROKE}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 15l5-5 4 4 3-3 6 6" />
      <circle cx="16" cy="9" r="1.5" />
    </svg>
  );
}

function FlowerIcon() {
  return (
    <svg aria-hidden width="26" height="26" viewBox="0 0 24 24" {...STROKE} strokeWidth={1.8}>
      <circle cx="12" cy="10" r="2.5" />
      <path d="M12 3.5c1.8 0 2.6 2 1.6 3.6M12 3.5c-1.8 0-2.6 2-1.6 3.6M18 7.5c.9 1.6-.5 3.3-2.3 2.9M6 7.5c-.9 1.6.5 3.3 2.3 2.9M17.2 14c-.9 1.6-3 1.4-3.8-.3M6.8 14c.9 1.6 3 1.4 3.8-.3" />
      <path d="M12 12.5V21M12 18c-2.5 0-4-1.5-4-3.5 2.5 0 4 1.5 4 3.5z" />
    </svg>
  );
}

function LeafIcon() {
  return (
    <svg aria-hidden width="26" height="26" viewBox="0 0 24 24" {...STROKE} strokeWidth={1.8}>
      <path d="M5 19c0-8 5-13 14-14 0 9-5 14-14 14z" />
      <path d="M5 19l8-8" />
    </svg>
  );
}

function PlantIcon() {
  return (
    <svg aria-hidden width="26" height="26" viewBox="0 0 24 24" {...STROKE} strokeWidth={1.8}>
      <path d="M7 14h10l-1 7H8z" />
      <path d="M12 14V8" />
      <path d="M12 8c-3 0-5-2-5-5 3 0 5 2 5 5zM12 11c3 0 5-2 5-5-3 0-5 2-5 5z" />
    </svg>
  );
}
