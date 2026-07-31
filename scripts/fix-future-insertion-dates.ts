/**
 * Corregge inserimenti futuri / inserimento=fornitura su Switch.
 *
 * Regola:
 * - Per Switch: data inserimento ≠ data fornitura
 * - Si conserva la data fornitura già segnata
 * - Si sposta l’inserimento a una data coerente (di solito createdAt o 1° del mese prima)
 *
 * Uso:
 *   npx tsx scripts/fix-future-insertion-dates.ts --dry
 *   npx tsx scripts/fix-future-insertion-dates.ts
 */
import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  computeSupplyStartDate,
  normalizeOperationType,
} from "../src/lib/supply-dates";
import { clientDisplayName } from "../src/lib/utils";

const DRY = process.argv.includes("--dry");
/** Oggi operativo (31 luglio 2026) — non usiamo Date() del server se diverso */
const TODAY = new Date(2026, 6, 31); // 31/07/2026 local

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

function ymd(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function asLocalDate(d: Date): Date {
  // Interpreta la data “di calendario” (ignora ora UTC) come mezzanotte locale
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Trova una data inserimento (locale) tale che computeSupplyStartDate(ins, CAMBIO) = supply.
 * Preferisce preferred se già coerente e non futura rispetto a TODAY.
 */
function fixSwitchInsertion(supply: Date, preferred: Date): Date {
  const supplyLocal = asLocalDate(supply);
  const prefLocal = asLocalDate(preferred);

  const tryDate = (d: Date): boolean =>
    ymd(computeSupplyStartDate(d, "CAMBIO")) === ymd(supplyLocal);

  // 1) preferred (createdAt) se non futuro e produce la supply giusta
  if (prefLocal.getTime() <= TODAY.getTime() && tryDate(prefLocal)) {
    return prefLocal;
  }

  // 2) TODAY se produce la supply giusta
  if (tryDate(TODAY)) return TODAY;

  // 3) 1° del mese precedente alla fornitura (giorno 1 < 8 → fornitura = 1° mese dopo)
  const m1 = new Date(
    supplyLocal.getFullYear(),
    supplyLocal.getMonth() - 1,
    1,
  );
  if (tryDate(m1) && m1.getTime() <= TODAY.getTime()) return m1;

  // 4) giorno 7 del mese precedente
  const m1d7 = new Date(
    supplyLocal.getFullYear(),
    supplyLocal.getMonth() - 1,
    7,
  );
  if (tryDate(m1d7) && m1d7.getTime() <= TODAY.getTime()) return m1d7;

  // 5) giorno 8 del mese M-2 (→ fornitura 1° di M)
  const m2d8 = new Date(
    supplyLocal.getFullYear(),
    supplyLocal.getMonth() - 2,
    8,
  );
  if (tryDate(m2d8) && m2d8.getTime() <= TODAY.getTime()) return m2d8;

  // 6) fallback: 1° mese precedente anche se “futuro” non dovrebbe
  return m1;
}

async function main() {
  // Tutti gli attivi con insertionDate valorizzata (ampio)
  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
    },
    select: {
      id: true,
      contractNumber: true,
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      createdAt: true,
      client: true,
      supplier: { select: { name: true } },
      collaborator: { select: { name: true } },
    },
  });

  console.log("Contratti attivi totali:", contracts.length);

  type Fix = {
    id: string;
    contractNumber: string;
    name: string;
    op: string;
    oldIns: string;
    newIns: string;
    supply: string;
    reason: string;
  };
  const fixes: Fix[] = [];

  for (const c of contracts) {
    if (!c.insertionDate) continue;
    const op = normalizeOperationType(c.operationType);
    const ins = asLocalDate(c.insertionDate);
    const supply = c.supplyStartDate
      ? asLocalDate(c.supplyStartDate)
      : null;
    const insY = ymd(ins);
    const supplyY = supply ? ymd(supply) : null;

    const insertionInFuture = ins.getTime() > TODAY.getTime();
    const sameAsSupply = supplyY != null && insY === supplyY;
    const isVolturaOrAtt = op === "VOLTURA" || op === "ATTIVAZIONE";

    // Problema: inserimento futuro, oppure Switch con inserimento=fornitura
    const needsFix =
      insertionInFuture || (sameAsSupply && !isVolturaOrAtt);

    if (!needsFix) continue;

    // Conserva fornitura segnata; se manca, calcolala dopo aver sistemato inserimento
    let keepSupply = supply;
    let newIns: Date;
    let reason: string;

    if (op === "CAMBIO") {
      // La data fornitura “segnata” è quella da conservare.
      // Se insertion=supply (es. entrambi 01/09), quella data È la fornitura.
      const targetSupply = keepSupply ?? ins;
      keepSupply = targetSupply;
      newIns = fixSwitchInsertion(targetSupply, c.createdAt);
      reason = insertionInFuture
        ? "inserimento futuro (Switch): sposto inserimento, tengo fornitura"
        : "Switch con inserimento=fornitura: sposto inserimento";
    } else {
      // Voltura/Attivazione: possono avere date vicine; se inserimento futuro,
      // usa createdAt e ricalcola fornitura = +7 giorni
      newIns = asLocalDate(
        c.createdAt.getTime() <= TODAY.getTime() ? c.createdAt : TODAY,
      );
      keepSupply = computeSupplyStartDate(newIns, op);
      reason = "inserimento futuro (Voltura/Attivazione): riallineo da createdAt";
    }

    // Verifica Switch: newIns non deve coincidere con supply
    if (op === "CAMBIO" && keepSupply && ymd(newIns) === ymd(keepSupply)) {
      // spingi indietro di un giorno
      newIns = new Date(
        newIns.getFullYear(),
        newIns.getMonth(),
        newIns.getDate() - 1,
      );
      // e ricalcola se serve per matchare supply — meglio forzare formula
      newIns = fixSwitchInsertion(keepSupply, newIns);
    }

    fixes.push({
      id: c.id,
      contractNumber: c.contractNumber,
      name: clientDisplayName(c.client),
      op,
      oldIns: insY,
      newIns: ymd(newIns),
      supply: keepSupply ? ymd(keepSupply) : "—",
      reason,
    });

    if (!DRY) {
      await prisma.contract.update({
        where: { id: c.id },
        data: {
          insertionDate: newIns,
          supplyStartDate: keepSupply,
        },
      });
    }
  }

  console.log(DRY ? "DRY RUN" : "APPLY", "fixes:", fixes.length);
  for (const f of fixes) {
    console.log(
      f.contractNumber,
      "|",
      f.name,
      "|",
      f.op,
      "| ins",
      f.oldIns,
      "→",
      f.newIns,
      "| supply",
      f.supply,
      "|",
      f.reason,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
