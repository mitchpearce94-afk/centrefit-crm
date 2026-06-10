import { redirect } from "next/navigation";

// Superseded by the richer /nbn/services view (status buckets + per-service
// cockpit). Kept as a redirect so old bookmarks keep working.
export default function ActiveConnectionsPage() {
  redirect("/nbn/services?status=active");
}
