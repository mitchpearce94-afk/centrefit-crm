import { createClient } from "@/lib/supabase/server";
import { StaffList } from "./staff-list";

export default async function StaffPage() {
  const supabase = await createClient();

  const { data: staff, error } = await supabase
    .from("staff")
    .select("*")
    .order("display_name");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check if current user is admin
  const currentStaff = staff?.find((s) => s.id === user?.id);
  const isAdmin = currentStaff?.role === "admin";

  if (error) {
    return (
      <div className="text-destructive">
        Error loading staff: {error.message}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {staff?.length ?? 0} team members
      </p>
      <div className="mt-6">
        <StaffList staff={staff ?? []} isAdmin={isAdmin} currentUserId={user?.id ?? ""} />
      </div>
    </div>
  );
}
