import { redirect } from "next/navigation";

/**
 * Self-service notification preferences are gone — admins manage them
 * centrally on each staff member's row in /staff. Old bookmarks land
 * here and get bounced to the staff list (which carries the editor on
 * each row when the viewer is an admin).
 */
export default function NotificationSettingsRedirect() {
  redirect("/staff");
}
