import { redirect } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { NotificationsBell } from "@/components/notifications-bell";
import { SuggestionButton } from "@/components/suggestion-button";
import { ToastProvider } from "@/components/ui/toast";

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
        <Sidebar user={user} staff={staff ?? null} />
        <main className="flex-1 overflow-y-auto pb-mobile-nav lg:pb-0">
          {/* Mobile fallback top bar — visible on screens that haven't yet
              migrated to <PageHeader>. Once a page renders its own
              <PageHeader> it stacks below this, which is intentional during
              the rollout — pages get migrated one at a time. */}
          {/* Mobile fallback top bar — visible on screens that haven't yet
              migrated to <PageHeader>. */}
          <div
            className="lg:hidden sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-card/95 backdrop-blur px-4"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
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
            <div className="ml-auto flex items-center gap-1.5">
              <SuggestionButton />
              <NotificationsBell />
            </div>
          </div>
          {/* Desktop top bar — suggestion + bell, right-aligned. */}
          <div className="hidden lg:flex sticky top-0 z-20 h-12 items-center justify-end gap-2 border-b border-border bg-card px-6">
            <SuggestionButton />
            <NotificationsBell />
          </div>
          <div className="p-4 md:p-6">{children}</div>
        </main>
        <MobileNav user={user} staff={staff ?? null} />
      </div>
    </ToastProvider>
  );
}
