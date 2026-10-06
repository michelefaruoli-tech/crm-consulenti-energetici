import { headers } from "next/headers";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { requireSession } from "@/lib/auth";
import { getRequestMeta } from "@/lib/request-meta";
import { logAccessEvent } from "@/lib/security-log";
import type { AppRole } from "@/lib/constants";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const h = await headers();
  const path = h.get("x-pathname") ?? "/";
  const meta = await getRequestMeta();
  await logAccessEvent({
    userId: session.id,
    email: session.email,
    path,
    meta,
  });

  const user = {
    name: session.name,
    email: session.email,
    role: session.role as AppRole,
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 md:flex-row">
      <Sidebar user={user} />
      <main className="min-h-0 min-w-0 flex-1 overflow-auto">
        <TopBar user={user} variant="desktop" />
        <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:p-8 md:pt-2">
          {children}
        </div>
      </main>
    </div>
  );
}
