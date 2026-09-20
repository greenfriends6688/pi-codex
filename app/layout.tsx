import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./settings.css";
import "./wallpaper.css";
// fork:ui-css — must stay last: it overrides upstream styles on purpose.
import "./fork-ui.css";

// A previously installed production worker can cache Turbopack chunks under the
// same local origin. Run this before Next's client code in development so a
// preview always represents the files currently being edited.
const DEV_SERVICE_WORKER_CLEANUP_SCRIPT = `
(() => {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return;

  void (async () => {
    const [registrations, cacheNames] = await Promise.all([
      navigator.serviceWorker.getRegistrations(),
      caches.keys(),
    ]);
    const piWebCaches = cacheNames.filter((name) => name.startsWith('pi-web-'));

    await Promise.all([
      ...registrations.map((registration) => registration.unregister()),
      ...piWebCaches.map((name) => caches.delete(name)),
    ]);

    if (registrations.length > 0 || piWebCaches.length > 0 || navigator.serviceWorker.controller) {
      window.location.reload();
    }
  })().catch(() => {
    // A failed best-effort cleanup must not block the development preview.
  });
})();
`;

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

// fork:boardui — BoardUI 的正文字体。Inter 带 optical-size 轴，小字号用 text
// grade、大字号用 display grade，一个变量字体覆盖全尺寸。中文不在 Inter 的
// subsets 里，会回退到 body 字体栈里的 PingFang SC。
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  axes: ["opsz"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Codex",
  description: "Pi Codex — local coding agent workbench",
  applicationName: "Pi Codex",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pi Codex",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#181818" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} ${inter.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <link rel="stylesheet" href="/location-highlight.css" />
        {process.env.NODE_ENV === "development" && (
          <script
            dangerouslySetInnerHTML={{
              __html: DEV_SERVICE_WORKER_CLEANUP_SCRIPT,
            }}
          />
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
