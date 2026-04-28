import { redirect } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { NotificationsBell } from "@/components/notifications-bell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("display_name, initials, role, colour, must_change_password")
    .eq("id", user.id)
    .single();

  if (staff?.must_change_password) {
    redirect("/change-password");
  }

  return (
    <ToastProvider>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar
          user={user}
          staff={staff ?? null}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card pl-16 pr-4">
            <Image
              src="/centrefit-logo.png"
              alt="Centrefit Group"
              width={240}
              height={60}
              priority
              className="h-7 w-auto"
              style={{ filter: "brightness(0) invert(1)" }}
            />
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              CRM
            </span>
            <div className="ml-auto">
              <NotificationsBell />
            </div>
          </div>
          <div className="hidden lg:flex sticky top-0 z-30 h-12 items-center justify-end gap-2 border-b border-border bg-card px-6">
            <NotificationsBell />
          </div>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
