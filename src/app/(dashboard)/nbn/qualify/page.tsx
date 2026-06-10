import { QualifyTool } from "./qualify-tool";

export default function NbnQualifyPage() {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-semibold">Address qualification</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Check any address against the live nbn® network — full technology, speed-tier and
          capacity detail (the unfiltered view the website never shows customers).
        </p>
      </div>
      <QualifyTool />
    </div>
  );
}
