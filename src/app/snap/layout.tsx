import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui/toast";
import { ViewportHeightFix } from "@/components/viewport-height-fix";

// Receipts app shell: no sidebar, no nav — the page is the camera. Its own
// manifest + icon so it installs as a separate "Receipts" home-screen app.
export const metadata: Metadata = {
  title: "Receipts",
  manifest: "/snap/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Receipts",
    statusBarStyle: "black",
  },
  icons: {
    icon: "/snap-icon-192.png",
    apple: "/snap-apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b1220",
};

export default function SnapLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ViewportHeightFix />
      {children}
    </ToastProvider>
  );
}
