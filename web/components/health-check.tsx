"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Term } from "@/components/term";
import { LeafMark } from "@/components/topbar";
import { modelLabel } from "@/lib/care";
import { dayLabel } from "@/lib/collection";
import { canSend, EARLIER_SHOWN, LIGHTS, MAX_PHOTOS, MAX_QUESTION, SETTINGS, STATUS_LABEL, togglePhoto, type Light, type Setting } from "@/lib/health";
import type { PlantCheck } from "@/lib/specimens";

// A plant's health check (#87), both cards. HealthCheckCard, first in the
// side column, is where one is started: the plant's photos as checkable
// thumbs, an optional question, where it grows and under what light (#99,
// both optional), "Check health". HealthPanel, in the main
// column, shows the latest check, open, and the earlier ones, closed. Pressing the button
// only queues a row (POST /api/plants/[id]/health); Fern asks the model, and
// the panel refreshes the page every few seconds until the answer is there.
// A finished check, done or failed, can be deleted from its row (#91).

const PLACEHOLDER = "White fuzzy insects are nibbling the leaves, like in the photo. What are they and how do I get rid of them?";

export type PickerPhoto = { id: number; thumbUrl: string; label: string };

export function HealthCheckCard({
  plantId,
  photos,
  initial,
  enabled,
  inFlight,
}: {
  plantId: number;
  photos: PickerPhoto[]; // newest first
  initial: number[]; // the three newest
  enabled: boolean; // this box has a model key
  inFlight: boolean; // a check of this plant is queued or running
}) {
  const router = useRouter();
  const questionId = useId();
  const [selected, setSelected] = useState<number[]>(initial);
  const [question, setQuestion] = useState("");
  // Neither is chosen to begin with, and a blank is sent as nothing: Fern tells the model only what the owner said.
  const [setting, setSetting] = useState<Setting | null>(null);
  const [light, setLight] = useState<Light | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A photo removed since the page was drawn is no longer chosen.
  const chosen = selected.filter((id) => photos.some((p) => p.id === id));
  const full = chosen.length >= MAX_PHOTOS;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/plants/${plantId}/health`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: photos.filter((p) => chosen.includes(p.id)).map((p) => p.id), question: question.trim() || undefined, setting: setting ?? undefined, light: light ?? undefined }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `The server answered ${r.status}.`);
      router.refresh(); // the page comes back with the check in flight, which the status line below says
      // On a phone the Health card is above this one; bring it into view. Where it is already on screen, nothing scrolls.
      document.getElementById("health")?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const heading = (
    <h3 id="health-check-h" className="mb-1 text-h3">
      <Term k="health-check">Health check</Term>
    </h3>
  );

  if (!enabled) {
    return (
      <section id="health-check" className="card scroll-mt-4 p-5" aria-labelledby="health-check-h">
        {heading}
        <p className="text-body">Health checks are off on this box.</p>
        <p className="mt-1 text-meta text-ink-2">They need AI_GATEWAY_API_KEY in the environment Fern and the web app read.</p>
      </section>
    );
  }

  const status = error ?? (inFlight ? "Fern is looking at this plant now. Its answer will show in the Health card." : "");
  return (
    <section id="health-check" className="card scroll-mt-4 p-5" aria-labelledby="health-check-h">
      {heading}
      <p className="text-meta text-ink-2">Choose up to three photos for Fern to read.</p>

      <fieldset className="mt-3">
        <legend className="sr-only">Photos to send</legend>
        {/* The tags page's row, without its text: a 44 px checkbox target and the 56 px thumb, wrapping. */}
        <ul className="flex flex-wrap gap-x-2 gap-y-1">
          {photos.map((p) => {
            const on = chosen.includes(p.id);
            const off = !on && full;
            return (
              <li key={p.id}>
                <label className={`flex min-h-[60px] items-center rounded-thumb pr-1 ${off ? "cursor-default" : "cursor-pointer hover:bg-ground"}`}>
                  <span className="flex h-11 w-9 flex-none items-center justify-center">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={off || busy}
                      onChange={() => setSelected(togglePhoto(chosen, p.id))}
                      aria-label={p.label}
                      className="h-5 w-5 accent-moss"
                    />
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbUrl}
                    alt=""
                    title={p.label}
                    loading="lazy"
                    width={56}
                    height={56}
                    className={`h-14 w-14 flex-none rounded-thumb border border-line bg-sage object-cover ${off ? "opacity-45" : ""}`}
                  />
                </label>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-meta text-ink-2 tabular-nums" aria-live="polite">
          {chosen.length} of {MAX_PHOTOS} chosen
        </p>
      </fieldset>

      <label htmlFor={questionId} className="mt-4 flex items-baseline justify-between gap-3 text-meta font-semibold text-ink-2">
        Describe a problem or ask a question
        <span className="font-normal tabular-nums">
          {question.length}/{MAX_QUESTION}
        </span>
      </label>
      <textarea
        id={questionId}
        rows={4}
        maxLength={MAX_QUESTION}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={PLACEHOLDER}
        className="mt-1.5 block w-full resize-y rounded-tile border border-line-2 bg-surface px-4 py-3 text-body text-ink placeholder:text-ink-3 focus:border-line-strong"
      />

      {/* Two pairs of chips, at most one of each on; the chosen one taps off again, so "not said" is always a tap away. */}
      <fieldset className="mt-4">
        <legend className="flex w-full items-baseline justify-between gap-3 text-meta font-semibold text-ink-2">
          About this plant
          <span className="font-normal">Optional</span>
        </legend>
        <div className="mt-1.5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
          <span id={`${questionId}-setting`} className="text-meta text-ink-2">
            It grows
          </span>
          <div role="group" aria-labelledby={`${questionId}-setting`} className="flex flex-wrap gap-2">
            {SETTINGS.map((v) => (
              <button key={v} type="button" aria-pressed={setting === v} disabled={busy} onClick={() => setSetting(setting === v ? null : v)} className={`chip chip-compact capitalize ${setting === v ? "chip-on" : ""}`}>
                {v}
              </button>
            ))}
          </div>
          <span id={`${questionId}-light`} className="text-meta text-ink-2">
            <Term k="light">Its light</Term>
          </span>
          <div role="group" aria-labelledby={`${questionId}-light`} className="flex flex-wrap gap-2">
            {LIGHTS.map((v) => (
              <button key={v} type="button" aria-pressed={light === v} disabled={busy} onClick={() => setLight(light === v ? null : v)} className={`chip chip-compact capitalize ${light === v ? "chip-on" : ""}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      <button type="button" onClick={() => void send()} disabled={busy || inFlight || !canSend(chosen)} className="btn btn-primary mt-4 w-full">
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h4l2-5 4 10 2-5h6" />
        </svg>
        {busy ? "Sending…" : "Check health"}
      </button>
      {/* Reserved: two lines, so a refusal or "Fern is looking" moves nothing. */}
      <p role="status" aria-live="polite" className={`mt-2 min-h-[2lh] text-meta leading-snug ${error ? "text-warn-ink" : "text-ink-2"}`}>
        {status}
      </p>
    </section>
  );
}

