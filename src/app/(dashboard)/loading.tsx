export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Title skeleton */}
      <div>
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="mt-2 h-4 w-72 rounded bg-muted" />
      </div>

      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="mt-2 h-6 w-12 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="h-4 w-32 rounded bg-muted mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-muted" />
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="h-4 w-32 rounded bg-muted mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-muted" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
