/**
 * Converte UT GEN 2026.xlsx → UN solo Excel caricabile in Archivio CRM.
 *
 * Riconosce (per nome colonna, non per posizione):
 *   nome, cognome, telefono, pod/pdr, consumi, caricato/inserimento,
 *   esecutivo/fornitura, tipo, fornitore, storno, commissioni (data pagamento),
 *   agenzia, note, prezzo…
 * Ignora tutto il resto (N, password, URL, colonne vuote…).
 *
 * Collaboratore fisso: Vito Postaservice
 *
 * Uso: npx tsx scripts/convert-ut-gen-vito.ts
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const SRC = "C:/Users/miche/Downloads/UT GEN 2026.xlsx";
const OUT_DIR = "C:/Users/miche/Downloads";
const OUT_NAME = "UT-GEN-2026-Vito-Postaservice-CRM.xlsx";
const COLLAB = "Vito Postaservice";

/** Colonne CRM in uscita (ordine fisso, intestazioni riconosciute dall'import). */
const OUT_HEADERS = [
  "Nome",
  "Cognome",
  "Ragione sociale",
  "Telefono",
  "Tipo",
  "Fornitore",
  "POD/PDR",
  "Consumi",
  "Data inserimento",
  "Data ingresso fornitura",
  "Mesi storno",
  "Pagamento",
  "Data pagamento",
  "Gettone",
  "Agenzia",
  "Collaboratore",
  "Note",
] as const;

function raw(c: ExcelJS.Cell): unknown {
  let v = c.value;
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "text" in v) {
    return (v as { text?: string }).text ?? null;
  }
  if (typeof v === "object" && v !== null && "result" in v) {
    return (v as { result?: unknown }).result ?? null;
  }
  if (typeof v === "object" && v !== null && "richText" in v) {
    return ((v as { richText: { text: string }[] }).richText ?? [])
      .map((t) => t.text)
      .join("");
  }
  return v;
}

function asText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return "";
  return String(v).trim();
}

function excelSerialToDate(n: number): Date | null {
  if (n > 20000 && n < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(n));
    return epoch;
  }
  return null;
}

function asDate(v: unknown): Date | null {
  if (v == null || v === "" || v === "-") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "number") return excelSerialToDate(v);
  const s = String(v).trim();
  if (!s || s === "-" || /^ko$/i.test(s)) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = excelSerialToDate(Number(s));
    if (d) return d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date | null): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cleanPhone(v: unknown): string {
  const s = asText(v);
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length < 6) return "";
  return s;
}

