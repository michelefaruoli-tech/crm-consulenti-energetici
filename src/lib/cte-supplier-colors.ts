import { canonicalSupplierName } from "@/lib/supplier-names";

export type CteSupplierColorId =
  | "dolomiti"
  | "duferco"
  | "enel"
  | "iren"
  | "acea"
  | "plenitude"
  | "engie"
  | "other";

export type CteSupplierPalette = {
  id: CteSupplierColorId;
  /** Classi riga tabella (sfondo + bordo sinistro). */
  rowClass: string;
  /** Chip nome fornitore. */
  badgeClass: string;
  /** Sfondo riga nel PNG riepilogo. */
  fill: string;
  /** Bordo/accento. */
  accent: string;
  /** Testo su fill. */
  text: string;
};

const PALETTES: Record<CteSupplierColorId, CteSupplierPalette> = {
  dolomiti: {
    id: "dolomiti",
    rowClass: "border-l-4 border-l-sky-400 bg-sky-100 text-sky-950",
    badgeClass: "bg-sky-300 text-sky-950",
    fill: "#BAE6FD",
    accent: "#38BDF8",
    text: "#0C4A6E",
  },
  duferco: {
    id: "duferco",
    rowClass: "border-l-4 border-l-orange-300 bg-orange-100 text-orange-950",
    badgeClass: "bg-orange-200 text-orange-950",
    fill: "#FED7AA",
    accent: "#FB923C",
    text: "#7C2D12",
  },
  enel: {
    id: "enel",
    rowClass: "border-l-4 border-l-fuchsia-600 bg-fuchsia-200 text-fuchsia-950",
    badgeClass: "bg-fuchsia-500 text-white",
    fill: "#F0ABFC",
    accent: "#E6007E",
    text: "#4A044E",
  },
  iren: {
    id: "iren",
    rowClass: "border-l-4 border-l-orange-800 bg-orange-300 text-orange-950",
    badgeClass: "bg-orange-700 text-white",
    fill: "#FDBA74",
    accent: "#C2410C",
    text: "#431407",
  },
  acea: {
    id: "acea",
    rowClass: "border-l-4 border-l-teal-400 bg-teal-100 text-teal-950",
    badgeClass: "bg-teal-400 text-teal-950",
    fill: "#5EEAD4",
    accent: "#0D9488",
    text: "#134E4A",
  },
  plenitude: {
    id: "plenitude",
    rowClass: "border-l-4 border-l-lime-400 bg-lime-100 text-lime-950",
    badgeClass: "bg-lime-300 text-lime-950",
    fill: "#BEF264",
    accent: "#65A30D",
    text: "#1A2E05",
  },
  engie: {
    id: "engie",
    rowClass: "border-l-4 border-l-cyan-300 bg-cyan-100 text-cyan-950",
    badgeClass: "bg-cyan-200 text-cyan-950",
    fill: "#A5F3FC",
    accent: "#22D3EE",
    text: "#164E63",
  },
  other: {
    id: "other",
    rowClass: "border-l-4 border-l-slate-300 bg-slate-50 text-slate-900",
    badgeClass: "bg-slate-200 text-slate-800",
    fill: "#F1F5F9",
    accent: "#94A3B8",
    text: "#0F172A",
  },
};

export function cteSupplierColorId(name: string | null | undefined): CteSupplierColorId {
  const raw = String(name ?? "").trim();
  if (!raw) return "other";
  const canon = canonicalSupplierName(raw);
  const key = `${canon} ${raw}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (key.includes("dolomiti")) return "dolomiti";
  if (key.includes("duferco")) return "duferco";
  if (key.includes("enel")) return "enel";
  if (key.includes("iren")) return "iren";
  if (key.includes("acea")) return "acea";
  if (key.includes("plenitude") || (key.includes("eni") && key.includes("pleni"))) {
    return "plenitude";
  }
  if (key.includes("engie")) return "engie";
  return "other";
}

export function cteSupplierPalette(name: string | null | undefined): CteSupplierPalette {
  return PALETTES[cteSupplierColorId(name)];
}

export function cteSupplierRowClass(
  name: string | null | undefined,
  applicable: boolean,
): string {
  const base = cteSupplierPalette(name).rowClass;
  return applicable ? base : `${base} opacity-55`;
}
