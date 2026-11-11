"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { LeafMark } from "@/components/topbar";
import { cardNames, dayLabel, STATUS_LABEL } from "@/lib/collection";
import type { TodoView } from "@/lib/specimens";
import { countsLine, DONE_SHOWN } from "@/lib/todos";

// The To-do page's two lists (#103). A row is a large checkbox, the plant's
// photo and name (both open the plant) and the remedy; a pending row opens
// in place to what Fern saw, the whole remedy and where to go next. The
// lists are the ones the page was loaded with: ticking, unticking and
// removing change a row where it stands, and it moves to the other list on
// the next load, so nothing jumps under the pointer. Each press also
// refreshes the page behind it, which keeps the top bar's count true.

type Change = { completedAt?: string | null; removed?: true };

function without<V>(record: Record<number, V>, id: number): Record<number, V> {
  const next = { ...record };
  delete next[id];
  return next;
}

export function TodoList({ pending, done }: { pending: TodoView[]; done: TodoView[] }) {
  const router = useRouter();
  // Fixed at load on purpose (see above); the refreshed props are for the next visit.
  const [lists] = useState({ pending, done });
  const [changes, setChanges] = useState<Record<number, Change>>({});
  const [failed, setFailed] = useState<Record<number, string>>({});
  const [showAll, setShowAll] = useState(false);

  const now = (t: TodoView) => ({ completedAt: changes[t.id]?.completedAt !== undefined ? changes[t.id].completedAt! : t.completedAt, removed: changes[t.id]?.removed === true });
  const all = [...lists.pending, ...lists.done].map(now).filter((t) => !t.removed);
  const pendingCount = all.filter((t) => !t.completedAt).length;

  async function send(t: TodoView, change: Change) {
    const before = changes[t.id];
    setChanges((c) => ({ ...c, [t.id]: { ...c[t.id], ...change } })); // at once; put back if the server says no
    setFailed((f) => without(f, t.id));
    try {
      const r = change.removed
        ? await fetch(`/api/todos/${t.id}`, { method: "DELETE" })
        : await fetch(`/api/todos/${t.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: Boolean(change.completedAt) }) });
      if (!r.ok && !(change.removed && r.status === 404)) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `server ${r.status}`);
      router.refresh();
    } catch (err) {
      setChanges((c) => (before ? { ...c, [t.id]: before } : without(c, t.id)));
      setFailed((f) => ({ ...f, [t.id]: err instanceof Error ? err.message : "it did not go through" }));
    }
  }
  const tick = (t: TodoView, on: boolean) => void send(t, { completedAt: on ? new Date().toISOString() : null });
  const remove = (t: TodoView) => void send(t, { removed: true });

  const doneShown = showAll ? lists.done : lists.done.slice(0, DONE_SHOWN);
  return (
    <>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-h1 leading-[1.05] sm:text-page-title">To-do</h1>
        <p className="max-w-[62ch] text-lead text-ink-2">What you chose to keep from your plants&rsquo; health checks. Tick one off when you have done it.</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <span className="tag tabular-nums" aria-live="polite">
            {countsLine(pendingCount, all.length - pendingCount)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-7">
        <section aria-labelledby="todo-h" className="card flex min-w-0 flex-[999_1_560px] flex-col gap-2 p-5 sm:px-8 sm:py-7">
          <h2 id="todo-h" className="text-section leading-tight">
            To do
          </h2>
          {lists.pending.length === 0 ? (
            // Reserved: a row's height, so the first to-do lands where this stood.
            <div className="flex min-h-[92px] items-center gap-4 py-4">
              <span aria-hidden className="flex h-14 w-14 flex-none items-center justify-center rounded-thumb bg-sage">
                <LeafMark size={28} className="text-[#6B8F66]" />
              </span>
              <div className="min-w-0">
                <p className="font-bold">Nothing to do</p>
                <p className="text-meta text-ink-2">Add one from a finding in a plant&rsquo;s health check.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {lists.pending.map((t) => (
                <li key={t.id}>
                  <PendingRow todo={t} {...now(t)} error={failed[t.id]} onTick={(on) => tick(t, on)} onRemove={() => remove(t)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="flex w-full flex-[1_1_300px] flex-col gap-5 lg:max-w-sidebar">
          <section aria-labelledby="done-h" className="card px-5 pb-3 pt-5">
            <h3 id="done-h" className="mb-2 text-h3">
              Done
            </h3>
            {lists.done.length === 0 ? (
              <div className="flex min-h-[68px] flex-col justify-center py-2.5">
                <p className="font-bold">Nothing done yet</p>
                <p className="text-meta text-ink-2">What you tick off is kept here.</p>
              </div>
            ) : (
              <ul>
                {doneShown.map((t) => (
                  <li key={t.id} className="border-t border-sage first:border-t-0">
                    <DoneRow todo={t} {...now(t)} error={failed[t.id]} onTick={(on) => tick(t, on)} />
                  </li>
                ))}
              </ul>
            )}
            {lists.done.length > DONE_SHOWN && !showAll ? (
              <button type="button" onClick={() => setShowAll(true)} className="btn btn-ghost btn-compact mb-2 mt-1">
                Show all {lists.done.length}
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}

/** The plant's photo, or a leaf on sage when it has none; decorative, since the name beside it is the link. */
function Thumb({ url, size }: { url: string | null; size: 48 | 56 }) {
  const box = size === 56 ? "h-14 w-14" : "h-12 w-12";
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading="lazy" width={size} height={size} className={`${box} flex-none rounded-thumb border border-line bg-sage object-cover`} />
  ) : (
    <span aria-hidden className={`${box} flex flex-none items-center justify-center rounded-thumb bg-sage`}>
      <LeafMark size={size / 2} className="text-[#6B8F66]" />
    </span>
  );
}

/** The 44 px target with a 28 px box: the one control a row is for. */
function Tick({ checked, label, onChange }: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <label className="flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full hover:bg-sage sm:row-span-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="h-7 w-7 cursor-pointer accent-moss" />
    </label>
  );
}

type RowProps = { todo: TodoView; completedAt: string | null; removed: boolean; error?: string; onTick: (on: boolean) => void };

function PendingRow({ todo, completedAt, removed, error, onTick, onRemove }: RowProps & { onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { name, species } = cardNames(todo.plant);
  const plantHref = `/plants/${todo.plant.id}`;
  const done = completedAt !== null;

  if (removed) {
    return (
      <p role="status" className="flex min-h-[92px] items-center gap-4 py-4 text-ink-2">
        <span aria-hidden className="h-11 w-11 flex-none" />
        <span>
          Removed from your list. It can be added again from{" "}
          <Link href={`${plantHref}#health`} className="font-semibold">
            {name}&rsquo;s health check
          </Link>
          .
        </span>
      </p>
    );
  }

  // On a phone the remedy runs the row's full width under the checkbox, photo and name; from 640 px it sits beside them.
  const under = "col-span-full sm:col-span-1 sm:col-start-3";
  return (
    <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 py-4 sm:items-start sm:gap-x-3">
      <Tick checked={done} label={`${done ? "Done" : "Mark as done"}: ${name}, ${todo.remedy}`} onChange={onTick} />
      <Link href={plantHref} tabIndex={-1} aria-hidden className="flex-none sm:row-span-3">
        <Thumb url={todo.plant.thumbUrl} size={56} />
      </Link>
      <p className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={plantHref} className="font-bold text-ink">
          {name}
        </Link>
        {todo.plant.status !== "alive" ? <span className="tag tag-warn">{STATUS_LABEL[todo.plant.status]}</span> : null}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`${under} -mx-2 flex cursor-pointer items-start gap-2 rounded-tile px-2 py-1 text-left transition-colors duration-[120ms] hover:bg-ground`}
      >
        <span className={`min-h-[2lh] flex-1 text-body ${open ? "" : "line-clamp-2"} ${done ? "text-ink-2 line-through" : ""}`}>{todo.remedy}</span>
        <span className="inline-flex h-[1lh] flex-none items-center gap-1 text-meta font-semibold text-moss">
          <span className="max-sm:sr-only">{open ? "Close" : "What Fern saw"}</span>
          <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-[120ms] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      {/* Reserved: one line, for "Done" and for a press that did not go through. */}
      <p role="status" aria-live="polite" className={`${under} min-h-[1lh] text-meta ${error ? "text-warn-ink" : "text-ink-2"}`}>
        {error ? `That didn’t go through: ${error}` : done ? "Done today. Untick it to put it back." : `Added ${dayLabel(todo.createdAt)}`}
      </p>
      {open ? (
        <div id={id} className={`${under} mt-1 flex flex-col gap-3 rounded-tile bg-ground p-4`}>
          <div>
            <h4 className="mb-1 text-meta font-semibold text-ink-2">What Fern saw</h4>
            <p className="font-bold">{todo.seen}</p>
            <p className="mt-1.5">
              <span className="tag">{todo.likelihood === "likely" ? "Likely cause" : "Possible cause"}</span>
            </p>
          </div>
          <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 text-meta">
            <Link href={plantHref} className="font-semibold">
              Open this plant
            </Link>
            <Link href={`/species/${todo.plant.speciesId}`} className="font-semibold">
              {species ? (
                <>
                  About <span className="sp">{species}</span>
                </>
              ) : (
                "About its species"
              )}
            </Link>
            <button type="button" onClick={onRemove} className="btn btn-ghost btn-compact ml-auto bg-surface text-meta">
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DoneRow({ todo, completedAt, error, onTick }: RowProps) {
  const { name } = cardNames(todo.plant);
  const done = completedAt !== null;
  return (
    <div className="flex min-h-[68px] items-center gap-2 py-2.5">
      <Tick checked={done} label={`${done ? "Put back on the list" : "Mark as done"}: ${name}, ${todo.remedy}`} onChange={onTick} />
      <Thumb url={todo.plant.thumbUrl} size={48} />
      <div className="min-w-0 flex-1 pl-1">
        <p className="truncate">
          <Link href={`/plants/${todo.plant.id}`} className="font-bold text-ink">
            {name}
          </Link>
        </p>
        <p className={`truncate text-meta text-ink-2 ${done ? "line-through" : ""}`} title={todo.remedy}>
          {todo.remedy}
        </p>
        <p role="status" aria-live="polite" className={`truncate text-meta ${error ? "text-warn-ink" : "text-ink-2"}`}>
          {error ? `That didn’t go through: ${error}` : done ? `Done ${dayLabel(completedAt)}` : "Back on your list"}
        </p>
      </div>
    </div>
  );
}
