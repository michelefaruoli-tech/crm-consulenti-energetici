/** Somma voci una tantum del listino (il mensile resta a parte). */
export function sumUnaTantumGettoni(parts: {
  gettoneBase?: number | null;
  gettoneRid?: number | null;
  gettoneBollettaWeb?: number | null;
  gettoneMail?: number | null;
  gettoneUnaTantumIniziale?: number | null;
}): number {
  const n = (v: number | null | undefined) =>
    v != null && Number.isFinite(v) ? Number(v) : 0;
  return (
    n(parts.gettoneBase) +
    n(parts.gettoneRid) +
    n(parts.gettoneBollettaWeb) +
    n(parts.gettoneMail) +
    n(parts.gettoneUnaTantumIniziale)
  );
}

export function formatListinoTotale(opts: {
  unaTantum: number;
  mensile?: number | null;
}): string {
  const ut = opts.unaTantum;
  const m = opts.mensile != null && opts.mensile > 0 ? opts.mensile : 0;
  if (ut > 0 && m > 0) return `${ut.toFixed(2)} € + ${m.toFixed(2)} €/mese`;
  if (m > 0) return `${m.toFixed(2)} €/mese`;
  if (ut > 0) return `${ut.toFixed(2)} €`;
  return "—";
}

export function parseMoney(raw: string): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export const CLIENT_SEGMENT_LABELS: Record<string, string> = {
  TUTTI: "Tutti",
  PRIVATO: "Privato",
  BUSINESS: "Business",
};
