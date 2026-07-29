"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { suggestPersonNameOrder } from "@/lib/italian-person-name";
import { writeAuditLog } from "@/lib/audit";

/**
 * Corregge clienti PRIVATO con Nome/Cognome invertiti
 * (euristica nomi IT + codice fiscale). Solo confidence high/medium.
 */
export async function fixSwappedClientNamesAction(): Promise<{
  ok: boolean;
  message: string;
  fixed: number;
  skipped: number;
}> {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.edit_all")) {
    return {
      ok: false,
      message: "Solo Master/Admin possono correggere i nomi in blocco.",
      fixed: 0,
      skipped: 0,
    };
  }

  const clients = await prisma.client.findMany({
    where: {
      deletedAt: null,
      type: "PRIVATO",
      firstName: { not: null },
      lastName: { not: null },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fiscalCode: true,
    },
  });

  let fixed = 0;
  let skipped = 0;

  for (const c of clients) {
    const suggestion = suggestPersonNameOrder(
      c.firstName,
      c.lastName,
      c.fiscalCode,
    );
    if (!suggestion.swapped) {
      skipped += 1;
      continue;
    }
    if (suggestion.confidence === "low") {
      skipped += 1;
      continue;
    }

    await prisma.client.update({
      where: { id: c.id },
      data: {
        firstName: suggestion.firstName,
        lastName: suggestion.lastName,
      },
    });
    await writeAuditLog({
      userId: session.id,
      action: "UPDATE",
      entity: "Client",
      entityId: c.id,
      details: {
        source: "fix_swapped_names",
        from: { firstName: c.firstName, lastName: c.lastName },
        to: {
          firstName: suggestion.firstName,
          lastName: suggestion.lastName,
        },
        reason: suggestion.reason,
        confidence: suggestion.confidence,
      },
    });
    fixed += 1;
  }

  revalidatePath("/clienti");
  revalidatePath("/contratti");
  revalidatePath("/provvigioni");

  return {
    ok: true,
    message: `Corretti ${fixed} clienti con nome/cognome invertiti (${skipped} lasciati invariati).`,
    fixed,
    skipped,
  };
}
