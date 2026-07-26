import { Sidebar } from "@/components/layout/sidebar";
import { requireSession } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 md:flex-row">
      <Sidebar user={session} />
      <main className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
