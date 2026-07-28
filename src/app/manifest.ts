import type { MetadataRoute } from "next";

// PWA manifest — makes the CRM installable from the browser ("Add to Home
// Screen") so it opens full-screen from its own icon like a native app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Centrefit CRM",
    short_name: "Centrefit",
    description: "Centrefit Group operations platform",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
