import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { resolveBackofficeDestination } from "@/lib/backoffice-destination";

export const dynamic = "force-dynamic";

/**
 * GET ?supplierId=… → destinazione BO (dedicato vs solo Master) per avvisi UI.
 */
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "Non autenticato" }, { status: 401 });
  }

  const url = new URL(request.url);
  const supplierId = url.searchParams.get("supplierId")?.trim() || null;
  const dest = await resolveBackofficeDestination(supplierId);

  return NextResponse.json({
    ok: true,
    supplierId: dest.supplierId,
    supplierName: dest.supplierName,
    hasDedicatedBo: dest.hasDedicatedBo,
    recipients: dest.recipients,
    dedicatedEmails: dest.dedicatedEmails,
    adminEmail: dest.adminEmail,
    warning: dest.warning,
  });
}
