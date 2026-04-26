import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("staff")
    .select("display_name, must_change_password")
    .eq("id", user.id)
    .single();

  // If they don't need to change it, send them home.
  if (!staff?.must_change_password) redirect("/");

  return (
    <ChangePasswordForm
      forced
      displayName={staff?.display_name ?? user.email ?? ""}
    />
  );
}
