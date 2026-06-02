import type { Metadata } from "next";
import { Geist, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Body: clean, neutral sans.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display: high-contrast serif with optical sizing — characterful, celestial.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
});

// Telemetry / technical labels.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Anu — roof intelligence from the sky",
  description:
    "Automated roof-measurement reports from public aerial imagery and LiDAR — total area, per-facet pitch, edge lengths, and waste factor from a single address. Built entirely on Cloudflare.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${fraunces.variable} ${jetbrainsMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
