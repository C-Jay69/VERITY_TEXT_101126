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
  title: "VerityText — AI Text Detector & Humanizer",
  description: "Upload a document and get a seven-signal AI-text detection analysis with an aggregate verdict, evidence snippets, and a downloadable report. Optionally humanize the text to reduce detected signals.",
  keywords: ["AI text detector", "AI humanizer", "VerityText", "burstiness", "perplexity", "AI content detection"],
  authors: [{ name: "VerityText" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "VerityText — AI Text Detector & Humanizer",
    description: "Seven-signal AI-text detection with an aggregate verdict, evidence, and an optional humanizer.",
    siteName: "VerityText",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VerityText — AI Text Detector & Humanizer",
    description: "Seven-signal AI-text detection with an aggregate verdict, evidence, and an optional humanizer.",
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
