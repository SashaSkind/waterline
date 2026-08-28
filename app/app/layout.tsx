import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Waterline",
  description: "What a drug costs at every point in the supply chain.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-950 font-sans">
        <header className="border-b border-neutral-800/80">
          <div className="mx-auto flex w-full max-w-5xl items-baseline gap-3 px-6 py-4">
            <Link
              href="/"
              className="text-lg font-semibold tracking-tight text-neutral-50"
            >
              Waterline
            </Link>
            <span className="hidden text-sm text-neutral-500 sm:inline">
              where drug margins cross zero
            </span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
