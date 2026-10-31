import { Uploader } from "@/components/uploader";

export const metadata = { title: "Add a plant · The Conservatory" };

export default function AddPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-7 px-4 pb-14 pt-6 sm:px-8 sm:pt-8">
      <div>
        <h1 className="text-h1 leading-[1.1]">Add a plant</h1>
        <p className="mt-2 max-w-prose text-lead text-ink-2">
          Take a photo now, or choose the ones you took in the garden. Each one goes to Fern to be identified, and
          you put the name on it afterwards.
        </p>
      </div>
      <Uploader />
    </main>
  );
}
