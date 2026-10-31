"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Term } from "@/components/term";
import { STATUS_LABEL, type SpecimenStatus } from "@/lib/collection";

// The editable facts of one specimen: nickname, location, the date it was
// acquired, its status. A plain form with one Save button, enabled only when
// something changed, and a line that says "Saved" afterwards (reserved, so
// the card never moves). Remove is two taps on purpose and then deletes the
// plant, its photos and the files, through DELETE /api/plants/[id].
export type PlantFacts = { nickname: string | null; location: string | null; acquiredOn: string | null; status: SpecimenStatus };

type Draft = { nickname: string; location: string; acquiredOn: string; status: SpecimenStatus };

function toDraft(f: PlantFacts): Draft {
  return { nickname: f.nickname ?? "", location: f.location ?? "", acquiredOn: f.acquiredOn ?? "", status: f.status };
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
      const r = await fetch(`/api/plants/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: draft.nickname, location: draft.location, acquiredOn: draft.acquiredOn, status: draft.status }),
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
      const r = await fetch(`/api/plants/${id}`, { method: "DELETE" });
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
        <label className="flex flex-col gap-1.5">
          <span className={label}>Nickname</span>
          <input
            type="text"
            value={draft.nickname}
            onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
            placeholder="What you call it, e.g. Granddaddy"
            maxLength={80}
            autoComplete="off"
            className="field"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Location</span>
          <input
            type="text"
            list={listId}
            value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            placeholder="A shelf, a room or a bed"
            maxLength={80}
            autoComplete="off"
            className="field"
          />
          <datalist id={listId}>
            {locations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </label>
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
