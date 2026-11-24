import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const chakra = localFont({
  src: [
    { path: "./fonts/ChakraPetch-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ChakraPetch-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ChakraPetch-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rotom · Diagnosa Honda BeAT",
  description: "Model 3D Honda BeAT yang bisa dibongkar per komponen. Tuliskan keluhan motor, lalu lihat komponen yang perlu diperiksa.",
  appleWebApp: { capable: true, title: "Rotom", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e141c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={chakra.variable}>
      <body>{children}</body>
    </html>
  );
}
