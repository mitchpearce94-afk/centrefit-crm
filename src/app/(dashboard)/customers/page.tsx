import { redirect } from "next/navigation";

// Site-first Phase C (D1): the Customers directory is gone — Sites is the
// only directory. Old bookmarks and internal links land on /sites.
export default function CustomersPage() {
  redirect("/sites");
}
