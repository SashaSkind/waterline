import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
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
      <body className="min-h-full flex flex-col bg-ivory font-sans text-wave-950">
        <header className="border-b border-wave-200/70 bg-ivory/90">
          <div className="mx-auto flex w-full max-w-7xl items-baseline gap-3 px-6 py-4">
            <Link
              href="/"
              className="flex items-center gap-2.5 self-center text-lg font-semibold tracking-tight text-wave-950"
            >
              <Image
                src="/logo.png"
                alt=""
                width={28}
                height={28}
                priority
                className="rounded-md"
              />
              Waterline
            </Link>
            <span className="hidden text-sm text-wave-400 sm:inline">
              where drug margins cross zero
            </span>
            <Link
              href="/explore"
              className="ml-auto text-sm text-wave-600 transition-colors hover:text-wave-900"
            >
              Margin map
            </Link>
            <Link
              href="/analytics"
              className="text-sm text-wave-600 transition-colors hover:text-wave-900"
            >
              Usage
            </Link>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
