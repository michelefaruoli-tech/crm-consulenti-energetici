import { canonicalSupplierName } from "@/lib/supplier-merge";
import { normalizePersonKey } from "@/lib/helios-provvigioni-shared";

export type RankingItem = { label: string; count: number };

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Settimana ISO-like con lunedì come primo giorno. */
export function startOfWeekMonday(d: Date): Date {
  const day = startOfLocalDay(d);
  const dow = day.getDay();
  const diff = dow === 0 ? 6 : dow - 1;
  day.setDate(day.getDate() - diff);
  return day;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const UTILITY_LABELS: Record<string, string> = {
  LUCE: "Luce",
  GAS: "Gas",
  DUAL: "Dual (luce+gas)",
  TELEFONIA: "Fibra",
  FIBRA: "Fibra",
  POS: "POS",
  FOTOVOLTAICO: "Fotovoltaico",
  ALTRO: "Altro",
};

export function utilityTypeLabel(raw: string | null | undefined): string {
  const key = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!key) return "Altro";
  return UTILITY_LABELS[key] ?? key.charAt(0) + key.slice(1).toLowerCase();
}

export function aggregateSupplierRanking(
  rows: Array<{ supplierName: string }>,
  limit = 10,
): RankingItem[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = canonicalSupplierName(row.supplierName) || row.supplierName || "—";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "it"))
    .slice(0, limit);
}

export function aggregateUtilityRanking(
  rows: Array<{ utilityType: string | null }>,
): RankingItem[] {
  const order = ["Luce", "Gas", "Dual (luce+gas)", "Fibra", "POS", "Fotovoltaico", "Altro"];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = utilityTypeLabel(row.utilityType);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return order
    .filter((label) => (counts.get(label) ?? 0) > 0)
    .map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

const MICHELE_KEYS = new Set(["MICHELE", "MICHELE FARUOLI", "MORETTI MICHELE"]);

export function collaboratorAggregateKey(name: string): string {
  const key = normalizePersonKey(name);
  if (MICHELE_KEYS.has(key)) return "__MICHELE__";
  return key || name.trim().toUpperCase();
}

export function collaboratorDisplayName(name: string, key: string): string {
  if (key === "__MICHELE__") return "Michele Faruoli";
  return name.trim() || "—";
}

export function aggregateCollaboratorRanking(
  rows: Array<{ collaboratorId: string; collaboratorName: string; count: number }>,
  limit = 10,
): RankingItem[] {
  const merged = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const key = collaboratorAggregateKey(row.collaboratorName);
    const label = collaboratorDisplayName(row.collaboratorName, key);
    const prev = merged.get(key);
    merged.set(key, {
      label,
      count: (prev?.count ?? 0) + row.count,
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "it"))
    .slice(0, limit);
}
