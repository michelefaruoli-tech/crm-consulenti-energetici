import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { listAppNotificationsForUser } from "@/lib/app-notifications";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 30;

  const data = await listAppNotificationsForUser(session.id, { limit });
  return NextResponse.json({
    items: data.items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount: data.unreadCount,
  });
}
