import type { Metadata } from "next";
import { Instrument_Serif, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  variable: "--font-display",
  subsets: ["latin"],
});

const ibmPlex = IBM_Plex_Sans({
  weight: ["300", "400", "500"],
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "River — time flows, not ticks",
  description:
    "A physics-based spatial task scheduler where tasks are organic shapes that drift in a river of time. No red, no overdue, no shame.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${ibmPlex.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
