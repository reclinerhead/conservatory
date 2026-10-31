import type { Metadata, Viewport } from "next";
import { Alegreya_Sans, Bodoni_Moda } from "next/font/google";
import "./globals.css";

// Glasshouse type pairing: Bodoni Moda, the high-contrast didone of a
// nineteenth-century botanical plate caption, for display; Alegreya Sans, a
// warm humanist sans with a tall x-height, for everything a person reads at
// arm's length on a phone. Self-hosted at build time by next/font.
const bodoni = Bodoni_Moda({
  variable: "--font-bodoni",
  subsets: ["latin"],
  axes: ["opsz"],
});

const alegreya = Alegreya_Sans({
  variable: "--font-alegreya",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "The Conservatory",
  description: "A living inventory of the plants in a household, built from photos taken on a phone.",
};

export const viewport: Viewport = {
  themeColor: "#f3efe4",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodoni.variable} ${alegreya.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-glass text-ink font-body">{children}</body>
    </html>
  );
}
