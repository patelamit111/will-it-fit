import type { Metadata } from "next";
import { Architects_Daughter, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const blueprint = Architects_Daughter({
  variable: "--font-blueprint",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Will It Fit?",
  description:
    "Upload a floor plan, calibrate scale, and test real-size furniture before you move.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${blueprint.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
