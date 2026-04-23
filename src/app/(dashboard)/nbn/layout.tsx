import Link from "next/link";
import { NbnTabs } from "./nbn-tabs";

export default function NbnLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">NBN</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Active connections, enquiries from the website, and NBN-related workflows.
          Powered by the{" "}
          <Link href="https://rev3.kinetix.net.au" target="_blank" className="underline hover:text-foreground">
            Kinetix Rev3 API
          </Link>
          .
        </p>
      </div>

      <div className="mt-5 border-b border-border">
        <NbnTabs />
      </div>

      <div className="mt-6">{children}</div>
    </div>
  );
}
