import Link from "next/link";
import { Uploader } from "@/components/uploader";

export const metadata = { title: "Add a plant · The Conservatory" };

export default function AddPage() {
  return (
    <>
      <header className="mullions border-b border-line">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 pt-8 pb-6 sm:pt-10 sm:pb-8">
          <Link href="/" className="font-body text-sm font-medium text-moss hover:text-moss-deep underline-offset-4 hover:underline">
            &larr; The Conservatory
          </Link>
          <h1 className="font-display text-4xl sm:text-5xl text-ink mt-3">Add a plant</h1>
          <p className="font-body text-base text-ink-dim mt-2 max-w-prose">
            Take a photo now, or choose the ones you took in the garden. Each one is sent to be identified, and you
            put the name on it afterwards.
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6 py-6">
        <Uploader />
      </main>
    </>
  );
}
