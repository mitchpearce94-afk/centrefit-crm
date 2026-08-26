/**
 * Manifest for the Receipts home-screen app. Separate from the CRM's own
 * manifest so "Add to Home Screen" from /snap installs a second icon that
 * opens straight into the camera, not the dashboard.
 */
export function GET() {
  return Response.json(
    {
      id: "/snap",
      name: "Centrefit Receipts",
      short_name: "Receipts",
      description: "Snap a receipt — it goes straight to accounts.",
      start_url: "/snap",
      scope: "/snap",
      display: "standalone",
      orientation: "portrait",
      background_color: "#0b1220",
      theme_color: "#0b1220",
      icons: [
        { src: "/snap-icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/snap-icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/snap-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } },
  );
}
