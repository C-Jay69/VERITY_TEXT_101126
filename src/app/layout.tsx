import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000",
  ),
  title: "VerityText — AI Text Detector & Humanizer",
  description: "Upload a document and get a seven-signal AI-text detection analysis with an aggregate verdict, evidence snippets, and a downloadable report. Optionally humanize the text to reduce detected signals.",
  keywords: ["AI text detector", "AI humanizer", "VerityText", "burstiness", "perplexity", "AI content detection"],
  authors: [{ name: "VerityText" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "VerityText — AI Text Detector & Humanizer",
    description: "Seven-signal AI-text detection with an aggregate verdict, evidence, and an optional humanizer.",
    siteName: "VerityText",
    type: "website",
    images: [
      {
        url: "/images/hero-library.webp",
        width: 2200,
        height: 1200,
        alt: "Library shelves lined with books",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VerityText — AI Text Detector & Humanizer",
    description: "Seven-signal AI-text detection with an aggregate verdict, evidence, and an optional humanizer.",
    images: ["/images/hero-library.webp"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
