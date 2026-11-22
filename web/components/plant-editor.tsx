"use client";

import { BASE_PATH } from "@/lib/base-path";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Term } from "@/components/term";
import { STATUS_LABEL, type SpecimenStatus } from "@/lib/collection";
import { locationChoices, sameLocation } from "@/lib/locations";

// The editable facts of one specimen: its location, the date it was
// acquired, its status. A plain form with one Save button, enabled only when
// something changed, and a line that says "Saved" afterwards (reserved, so
// the card never moves). Remove is two taps on purpose and then deletes the
// plant, its photos and the files, through DELETE /api/plants/[id].
export type PlantFacts = { location: string | null; acquiredOn: string | null; status: SpecimenStatus };

type Draft = { location: string; acquiredOn: string; status: SpecimenStatus };

function toDraft(f: PlantFacts): Draft {
  return { location: f.location ?? "", acquiredOn: f.acquiredOn ?? "", status: f.status };
}

export function PlantEditor({ id, facts, locations, photoCount }: { id: number; facts: PlantFacts; locations: string[]; photoCount: number }) {
  const router = useRouter();
  const listId = useId();
  const [saved, setSaved] = useState<Draft>(toDraft(facts));
  const [draft, setDraft] = useState<Draft>(toDraft(facts));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [armed, setArmed] = useState(false);

  const dirty = (Object.keys(draft) as Array<keyof Draft>).some((k) => draft[k].trim() !== saved[k].trim());

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(`${BASE_PATH}/api/plants/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ location: draft.location, acquiredOn: draft.acquiredOn, status: draft.status }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      const fresh = toDraft(data as PlantFacts);
      setSaved(fresh);
      setDraft(fresh);
      setNote({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch (err) {
      setNote({ kind: "error", text: `Could not save: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(`${BASE_PATH}/api/plants/${id}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      router.push("/");
      router.refresh();
    } catch (err) {
      setNote({ kind: "error", text: `Could not remove it: ${(err as Error).message}` });
      setArmed(false);
      setBusy(false);
    }
  }

  const label = "text-meta font-semibold text-ink-2";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !busy) void save();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LocationField label={label} value={draft.location} current={saved.location} locations={locations} onChange={(location) => setDraft({ ...draft, location })} />
        <label className="flex flex-col gap-1.5">
          <span className={label}>Acquired on</span>
          <input type="date" value={draft.acquiredOn} onChange={(e) => setDraft({ ...draft, acquiredOn: e.target.value })} className="field" />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={label} id={`${listId}-status`}>
            Status
          </span>
          <div role="radiogroup" aria-labelledby={`${listId}-status`} className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_LABEL) as SpecimenStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={draft.status === s}
                onClick={() => setDraft({ ...draft, status: s })}
                className={`chip ${draft.status === s ? "chip-on" : ""}`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!dirty || busy} className="btn btn-primary">
          Save changes
        </button>
        <p role="status" aria-live="polite" className={`min-h-6 text-meta ${note?.kind === "error" ? "text-warn-ink" : "text-ink-2"}`}>
          {note?.text ?? (dirty ? "Not saved yet." : "")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button type="button" onClick={() => void remove()} disabled={busy} className="btn btn-ghost btn-compact">
          {armed ? `Yes, remove it and its ${photoCount === 1 ? "photo" : `${photoCount} photos`}` : "Remove this plant"}
        </button>
        <p className="text-meta text-ink-2">
          {armed ? (
            <>
              This cannot be undone.{" "}
              <button type="button" onClick={() => setArmed(false)} className="font-semibold text-moss hover:underline">
                Keep it
              </button>
            </>
          ) : (
            <>
              Gone for good, with its photos. A plant that died or was given away can keep its page: set its status instead, and it stays a{" "}
              <Term k="specimen" /> in your records.
            </>
          )}
        </p>
      </div>
    </form>
  );
}

/** A row of the list: 44 px for touch (in px, since the root font is not 16). */
const ROW = "min-h-[44px]";

/**
 * The Location field (#129): one free-text field that also offers every
 * location in use, in the app's own list. It was an <input list> with a
 * <datalist>, whose popup the browser filters by the field's own value (so a
 * plant with a location was offered that location alone) and draws itself.
 *
 * Opening it (a tap in the field, the chevron, Arrow Down) selects the text
 * and shows every location, the plant's saved one checked. Typing narrows the
 * list; text that matches none is kept as a new location and the list says
 * so. Arrows move, Enter chooses, Escape closes and puts the text back. The
 * list lies over the page under the field, so opening it moves nothing. The
 * ARIA combobox pattern: the input owns the listbox and points at the active
 * option, and focus never leaves the input.
 */
function LocationField({
  label,
  value,
  current,
  locations,
  onChange,
}: {
  label: string; // the label's classes, shared with the form's other fields
  value: string;
  current: string; // the plant's saved location, checked in the list
  locations: string[]; // every location in use, most plants first
  onChange: (location: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // What the field held before the person typed: until it changes, the list is not narrowed.
  const [resting, setResting] = useState(value);
  const { rows, fresh } = locationChoices(locations, value, resting);
  const shown = open && (rows.length > 0 || fresh !== null);
  const optionId = (i: number) => `${id}-option-${i}`;

  // Keep the keyboard's row, and on opening the list itself, in view: a phone's keyboard or a short window can cover it.
  useEffect(() => {
    if (!shown) return;
    const row = active >= 0 ? document.getElementById(`${id}-option-${active}`) : null;
    (row ?? list.current)?.scrollIntoView({ block: "nearest" });
  }, [shown, active, id]);

  function show() {
    if (open) return;
    setResting(value);
    setActive(-1);
    setOpen(true);
    input.current?.select();
  }
  function choose(location: string) {
    onChange(location);
    setResting(location);
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={label}>
        Location
      </label>
      <div className="relative">
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={show}
          onClick={show}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) return show();
              if (rows.length === 0) return;
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive(active < 0 ? (step === 1 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length);
            } else if (e.key === "Enter" && open) {
              // Enter closes the list first, choosing the row the arrows are on; the next Enter saves the form.
              e.preventDefault();
              if (active >= 0 && rows[active] !== undefined) choose(rows[active]);
              else setOpen(false);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              onChange(resting);
              setOpen(false);
            }
          }}
          placeholder="A shelf, a room or a bed"
          maxLength={80}
          autoComplete="off"
          className="field w-full pr-11"
        />
        {/* The chevron: the pointer's way to open and close it. Out of the tab order, since the field itself opens on focus. */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Hide the locations" : "Show the locations"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) return setOpen(false);
            input.current?.focus();
            show();
          }}
          className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-pill text-ink-2 hover:text-ink"
        >
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={open ? "rotate-180" : ""}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {/* Eight rows show before it scrolls (8 × 44 px, its padding and border); a short window gets half its height. */}
        <div
          ref={list}
          hidden={!shown}
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[min(366px,50dvh)] scroll-my-3 overflow-y-auto rounded-card border border-line bg-surface p-1.5 shadow-hover"
        >
          <ul id={`${id}-list`} role="listbox" aria-label="Locations in use">
            {rows.map((l, i) => {
              const mine = sameLocation(l, current);
              return (
                <li
                  key={l}
                  id={optionId(i)}
                  role="option"
                  aria-selected={mine}
                  onClick={() => choose(l)}
                  onMouseMove={() => setActive(i)}
                  className={`flex ${ROW} cursor-pointer items-center gap-2.5 rounded-pill px-3 text-ink ${i === active ? "bg-sage" : ""} ${mine ? "font-bold" : ""}`}
                >
                  <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`flex-none text-moss ${mine ? "" : "invisible"}`}>
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                  <span className="min-w-0 truncate">{l}</span>
                  {mine ? <span className="sr-only">, the current location</span> : null}
                </li>
              );
            })}
          </ul>
          {fresh !== null ? (
            <p aria-live="polite" className={`flex ${ROW} items-center px-3 text-meta text-ink-2`}>
              <span className="min-w-0 truncate">New location &ldquo;{fresh}&rdquo;</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
