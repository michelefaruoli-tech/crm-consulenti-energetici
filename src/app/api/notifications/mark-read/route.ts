import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import {
  markAllAppNotificationsRead,
  markAppNotificationRead,
} from "@/lib/app-notifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    all?: boolean;
  } | null;

  if (body?.all === true) {
    const updated = await markAllAppNotificationsRead(session.id);
    return NextResponse.json({ ok: true, updated });
  }

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { error: "Specifica id o all=true" },
      { status: 400 },
    );
  }

  const ok = await markAppNotificationRead(session.id, id);
  if (!ok) {
    return NextResponse.json({ error: "Notifica non trovata" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
