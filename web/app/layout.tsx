import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito_Sans } from "next/font/google";
import { TopBar } from "@/components/topbar";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${nunito.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ground text-ink font-sans leading-normal">
        <TopBar />
        {children}
      </body>
    </html>
  );
}