const POLL_MS = 2500;
const POLL_TICKS = 144; // six minutes: twice the model call's own timeout

export function HealthPanel({ plantId, checks, canCheck }: { plantId: number; checks: PlantCheck[]; canCheck: boolean }) {
  const router = useRouter();
  const [latest, ...earlier] = checks;
  const [showAll, setShowAll] = useState(false);
  const waitingId = latest?.kind === "waiting" ? latest.id : null;
  const [gaveUp, setGaveUp] = useState<number | null>(null);

  // While Fern has the check, the page asks again every few seconds, as the
  // confirm screen does for a job; the answer arrives as a refreshed page.
  useEffect(() => {
    if (waitingId === null) return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > POLL_TICKS) {
        clearInterval(t);
        setGaveUp(waitingId);
      } else router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waitingId, router]);

  const shown = showAll ? earlier : earlier.slice(0, EARLIER_SHOWN);
  return (
    <section id="health" aria-labelledby="health-h" className="card flex scroll-mt-4 flex-col gap-4 p-5 sm:px-8 sm:py-7">
      <div>
        <h2 id="health-h" className="text-section leading-tight">
          Health{" "}
          <span className="font-sans text-body">
            <Term k="health-check">
              <span className="sr-only">health check</span>
            </Term>
          </span>
        </h2>
      </div>

      {latest ? (
        <CheckRow key={latest.id} plantId={plantId} check={latest} lead stalled={gaveUp === latest.id} />
      ) : (
        <RowShell
          top={<span className="font-bold">No health check yet</span>}
          body={
            canCheck
              ? "Choose photos in the Health check card and Fern will read them: what it can see, the likeliest cause, and what to do."
              : "This plant was never checked while it was here."
          }
          muted
        />
      )}

      {earlier.length > 0 ? (
        <div className="flex flex-col gap-1 border-t border-line pt-4">
          <h3 className="font-sans text-meta font-semibold tracking-normal text-ink-2">Earlier checks</h3>
          <ul className="divide-y divide-line">
            {shown.map((c) => (
              <li key={c.id} className="py-3 last:pb-0">
                <CheckRow plantId={plantId} check={c} />
              </li>
            ))}
          </ul>
          {earlier.length > EARLIER_SHOWN && !showAll ? (
            <button type="button" onClick={() => setShowAll(true)} className="btn btn-ghost btn-compact mt-2 self-start">
              Show all {earlier.length}
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="border-t border-line pt-3 text-meta text-ink-2">A model&rsquo;s reading of your photos, not a diagnosis.</p>
    </section>
  );
}

/**
 * The summary row's box, the same in every closed state: one line for the
 * tag and date, the sentence at a fixed height (four lines on a phone, three
 * from 640 px; an opened row shows it whole), and the thumbs' 40 px. The
 * latest check opens by itself when its answer lands (#93), so that is where
 * the card grows.
 */
function RowShell({
  top,
  body,
  foot,
  muted = false,
  open = false,
}: {
  top: React.ReactNode;
  body: React.ReactNode;
  foot?: React.ReactNode;
  muted?: boolean;
  open?: boolean;
}) {
  return (
    <span className="flex flex-col gap-2 text-left">
      <span className="flex h-7 items-center gap-x-2.5 whitespace-nowrap">{top}</span>
      <span className={`block text-body leading-snug ${muted ? "text-ink-2" : "text-ink"} ${open ? "min-h-[4lh] sm:min-h-[3lh]" : "line-clamp-4 h-[4lh] sm:line-clamp-3 sm:h-[3lh]"}`}>{body}</span>
      <span className="flex h-10 min-w-0 items-center gap-1.5">{foot}</span>
    </span>
  );
}

function Thumbs({ check }: { check: PlantCheck }) {
  const gone = check.photoIds.length - check.thumbs.length;
  return (
    <>
      {check.thumbs.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={t.id} src={t.thumbUrl} alt="" loading="lazy" width={40} height={40} className="h-10 w-10 flex-none rounded-thumb border border-line bg-sage object-cover" />
      ))}
      <span className="ml-1 min-w-0 truncate text-meta text-ink-2">
        {check.thumbs.length === 0
          ? "The photos sent have since been removed"
          : `${check.photoIds.length === 1 ? "1 photo" : `${check.photoIds.length} photos`} sent${gone > 0 ? `, ${gone} since removed` : ""}`}
      </span>
    </>
  );
}

const DISARM_MS = 5000;

/**
 * "Delete" on a finished check (#91). Two taps, as Remove is on a photo: the
 * first arms it ("Yes, delete"), the second calls DELETE
 * /api/plants/[id]/health/[checkId] and refreshes, so the next check down
 * becomes the latest. A tap anywhere else, Escape, or five seconds put it
 * back. It sits at the right end of its line, so its changing label moves
 * nothing beside it.
 */
function DeleteCheck({ plantId, checkId, day }: { plantId: number; checkId: number; day: string | null }) {
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"rest" | "armed" | "busy" | "error">("rest");
  const [error, setError] = useState("");

  useEffect(() => {
    if (state !== "armed" && state !== "error") return;
    const timer = window.setTimeout(() => setState("rest"), DISARM_MS);
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setState("rest");
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState("rest");
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [state]);

  async function press() {
    if (state === "busy") return;
    if (state !== "armed") {
      setState("armed");
      return;
    }
    setState("busy");
    try {
      const r = await fetch(`/api/plants/${plantId}/health/${checkId}`, { method: "DELETE" });
      if (!r.ok) {
        if (r.status === 404) router.refresh(); // this page is out of date: another tab got there first
        throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `server ${r.status}`);
      }
      router.refresh(); // stays "Deleting…" until the refreshed page drops this check
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not delete it");
      setState("error");
    }
  }

  const what = `the health check${day ? ` of ${day}` : ""}`;
  const armed = state === "armed";
  return (
    <span className="ml-auto flex flex-none items-center">
      <button
        ref={ref}
        type="button"
        onClick={() => void press()}
        aria-label={{ rest: `Delete ${what}`, armed: `Yes, delete ${what}`, busy: `Deleting ${what}`, error: `Not deleted: ${what}` }[state]}
        aria-busy={state === "busy"}
        title={state === "error" ? `Could not delete it: ${error}` : undefined}
        className={`btn btn-compact ${armed ? "btn-soft" : "btn-ghost"} text-meta`}
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
          <path d="M10 11v6M14 11v6" />
        </svg>
        {{ rest: "Delete", armed: "Yes, delete", busy: "Deleting…", error: "Not deleted" }[state]}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {armed ? "Press again to delete it." : state === "error" ? `Could not delete it: ${error}` : ""}
      </span>
    </span>
  );
}

function CheckRow({ plantId, check, lead = false, stalled = false }: { plantId: number; check: PlantCheck; lead?: boolean; stalled?: boolean }) {
  // The latest check arrives open (#93): its findings and remedies are what the page is opened for. Earlier ones start closed.
  const [open, setOpen] = useState(lead);
  const id = useId();
  const day = dayLabel(check.finishedAt ?? check.createdAt);
  const date = day ? <span className="text-meta text-ink-2">{day}</span> : null;
  const thumbs = <Thumbs check={check} />;

  if (check.kind !== "done") {
    const waiting = check.kind === "waiting";
    return (
      <div className="flex flex-col gap-3">
        <RowShell
          top={
            <>
              {waiting ? (
                <span className="tag">Checking</span>
              ) : (
                <span className="tag">Didn&rsquo;t finish</span>
              )}
              {date}
            </>
          }
          body={
            waiting && !stalled ? (
              <Looking seed={check.id} />
            ) : (
              <span role="status">
                {waiting
                  ? "Fern hasn't answered yet. If Fern is running, the answer will be here when you reload the page."
                  : `${check.why} This check won't be tried again; you can start a new one.`}
              </span>
            )
          }
          // A failed check has no opened row, so its Delete ends its summary row. One still with Fern has none.
          foot={
            <>
              {thumbs}
              {waiting ? null : <DeleteCheck plantId={plantId} checkId={check.id} day={day} />}
            </>
          }
          muted
        />
        {lead && check.question ? <Asked question={check.question} reply={null} waiting={waiting && !stalled} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="-m-2 cursor-pointer rounded-tile p-2 text-left transition-colors duration-[120ms] hover:bg-ground"
      >
        <RowShell
          open={open}
          top={
            <>
              <span className={`tag ${check.status === "needs_attention" ? "tag-warn" : ""}`}>{STATUS_LABEL[check.status]}</span>
              {date}
              <span className="ml-auto inline-flex items-center gap-1 text-meta font-semibold text-moss">
                {/* On a phone the tag and the date fill the line; the chevron stands alone there. */}
                <span className="max-sm:sr-only">{open ? "Close" : "Findings and remedies"}</span>
                <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-[120ms] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </>
          }
          body={check.summary}
          foot={thumbs}
        />
      </button>
      {/* The reply is what the owner came for: under the summary, without opening anything. */}
      {check.question && (lead || open) ? <Asked question={check.question} reply={check.reply} waiting={false} finished /> : null}
      {open ? (
        <div id={id} className="flex flex-col gap-4">
          <div>
            <h4 className="mb-2 text-meta font-semibold text-ink-2">What Fern saw, and what to do</h4>
            {check.findings.length === 0 ? (
              <p className="text-body">Nothing to note in these photos.</p>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {check.findings.map((f, i) => {
                  const thumb = check.thumbs.find((t) => t.n === f.photo);
                  return (
                    <li key={i} className="rounded-tile bg-ground p-4">
                      <p className="font-bold">{f.seen}</p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="tag">{f.likelihood === "likely" ? "Likely cause" : "Possible cause"}</span>
                        {f.photo ? (
                          <span className="inline-flex items-center gap-1.5 text-meta text-ink-2 tabular-nums">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {thumb ? <img src={thumb.thumbUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-[6px] object-cover" /> : null}
                            Photo {f.photo}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-2 text-body">{f.remedy}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          {check.confidence ? (
            <div>
              <h4 className="mb-1 text-meta font-semibold text-ink-2">How sure this reading is</h4>
              <p className="text-body">
                <span className="font-bold capitalize">{check.confidence.level}.</span> {check.confidence.why}
              </p>
            </div>
          ) : null}
          <div>
            <h4 className="mb-1 text-meta font-semibold text-ink-2">Photos to take next</h4>
            {check.nextPhotos.length === 0 ? (
              <p className="text-body">None needed.</p>
            ) : (
              <ul className="list-disc pl-5 text-body marker:text-line-strong">
                {check.nextPhotos.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-meta text-ink-2">
              Read by {modelLabel(check.model)}
              {day ? ` on ${day}` : ""}.
            </p>
            <DeleteCheck plantId={plantId} checkId={check.id} day={day} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The owner's question and the reply as a conversation (#93): their words in
 * a moss bubble at the right, the reply in a pale one at the left, each under
 * a small label, so the two never read alike. While Fern is looking the
 * reply's bubble holds a text message's typing dots; when the check failed,
 * or finished without one, it says so.
 */
function Asked({ question, reply, waiting, finished = false }: { question: string; reply: string | null; waiting: boolean; finished?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end">
        <span className="text-tag font-bold text-ink-2">You asked</span>
        <p className="rounded-[18px] rounded-br-[6px] bg-moss px-4 py-2.5 text-body text-white">{question}</p>
      </div>
      <div className="flex max-w-[85%] flex-col items-start gap-1 self-start">
        <span className="text-tag font-bold text-ink-2">Fern&rsquo;s reply</span>
        <p className={`rounded-[18px] rounded-bl-[6px] border border-line bg-ground px-4 py-2.5 text-body ${reply ? "text-ink" : "text-ink-2"}`}>
          {reply ??
            (waiting ? (
              <span className="flex h-[1lh] items-center gap-1.5" aria-hidden>
                <span className="fern-dot" />
                <span className="fern-dot [animation-delay:160ms]" />
                <span className="fern-dot [animation-delay:320ms]" />
              </span>
            ) : finished ? (
              // A finished check can lack a reply: Fern keeps an answer whose reply the model left out (#97).
              "Fern didn’t answer this directly. What it saw is in the findings."
            ) : (
              "No reply: the check didn’t finish."
            ))}
        </p>
      </div>
    </div>
  );
}

// What Fern is "doing" while the model has the photos (#93). They pass the
// time; none of them reports a real step.
const PHRASES = [
  "Looking at the leaves…",
  "Looking more closely…",
  "Checking the leaf edges…",
  "Turning a leaf over…",
  "Checking for visitors…",
  "Following a stem down…",
  "Peering at the soil line…",
  "Comparing with its care sheet…",
  "Counting the new growth…",
  "Squinting at a spot…",
  "Asking the potting bench…",
  "Writing up what it saw…",
];
const PHRASE_MS = 2800;

/**
 * The wait, in the summary row's sentence box: a leaf with a magnifying glass
 * drifting over it, and a phrase that changes every few seconds. It starts
 * from the check's id, so the server and the browser draw the same first
 * phrase and two checks do not open alike. A screen reader hears "Fern is
 * looking" once; the phrases are for the eye. Under reduced motion the glass
 * and the leaf are still and the phrase changes without its fade.
 */
function Looking({ seed }: { seed: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => v + 1), PHRASE_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="flex items-center gap-3">
      <span aria-hidden className="relative flex h-11 w-11 flex-none items-center justify-center rounded-full bg-sage">
        <LeafMark size={26} className="fern-sway text-moss" />
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="fern-scan absolute left-1/2 top-1/2 text-ink">
          <circle cx="10" cy="10" r="6" fill="rgb(255 255 255 / 0.55)" />
          <path d="M14.5 14.5L21 21" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-col">
        <span role="status" className="sr-only">
          Fern is looking
        </span>
        <span aria-hidden key={n} className="fern-phrase truncate font-semibold text-ink">
          {PHRASES[(seed + n) % PHRASES.length]}
        </span>
        <span aria-hidden className="text-meta text-ink-2">
          Fern is reading your photos. It can take a minute.
        </span>
      </span>
    </span>
  );
}
