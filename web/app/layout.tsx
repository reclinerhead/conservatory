import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito_Sans } from "next/font/google";
import { connection } from "next/server";
import { TopBar } from "@/components/topbar";
import { withReadDb } from "@/lib/jobs";
import { pendingTodoCount } from "@/lib/specimens";
import "./globals.css";

// The faces design/DESIGN.md §3 names: Fraunces for headings, binomials and
// big numbers; Nunito Sans for everything else. Self-hosted at build time by
// next/font; the variables feed the font tokens in design/tokens.css, so the
// boxes make no font requests.
//
// Fraunces carries its true italic (binomials are always italic) and NOT the
// optical-size axis DESIGN.md asks for: Next 16.2's Turbopack refuses a
// next/font/google call that lists both `axes` and two `style`s ("queries
// have exactly one entry"), and the italic is the one a reader sees.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const nunito = Nunito_Sans({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "The Conservatory",
  description: "A living inventory of the plants in a household, built from photos taken on a phone.",
};

export const viewport: Viewport = {
  themeColor: "#F3F6EF",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The top bar's To-do count (#103) comes from the database on every
  // request, never from the build: the query is synchronous, so without this
  // a page that is otherwise static would bake the count in.
  await connection();
  const todoCount = withReadDb(pendingTodoCount, 0);
  return (
    <html lang="en" className={`${fraunces.variable} ${nunito.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ground text-ink font-sans leading-normal">
        <TopBar todoCount={todoCount} />
        {children}
      </body>
    </html>
  );
}
