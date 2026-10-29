/**
 * Page through a PostgREST query until it runs dry.
 *
 * Supabase caps any single select at 1,000 rows (the project's max-rows
 * setting) and returns the first page SILENTLY — no error, no warning. Any
 * whole-table read that can grow past that must page. The procurement board
 * hit this on 2026-10-29: job_procurement_items reached 1,238 rows, the newest
 * 238 fell off the end, and PF Bundaberg (58 rows, all after the cut) showed as
 * "Ready to start" while PF Maroochydore's three Veyla "ordered" lines vanished
 * and the job sat in "Complete".
 *
 * Always pass a query with a deterministic `.order(...)` so pages don't overlap.
 */
const PAGE = 1000;

export async function fetchAll<T>(
  make: () => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  },
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
