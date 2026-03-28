import { CustomerForm } from "../customer-form";

export default function NewCustomerPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">New Customer</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add a new customer to the CRM
      </p>
      <div className="mt-6">
        <CustomerForm />
      </div>
    </div>
  );
}
