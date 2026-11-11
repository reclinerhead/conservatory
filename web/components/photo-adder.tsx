"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { exifTakenAt } from "@/lib/exif";
import { NoRetry, withRetry } from "@/lib/retry";
import { shrinkToJpeg } from "@/lib/shrink";

// "Add a photo", the sage tile that closes the specimen page's photo grid, a
// square like the photos beside it (#26, #83). The photos go
// straight onto the plant through POST /api/plants/[id]/photos, with the
// uploader's pipeline (the date from the original's EXIF, the shrink, one
// request per photo with retry) and none of its questions: no organ, no job,
// no naming. One line in the reserved space says where it is, in place of the
// count; when the last photo lands the page refreshes, so the photos and the
// count come from the server.
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
    <div className="flex aspect-square flex-col rounded-[16px] bg-sage">
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => inputRef.current?.click()}
        className="flex min-h-11 flex-1 cursor-pointer flex-col items-center justify-end gap-1.5 rounded-[16px] px-2 pb-1.5 font-bold text-moss transition-colors duration-[120ms] hover:text-moss-deep disabled:cursor-default disabled:opacity-60"
      >
        <svg aria-hidden width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
        Add a photo
      </button>
      {/* Reserved: two lines, so no state moves the label above it. */}
      <p
        role="status"
        aria-live="polite"
        title={text}
        className={`mb-3 line-clamp-2 h-[2lh] flex-none px-3 text-center text-tag leading-snug ${note?.kind === "error" ? "text-warn-ink" : "text-ink-2"}`}
      >
        {text}
      </p>
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
    </div>
  );
}
