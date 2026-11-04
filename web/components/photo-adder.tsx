"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { exifTakenAt } from "@/lib/exif";
import { NoRetry, withRetry } from "@/lib/retry";
import { shrinkToJpeg } from "@/lib/shrink";
import type { PhotoTarget } from "@/lib/species-page";

// "Add a photo" in the specimen page's sage tile (#26) and beside the species
// page's gallery (#55). The photos go straight onto a plant through
// POST /api/plants/[id]/photos, with the uploader's pipeline (the date from
// the original's EXIF, the shrink, one request per photo with retry) and none
// of its questions: no organ, no job, no naming. One line in the reserved
// space says where it is, in place of the count; when the last photo lands
// the page refreshes, so the photos and the count come from the server.
//
// The plant page passes its own `plantId`. The species page passes `plants`,
// the species' plants as `photoTargets` names them: with one, the button goes
// straight to the picker; with several, a "Which plant?" select comes first
// and the button waits for it. Either way the done line names the plant, since
// a species page does not show which one a photo went onto.
type Props = { countLine: string; compact?: boolean } & ({ plantId: number; plants?: never } | { plants: PhotoTarget[]; plantId?: never });

export function PhotoAdder({ plantId, plants, countLine, compact = false }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ kind: "busy" | "ok" | "error"; text: string } | null>(null);
  const [chosenId, setChosenId] = useState<number | null>(plants && plants.length === 1 ? plants[0].id : (plantId ?? null));
  const busy = note?.kind === "busy";
  const chosen = plants?.find((p) => p.id === chosenId) ?? null;
  const choosing = plants !== undefined && plants.length > 1;

  async function addOne(id: number, file: File, where: string) {
    setNote({ kind: "busy", text: `Adding${where}…` }); // before the shrink, which takes a moment on a phone
    const takenAt = exifTakenAt(await file.arrayBuffer());
    const { blob, mime } = await shrinkToJpeg(file);
    await withRetry(
      async (attempt) => {
        if (attempt > 1) setNote({ kind: "busy", text: `Adding${where} (try ${attempt})…` });
        const form = new FormData();
        form.append("file", new File([blob], file.name, { type: mime }));
        if (takenAt) form.append("takenAt", takenAt);
        const r = await fetch(`/api/plants/${id}/photos`, { method: "POST", body: form });
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new NoRetry(`rejected (${r.status})`);
        if (!r.ok) throw new Error(`server ${r.status}`);
      },
      { attempts: 4, baseMs: 800 },
    );
  }

  async function addAll(id: number, files: File[]) {
    const n = files.length;
    const to = chosen ? ` to ${chosen.label}` : "";
    let added = 0;
    let firstError: string | null = null;
    for (const [i, file] of files.entries()) {
      try {
        await addOne(id, file, n > 1 ? ` ${i + 1} of ${n}` : "");
        added++;
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : "upload failed";
      }
    }
    if (added === n) setNote({ kind: "ok", text: n === 1 ? `Added${to}.` : `Added ${n} photos${to}.` });
    else if (added === 0) setNote({ kind: "error", text: `Could not add ${n === 1 ? "it" : "them"}: ${firstError}.` });
    else setNote({ kind: "error", text: `Added ${added} of ${n}${to}; ${n - added} failed: ${firstError}.` });
    if (added > 0) router.refresh();
  }

  const text = note?.text ?? countLine;
  return (
    <>
      {/* Reserved: two lines where the line sits in a narrow column (the plant
          page's tile from 640 px, the species page's always), so no state moves it. */}
      <p
        role="status"
        aria-live="polite"
        title={text}
        className={`line-clamp-2 text-meta ${compact ? "min-h-[2lh]" : "sm:min-h-[2lh]"} ${note?.kind === "error" ? "text-warn-ink" : "text-ink-2"}`}
      >
        {text}
      </p>
      {choosing ? (
        // DESIGN.md §4's select, its placeholder the visible label in a column too
        // narrow for one beside it. Every label sits invisible in the same cell,
        // so the control is as wide as the longest (up to the column) and choosing
        // moves nothing.
        <div className="relative grid min-w-0 max-w-full self-start">
          {["Which plant?", ...plants.map((p) => p.label)].map((label) => (
            <span key={label} aria-hidden className="select invisible col-start-1 row-start-1 h-0 min-h-0 truncate border-y-0">
              {label}
            </span>
          ))}
          <select
            aria-label="Which plant to add the photo to"
            value={chosenId ?? ""}
            disabled={busy}
            onChange={(e) => {
              setChosenId(Number(e.target.value));
              setNote(null);
            }}
            className="select col-start-1 row-start-1 min-w-0 truncate"
          >
            <option value="" disabled>
              Which plant?
            </option>
            {plants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute right-3.5 top-3 text-ink-2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      ) : null}
      <button
        type="button"
        disabled={busy || chosenId === null}
        aria-busy={busy}
        onClick={() => inputRef.current?.click()}
        className={`btn btn-ghost self-start ${compact ? "btn-compact" : "bg-surface"}`}
      >
        <svg aria-hidden width={compact ? 16 : 18} height={compact ? 16 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
        Add a photo
      </button>
      {/* No `capture`: a phone offers the camera or the library from one picker, a laptop a file dialog. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0 && chosenId !== null) void addAll(chosenId, files);
        }}
      />
    </>
  );
}
