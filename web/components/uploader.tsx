"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { JobView } from "@/app/api/jobs/[id]/route";
import { exifTakenAt } from "@/lib/exif";
import { ORGANS, type Organ } from "@/lib/photos";
import { NoRetry, withRetry } from "@/lib/retry";
import { shrinkToJpeg } from "@/lib/shrink";

type Item = {
  key: string;
  file: File;
  preview: string;
  organ: Organ;
  state: "ready" | "uploading" | "queued" | "done" | "error";
  attempt: number;
  jobId?: number;
  job?: JobView;
  error?: string;
};

const ORGAN_LABEL: Record<Organ, string> = {
  auto: "Let Fern guess",
  leaf: "Leaf",
  flower: "Flower",
  fruit: "Fruit",
  bark: "Bark",
};

export function Uploader() {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const rollRef = useRef<HTMLInputElement>(null);

  function add(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).map<Item>((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      preview: URL.createObjectURL(file),
      organ: "auto",
      state: "ready",
      attempt: 0,
    }));
    setItems((cur) => [...cur, ...next]);
  }

  function update(key: string, patch: Partial<Item>) {
    setItems((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function remove(key: string) {
    setItems((cur) => {
      const it = cur.find((x) => x.key === key);
      if (it) URL.revokeObjectURL(it.preview);
      return cur.filter((x) => x.key !== key);
    });
  }

  async function uploadOne(it: Item) {
    update(it.key, { state: "uploading", attempt: 1, error: undefined });
    const takenAt = exifTakenAt(await it.file.arrayBuffer());
    const { blob, mime } = await shrinkToJpeg(it.file);
    try {
      const res = await withRetry(
        async (attempt) => {
          update(it.key, { attempt });
          const form = new FormData();
          form.append("file", new File([blob], it.file.name, { type: mime }));
          form.append("organ", it.organ);
          if (takenAt) form.append("takenAt", takenAt);
          const r = await fetch("/api/photos", { method: "POST", body: form });
          if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429)
            throw new NoRetry(`rejected (${r.status})`);
          if (!r.ok) throw new Error(`server ${r.status}`);
          return (await r.json()) as { jobId: number };
        },
        { attempts: 4, baseMs: 800 },
      );
      update(it.key, { state: "queued", jobId: res.jobId });
    } catch (err) {
      update(it.key, { state: "error", error: err instanceof Error ? err.message : "upload failed" });
    }
  }

  async function uploadAll() {
    setBusy(true);
    for (const it of items) if (it.state === "ready" || it.state === "error") await uploadOne(it);
    setBusy(false);
  }

  // Poll queued jobs until Fern has answered. One request per job every 1.5 s,
  // only while something is still queued or identifying.
  const pending = items.filter((it) => it.state === "queued").map((it) => it.key);
  const pendingKey = pending.join("|");
  useEffect(() => {
    if (!pendingKey) return;
    let stopped = false;
    const tick = async () => {
      for (const it of items) {
        if (it.state !== "queued" || !it.jobId) continue;
        try {
          const r = await fetch(`/api/jobs/${it.jobId}`, { cache: "no-store" });
          if (!r.ok) continue;
          const job = (await r.json()) as JobView;
          if (stopped) return;
          const settled = job.status === "identified" || job.status === "rejected" || job.status === "failed";
          update(it.key, { job, state: settled ? "done" : "queued" });
        } catch {
          /* try again next tick */
        }
      }
    };
    void tick();
    const id = setInterval(tick, 1500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const readyCount = items.filter((it) => it.state === "ready" || it.state === "error").length;
  const doneCount = items.filter((it) => it.state === "done").length;
  const allDone = items.length > 0 && doneCount === items.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => cameraRef.current?.click()} className="btn btn-primary min-h-14">
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          Take a photo
        </button>
        <button type="button" onClick={() => rollRef.current?.click()} className="btn btn-soft min-h-14">
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 15l5-5 4 4 3-3 6 6" />
            <circle cx="16" cy="9" r="1.5" />
          </svg>
          Choose from the camera roll
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={rollRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      <ul className="flex flex-col gap-3" aria-live="polite">
        {items.map((it) => (
          <li key={it.key} className="card flex gap-4 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.preview} alt="" className="h-20 w-20 shrink-0 rounded-thumb bg-sage object-cover" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="truncate text-meta text-ink-2">{it.file.name}</p>
                {it.state === "ready" || it.state === "error" ? (
                  <button type="button" onClick={() => remove(it.key)} className="shrink-0 text-meta font-semibold text-ink-2 hover:text-ink">
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="What the photo shows">
                {ORGANS.map((o) => (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={it.organ === o}
                    disabled={it.state !== "ready" && it.state !== "error"}
                    onClick={() => update(it.key, { organ: o })}
                    className={`chip chip-compact ${it.organ === o ? "chip-on" : ""}`}
                  >
                    {ORGAN_LABEL[o]}
                  </button>
                ))}
              </div>
              <p className="mt-2 min-h-6 text-body tabular-nums">
                <Status item={it} />
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-2">
          {items.length === 0
            ? "Nothing chosen yet."
            : allDone
              ? "All identified. Put the names on them whenever you like."
              : `${items.length} ${items.length === 1 ? "photo" : "photos"} chosen.`}
        </p>
        {allDone ? (
          <Link href="/" className="btn btn-primary text-white hover:text-white hover:no-underline">
            Back to the Conservatory
          </Link>
        ) : (
          <button type="button" disabled={busy || readyCount === 0} onClick={uploadAll} className="btn btn-primary">
            {busy ? "Sending…" : readyCount === 1 ? "Send 1 photo" : `Send ${readyCount} photos`}
          </button>
        )}
      </div>
    </div>
  );
}

function Status({ item }: { item: Item }) {
  switch (item.state) {
    case "ready":
      return <span className="text-ink-3">Ready to send</span>;
    case "uploading":
      return <span className="text-ink-2">Sending{item.attempt > 1 ? ` (try ${item.attempt})` : ""}…</span>;
    case "queued":
      return <span className="text-ink-2">{item.job?.status === "identifying" ? "Fern is looking…" : "In the queue…"}</span>;
    case "error":
      return <span className="text-warn-ink">Could not send: {item.error}</span>;
    case "done": {
      const job = item.job;
      const top = job?.candidates.find((c) => c.kind === "species");
      if (job?.status === "identified" && top)
        return (
          <span className="text-ink">
            <em className="sp">{top.scientificName}</em>
            {top.commonNames[0] ? <span className="text-ink-2"> · {top.commonNames[0]}</span> : null}
            <span className="text-ink-3"> · {Math.round(top.score * 100)}%</span>
          </span>
        );
      if (job?.status === "rejected") return <span className="text-ink-2">No match. You can name it yourself.</span>;
      return <span className="text-warn-ink">Identification failed{job?.error ? `: ${job.error}` : ""}</span>;
    }
  }
}
