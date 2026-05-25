import { createClient } from "@/lib/supabase/server";
import { JobTypesAdmin } from "./job-types-admin";

export default async function SettingsJobTypesPage() {
  const supabase = await createClient();
  const { data: types } = await supabase
    .from("categories")
    .select("*")
    .eq("type", "job_type")
    .order("sort_order")
    .order("name");

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Job Types</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The categories that show up in the Job Type dropdown when creating a job.
      </p>
      <div className="mt-5">
        <JobTypesAdmin types={types ?? []} />
      </div>
    </div>
  );
}
