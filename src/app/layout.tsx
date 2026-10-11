import type { Metadata, Viewport } from "next";
import "./globals.css";

const description = "Paste an AlbionBB battle link and your squad roster to see kills, deaths, K/D, damage, healing and regear cost for that battle.";

export const metadata: Metadata = {
  metadataBase: process.env.VERCEL_PROJECT_PRODUCTION_URL ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) : undefined,
  title: { default: "BombStatsChecker — Albion Online squad K/D & regear", template: "%s · BombStatsChecker" },
  description,
  applicationName: "BombStatsChecker",
  openGraph: { title: "BombStatsChecker", description, siteName: "BombStatsChecker", type: "website" },
  twitter: { card: "summary_large_image", title: "BombStatsChecker", description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1016" },
  ],
};

// Applies the saved/system theme before paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