function asNumber(v: unknown): number | null {
  if (v == null || v === "" || v === "-") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(",", ".").replace(/[^\d.-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function mapTipo(rawTipo: string): string {
  const t = rawTipo.toUpperCase();
  if (
    t.includes("BUSINESS") ||
    t.includes("AZIENDA") ||
    t === "BOX" ||
    t.includes("COORPORATE") ||
    t.includes("CORPORATE")
  ) {
    return "AZIENDA";
  }
  return "PRIVATO";
}

/** COMMISSIONI: se è una data → pagato quel giorno; ko/vuoto → no. */
function parseCommissioni(comm: unknown): {
  pagato: "Sì" | "No";
  dataPagamento: string;
  extraNote: string;
} {
  if (comm == null || comm === "" || comm === "-") {
    return { pagato: "No", dataPagamento: "", extraNote: "" };
  }
  const s = String(comm).trim();
  const low = s.toLowerCase();
  if (low.includes("ko")) {
    return { pagato: "No", dataPagamento: "", extraNote: "Commissioni: KO" };
  }
  const d = asDate(comm);
  if (d) {
    return { pagato: "Sì", dataPagamento: formatDate(d), extraNote: "" };
  }
  return { pagato: "No", dataPagamento: "", extraNote: `Commissioni: ${s}` };
}

function normalizeSupplier(name: string): string {
  const n = name.trim();
  if (!n) return "Sconosciuto";
  const upper = n.toUpperCase();
  const map: Record<string, string> = {
    ENEL: "Enel",
    PLENITUDE: "Plenitude",
    HELIOS: "Helios",
    DUFERCO: "Duferco",
    DOLOMITI: "Dolomiti",
    SINERGY: "Sinergy",
    ETRURIA: "Etruria",
    SORGENIA: "Sorgenia",
    A2A: "A2A",
    ATS: "ATS",
    IREN: "Iren",
    EDISON: "Edison",
    FIBRA: "Fibra",
    VIVIENERGIA: "Vivienergia",
    "ENEL BOX": "Enel Box",
    SFERA: "Sfera",
    AXPO: "Axpo",
    FUTURENERGY: "Futurenergy",
    POS: "POS",
  };
  return map[upper] ?? n;
}

type ColMap = {
  nome: number;
  cognome: number;
  telefono: number;
  pod: number;
  consumi: number;
  caricato: number;
  esecutivo: number;
  tipo: number;
  fornitore: number;
  storno: number;
  commissioni: number;
  agenzia: number;
  note: number;
  prezzo: number;
};

/** Mappa intestazioni riga 1 → indici colonna (1-based). Ignora voci sconosciute. */
function detectColumns(sheet: ExcelJS.Worksheet): { cols: ColMap; ignored: string[] } {
  const headers: string[] = [];
  sheet.getRow(1).eachCell((c, col) => {
    headers[col] = asText(raw(c)).toLowerCase();
  });

  const ignored: string[] = [];
  const knownPatterns: { key: keyof ColMap; names: string[] }[] = [
    { key: "cognome", names: ["cognome"] },
    { key: "nome", names: ["nome"] },
    { key: "telefono", names: ["telefono", "cellulare", "phone"] },
    { key: "pod", names: ["pod/pdr", "pod", "pdr"] },
    { key: "consumi", names: ["consumi", "consumo", "kwh", "smc"] },
    { key: "caricato", names: ["caricato", "inserimento", "data inserimento"] },
    { key: "esecutivo", names: ["esecutivo", "fornitura", "ingresso"] },
    { key: "tipo", names: ["tipo", "tipologia"] },
    { key: "fornitore", names: ["fornitore", "supplier"] },
    { key: "storno", names: ["storno"] },
    { key: "commissioni", names: ["commissioni", "commissione"] },
    { key: "agenzia", names: ["agenzia"] },
    { key: "note", names: ["note"] },
    { key: "prezzo", names: ["prezzzo", "prezzo"] },
  ];

  const cols: ColMap = {
    nome: -1,
    cognome: -1,
    telefono: -1,
    pod: -1,
    consumi: -1,
    caricato: -1,
    esecutivo: -1,
    tipo: -1,
    fornitore: -1,
    storno: -1,
    commissioni: -1,
    agenzia: -1,
    note: -1,
    prezzo: -1,
  };

  const used = new Set<number>();

  for (const { key, names } of knownPatterns) {
    // match esatto
    for (const name of names) {
      for (let i = 1; i < headers.length; i++) {
        if (used.has(i)) continue;
        if ((headers[i] ?? "") === name) {
          cols[key] = i;
          used.add(i);
          break;
        }
      }
      if (cols[key] > 0) break;
    }
    if (cols[key] > 0) continue;
    // includes (evita che "nome" prenda "cognome")
    for (const name of names) {
      for (let i = 1; i < headers.length; i++) {
        if (used.has(i)) continue;
        const h = headers[i] ?? "";
        if (!h) continue;
        if (key === "nome" && h.includes("cognome")) continue;
        if (h.includes(name)) {
          cols[key] = i;
          used.add(i);
          break;
        }
      }
      if (cols[key] > 0) break;
    }
  }

  for (let i = 1; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    if (!used.has(i)) ignored.push(`${i}:${h}`);
  }

  return { cols, ignored };
}

function cellAt(row: ExcelJS.Row, col: number): unknown {
  if (col < 1) return null;
  return raw(row.getCell(col));
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`File non trovato: ${SRC}`);

  const srcWb = new ExcelJS.Workbook();
  await srcWb.xlsx.readFile(SRC);
  const src = srcWb.worksheets[0];
  if (!src) throw new Error("Foglio vuoto");

  const { cols, ignored } = detectColumns(src);
  console.log("Colonne riconosciute:", cols);
  console.log("Colonne ignorate:", ignored);

  const outWb = new ExcelJS.Workbook();
  const out = outWb.addWorksheet("Archivio");
  out.addRow([...OUT_HEADERS]);
  out.getRow(1).font = { bold: true };

  let written = 0;
  let skipped = 0;
  let paid = 0;
  let unpaid = 0;

  for (let r = 2; r <= src.rowCount; r++) {
    const row = src.getRow(r);
    const cognome = asText(cellAt(row, cols.cognome));
    const nome = asText(cellAt(row, cols.nome));
    const telefono = cleanPhone(cellAt(row, cols.telefono));
    const pod = asText(cellAt(row, cols.pod));
    const consumi = asNumber(cellAt(row, cols.consumi));
    const caricato = asDate(cellAt(row, cols.caricato));
    const esecutivo = asDate(cellAt(row, cols.esecutivo));
    const tipoRaw = asText(cellAt(row, cols.tipo));
    const fornitore = normalizeSupplier(asText(cellAt(row, cols.fornitore)));
    const storno = asNumber(cellAt(row, cols.storno));
    const agenzia = asText(cellAt(row, cols.agenzia));
    const noteOrig = asText(cellAt(row, cols.note));
    const prezzo = asText(cellAt(row, cols.prezzo));
    const { pagato, dataPagamento, extraNote } = parseCommissioni(
      cellAt(row, cols.commissioni),
    );

    if (!cognome && !nome && !pod) {
      skipped++;
      continue;
    }

    const tipo = mapTipo(tipoRaw);
    const ragione =
      tipo === "AZIENDA" ? [nome, cognome].filter(Boolean).join(" ").trim() : "";

    const noteParts = [
      noteOrig,
      prezzo ? `Prezzo/condizioni: ${prezzo}` : "",
      extraNote,
    ].filter(Boolean);

    if (pagato === "Sì") paid++;
    else unpaid++;

    out.addRow([
      tipo === "PRIVATO" ? nome : "",
      tipo === "PRIVATO" ? cognome : "",
      ragione,
      telefono,
      tipo,
      fornitore,
      pod,
      consumi ?? "",
      formatDate(caricato),
      formatDate(esecutivo),
      storno != null && storno > 0 ? storno : "",
      pagato,
      dataPagamento,
      "", // gettone non presente nel file
      agenzia,
      COLLAB,
      noteParts.join(" | ").slice(0, 800),
    ]);
    written++;
  }

  const widths = [14, 16, 28, 14, 10, 14, 18, 10, 16, 20, 12, 10, 14, 10, 16, 22, 40];
  widths.forEach((w, i) => {
    out.getColumn(i + 1).width = w;
  });
  out.views = [{ state: "frozen", ySplit: 1 }];
  out.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: OUT_HEADERS.length },
  };

  const outPath = path.join(OUT_DIR, OUT_NAME);
  await outWb.xlsx.writeFile(outPath);

  const projectDir = path.join(process.cwd(), "import");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.copyFileSync(outPath, path.join(projectDir, OUT_NAME));

  console.log("\nOK — UN solo file:");
  console.log("→", outPath);
  console.log({ written, skipped, paid, unpaid, collaboratore: COLLAB });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
