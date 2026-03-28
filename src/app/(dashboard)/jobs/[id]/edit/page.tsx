import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { JobForm } from "../../job-form";

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [jobResult, customersResult, categoriesResult, statusesResult, staffResult] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("*, job_staff(staff_id)")
        .eq("id", id)
        .single(),
      supabase
        .from("customers")
        .select("id, name, customer_sites(id, name)")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order"),
      supabase.from("statuses").select("*").order("sort_order"),
      supabase
        .from("staff")
        .select("id, display_name, initials, colour")
        .eq("is_active", true)
        .order("display_name"),
    ]);

  if (jobResult.error || !jobResult.data) {
    notFound();
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <Link
          href={`/jobs/${id}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {jobResult.data.number}
        </Link>
        <span className="text-muted-foreground">/</span>
        <span>Edit</span>
      </div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Edit Job</h1>
      <div className="mt-6">
        <JobForm
          customers={customersResult.data ?? []}
          categories={categoriesResult.data ?? []}
          statuses={statusesResult.data ?? []}
          staff={staffResult.data ?? []}
          job={jobResult.data}
        />
      </div>
    </div>
  );
}
