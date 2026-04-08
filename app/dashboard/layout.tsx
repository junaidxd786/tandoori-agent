import { Sidebar } from "@/app/components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex bg-slate-50 text-slate-900 h-screen overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div
          className="absolute inset-0 pointer-events-none z-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, black 1px, transparent 0)', backgroundSize: '24px 24px' }}
        />

        <div className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar relative z-10">
          <div className="max-w-[1400px] mx-auto w-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
