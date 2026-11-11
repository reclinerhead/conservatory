import Link from "next/link";
import { TodoList } from "@/components/todo-list";
import { withReadDb } from "@/lib/jobs";
import { readTodos } from "@/lib/specimens";
import { doneTodos, pendingTodos } from "@/lib/todos";

// /todo: the to-do list (#103). Every finding the owner chose to keep from a
// health check, still to do or done, each with the plant it belongs to. The
// lists are read here and sorted by lib/todos.ts; the client component ticks
// them off in place.
export const dynamic = "force-dynamic";

export const metadata = { title: "To-do · The Conservatory" };

export default function TodoPage() {
  const todos = withReadDb(readTodos, []);

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-6 px-4 pb-14 pt-6 sm:gap-7 sm:px-8 sm:pt-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
        <Link href="/" className="font-semibold text-ink-2">
          Collection
        </Link>
        <span aria-hidden>›</span>
        <span aria-current="page" className="font-semibold text-ink">
          To-do
        </span>
      </nav>
      <TodoList pending={pendingTodos(todos)} done={doneTodos(todos)} />
    </main>
  );
}
