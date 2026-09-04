import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { getSiteUrl } from "@/lib/site-url";
import { ThemeInitScript } from "@/components/theme-init-script";
import "./globals.css";
import "./font-system.css";
import "./stem-intelligence.css";

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
      className={bodyFont.variable}
    >
      <body className="flex min-h-screen flex-col">
        <ThemeInitScript />
        {children}
      </body>
    </html>
  );
}
