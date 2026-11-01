"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { exifTakenAt } from "@/lib/exif";
import { NoRetry, withRetry } from "@/lib/retry";
import { shrinkToJpeg } from "@/lib/shrink";

// "Add a photo" in the specimen page's sage tile (#26). The photos go straight
// onto this plant through POST /api/plants/[id]/photos, with the uploader's
// pipeline (the date from the original's EXIF, the shrink, one request per
// photo with retry) and none of its questions: no organ, no job, no naming.
// One line in the tile's reserved space says where it is, in place of the
// count; when the last photo lands the page refreshes, so the timeline and
// the photo count come from the server.
export function PhotoAdder({ plantId, countLine }: { plantId: number; countLine: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ kind: "busy" | "ok" | "error"; text: string } | null>(null);
  const busy = note?.kind === "busy";

  async function addOne(file: File, where: string) {
    setNote({ kind: "busy", text: `Adding${where}…` }); // before the shrink, which takes a moment on a phone
    const takenAt = exifTakenAt(await file.arrayBuffer());
    const { blob, mime } = await shrinkToJpeg(file);
    await withRetry(
      async (attempt) => {
        if (attempt > 1) setNote({ kind: "busy", text: `Adding${where} (try ${attempt})…` });
        const form = new FormData();
        form.append("file", new File([blob], file.name, { type: mime }));
        if (takenAt) form.append("takenAt", takenAt);
        const r = await fetch(`/api/plants/${plantId}/photos`, { method: "POST", body: form });
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new NoRetry(`rejected (${r.status})`);
        if (!r.ok) throw new Error(`server ${r.status}`);
      },
      { attempts: 4, baseMs: 800 },
    );
  }

  async function addAll(files: File[]) {
    const n = files.length;
    let added = 0;
    let firstError: string | null = null;
    for (const [i, file] of files.entries()) {
      try {
        await addOne(file, n > 1 ? ` ${i + 1} of ${n}` : "");
        added++;
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : "upload failed";
      }
    }
    if (added === n) setNote({ kind: "ok", text: n === 1 ? "Added." : `Added ${n} photos.` });
    else if (added === 0) setNote({ kind: "error", text: `Could not add ${n === 1 ? "it" : "them"}: ${firstError}.` });
    else setNote({ kind: "error", text: `Added ${added} of ${n}; ${n - added} failed: ${firstError}.` });
    if (added > 0) router.refresh();
  }

  const text = note?.text ?? countLine;
  return (
    <>
      {/* Reserved: two lines where the tile is a narrow column, so no state moves the tile. */}
      <p role="status" aria-live="polite" title={text} className={`line-clamp-2 text-meta sm:min-h-[2lh] ${note?.kind === "error" ? "text-warn-ink" : "text-ink-2"}`}>
        {text}
      </p>
      <button type="button" disabled={busy} aria-busy={busy} onClick={() => inputRef.current?.click()} className="btn btn-ghost self-start bg-surface">
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          if (files.length > 0) void addAll(files);
        }}
      />
    </>
  );
}
