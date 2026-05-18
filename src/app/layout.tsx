import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Centrefit CRM",
  description: "Centrefit Group operations platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Inline script that runs before paint so the chosen theme class is on
// <html> before any CSS evaluates — kills the dark/light flash on refresh.
// Stays in sync with src/components/theme-toggle.tsx (same key, same values).
const themeBootScript = `
try {
  var t = localStorage.getItem('cf-theme');
  if (t !== 'light' && t !== 'dark') t = 'dark';
  document.documentElement.classList.add(t);
} catch (e) {
  document.documentElement.classList.add('dark');
}
`.trim();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
