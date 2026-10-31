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
  auto: "Let it guess",
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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="h-14 rounded border border-terracotta bg-terracotta font-body text-base font-medium text-white hover:bg-terracotta-deep transition-colors"
        >
          Take a photo
        </button>
        <button
          type="button"
          onClick={() => rollRef.current?.click()}
          className="h-14 rounded border border-line-strong bg-pane font-body text-base font-medium text-ink hover:bg-pane-2 transition-colors"
        >
          Choose from the camera roll
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={rollRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      <ul className="flex flex-col gap-3" aria-live="polite">
        {items.map((it) => (
          <li key={it.key} className="flex gap-4 rounded border border-line bg-pane p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.preview} alt="" className="h-20 w-20 shrink-0 rounded object-cover bg-pane-2" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="truncate font-body text-sm text-ink-dim">{it.file.name}</p>
                {it.state === "ready" || it.state === "error" ? (
                  <button type="button" onClick={() => remove(it.key)} className="shrink-0 font-body text-sm text-ink-faint hover:text-ink underline-offset-4 hover:underline">
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
                    className={`h-9 rounded-full border px-3 font-body text-sm transition-colors disabled:opacity-60 ${
                      it.organ === o ? "border-moss bg-moss text-white" : "border-line-strong bg-pane text-ink-dim hover:bg-pane-2"
                    }`}
                  >
                    {ORGAN_LABEL[o]}
                  </button>
                ))}
              </div>
              <p className="mt-2 min-h-6 font-body text-base tabular-nums">
                <Status item={it} />
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3">
        <p className="font-body text-base text-ink-dim">
          {items.length === 0
            ? "Nothing chosen yet."
            : doneCount === items.length
              ? "All identified. Put the names on them whenever you like."
              : `${items.length} ${items.length === 1 ? "photo" : "photos"} chosen.`}
        </p>
        {doneCount === items.length && items.length > 0 ? (
          <Link href="/" className="inline-flex h-12 items-center rounded bg-moss px-6 font-body text-base font-medium text-white hover:bg-moss-deep">
            Back to the Conservatory
          </Link>
        ) : (
          <button
            type="button"
            disabled={busy || readyCount === 0}
            onClick={uploadAll}
            className="inline-flex h-12 items-center rounded bg-terracotta px-6 font-body text-base font-medium text-white hover:bg-terracotta-deep disabled:opacity-50 disabled:hover:bg-terracotta transition-colors"
          >
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
      return <span className="text-ink-faint">Ready to send</span>;
    case "uploading":
      return <span className="text-ink-dim">Sending{item.attempt > 1 ? ` (try ${item.attempt})` : ""}…</span>;
    case "queued":
      return <span className="text-ink-dim">{item.job?.status === "identifying" ? "Identifying…" : "In the queue…"}</span>;
    case "error":
      return <span className="text-terracotta-deep">Could not send: {item.error}</span>;
    case "done": {
      const job = item.job;
      const top = job?.candidates.find((c) => c.kind === "species");
      if (job?.status === "identified" && top)
        return (
          <span className="text-ink">
            <em className="not-italic font-medium">{top.scientificName}</em>
            {top.commonNames[0] ? <span className="text-ink-dim"> · {top.commonNames[0]}</span> : null}
            <span className="text-ink-faint"> · {Math.round(top.score * 100)}%</span>
          </span>
        );
      if (job?.status === "rejected") return <span className="text-ink-dim">No match. You can name it yourself.</span>;
      return <span className="text-terracotta-deep">Identification failed{job?.error ? `: ${job.error}` : ""}</span>;
    }
  }
}
