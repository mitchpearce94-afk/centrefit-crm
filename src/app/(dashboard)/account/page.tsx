import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountForm } from "./account-form";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("staff")
    .select("id, display_name, initials, email, role, phone, colour")
    .eq("id", user.id)
    .single();

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">My account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Update your details and password.</p>
      <div className="mt-6">
        <AccountForm staff={staff} />
      </div>
    </div>
  );
}
