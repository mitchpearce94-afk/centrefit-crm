import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { MyListClient, type PersonalTask } from "./my-list-client";

export const dynamic = "force-dynamic";

// Private list (assistant-CONTEXT.md D1): page 404s for everyone but Mitchell.
// RLS already scopes rows to the owner — this gate just keeps the page itself
// invisible to other staff.
const OWNER_EMAIL = "mitchell@centrefit.com.au";

export default async function MyListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email?.toLowerCase() !== OWNER_EMAIL) notFound();

  const { data: openTasks } = await supabase
    .from("personal_tasks")
    .select("*")
    .neq("status", "done")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  const doneCutoff = new Date(Date.now() - 36 * 3600_000).toISOString();
  const { data: doneTasks } = await supabase
    .from("personal_tasks")
    .select("*")
    .eq("status", "done")
    .gte("completed_at", doneCutoff)
    .order("completed_at", { ascending: false });

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My List</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One list, one pass a day. Only you can see this.
        </p>
      </div>
      <div className="mt-5">
        <MyListClient
          ownerId={user.id}
          initialOpen={(openTasks ?? []) as PersonalTask[]}
          initialDone={(doneTasks ?? []) as PersonalTask[]}
        />
      </div>
    </div>
  );
}
