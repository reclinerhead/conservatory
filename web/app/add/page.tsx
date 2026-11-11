import { Uploader } from "@/components/uploader";

export const metadata = { title: "Add a plant · The Conservatory" };

export default function AddPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pb-14 pt-4 sm:gap-7 sm:px-8 sm:pt-8">
      <h1 className="text-h1 leading-[1.1]">Add a plant</h1>
      <Uploader />
    </main>
  );
}
