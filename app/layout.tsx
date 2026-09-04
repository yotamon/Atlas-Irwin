import type { Metadata } from "next";
import localFont from "next/font/local";
import { Manrope } from "next/font/google";
import { getSiteUrl } from "@/lib/site-url";
import { ThemeInitScript } from "@/components/theme-init-script";
import "./globals.css";
import "./stem-intelligence.css";

const headingFont = localFont({
  src: "../public/fonts/montage_2/Montage-Demo.ttf",
  variable: "--font-heading",
  display: "swap",
});

const bodyFont = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-theme="light"
      className={`${headingFont.variable} ${bodyFont.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        <ThemeInitScript />
        {children}
      </body>
    </html>
  );
}
