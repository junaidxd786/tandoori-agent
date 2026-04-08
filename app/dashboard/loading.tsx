export default function DashboardLoading() {
  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-3">
        <div className="h-9 w-48 animate-pulse rounded-2xl bg-slate-200" />
        <div className="h-4 w-80 animate-pulse rounded-full bg-slate-200" />
      </div>

      <div className="grid min-h-[74vh] gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-full animate-pulse rounded-[22px] bg-slate-100" />
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <div className="h-10 w-64 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-24 animate-pulse rounded-[26px] bg-slate-100" />
            <div className="h-24 animate-pulse rounded-[26px] bg-slate-100" />
            <div className="h-24 animate-pulse rounded-[26px] bg-slate-100" />
          </div>
        </div>
      </div>
    </div>
  );
}
