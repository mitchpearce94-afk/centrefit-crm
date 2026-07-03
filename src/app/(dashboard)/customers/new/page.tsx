import { redirect } from "next/navigation";

// Site-first Phase C (D5): customers are never created directly — the new
// site form captures owner details and creates the backing record invisibly.
export default function NewCustomerPage() {
  redirect("/sites");
}
