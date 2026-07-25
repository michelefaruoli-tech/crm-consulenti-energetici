/**
 * Converte "elenco plenitude nov.xlsx" → Excel caricabile in Archivio CRM.
 * Collaboratore = email nella colonna originale (match utenti CRM per email).
 *
 * Uso: npx tsx scripts/convert-plenitude-nov.ts
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const SRC = "C:/Users/miche/Desktop/elenco plenitude nov.xlsx";
const OUT_DIR = "C:/Users/miche/Desktop";
const OUT_NAME = "Plenitude-nov-CRM.xlsx";

const OUT_HEADERS = [
  "Nome",
  "Cognome",
  "Ragione sociale",
  "Telefono",
  "Tipo",
  "Fornitore",
  "POD/PDR",
  "Utility",
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
  if (typeof v === "object" && v !== null && "hyperlink" in v) {
    const h = v as { text?: string; hyperlink?: string };
    return h.text ?? h.hyperlink ?? null;
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
  return String(v).replace(/\u00a0/g, " ").trim();
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
  if (typeof v === "number" && Number.isFinite(v)) {
    // evita seriali Excel come "consumi"
    if (v > 20000 && v < 80000) return null;
    return v;
  }
  const s = String(v).replace(",", ".").replace(/[^\d.-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function mapTipo(rawTipo: string, companyHint: boolean): string {
  const t = rawTipo.toUpperCase();
  if (
    t.includes("BUSINESS") ||
    t.includes("AZIENDA") ||
    t === "BOX" ||
    t.includes("CORPORATE") ||
    t.includes("P/B") && t.includes("B")
  ) {
    return "AZIENDA";
  }
  if (!t && companyHint) return "AZIENDA";
  return "PRIVATO";
}

function looksLikeCompany(cognome: string, nome: string): boolean {
  if (nome) return false;
  const c = cognome.toUpperCase();
  return (
    /\b(SRL|SPA|S\.R\.L|S\.P\.A|SAS|SNC|SS|SERVICE|IMMOBILIARE|PRINT)\b/.test(c) ||
    c.includes(" SRL") ||
    c.includes(" SPA")
  );
}

/** POD vero vs etichetta luce/gas o codice corto. */
function parsePodField(rawPod: string): { pod: string; utility: string } {
  const t = rawPod.replace(/\s/g, "").trim();
  if (!t) return { pod: "", utility: "" };
  const up = t.toUpperCase();
  if (up === "LUCE" || up === "EE" || up === "ENERGIA") {
    return { pod: "", utility: "Luce" };
  }
  if (up === "GAS" || up === "METANO") {
    return { pod: "", utility: "Gas" };
  }
  // POD luce IT… o PDR numerico lungo
  if (/^IT[0-9A-Z]{10,}$/i.test(up) || /^\d{11,}$/.test(up) || up.length >= 12) {
    return { pod: up, utility: up.startsWith("IT") ? "Luce" : "" };
  }
  // valori tipo 108, 199 → non sono POD, li mettiamo in nota
  return { pod: "", utility: "" };
}

function parseProv(comm: unknown): {
  pagato: "Sì" | "No";
  dataPagamento: string;
  extraNote: string;
} {
  if (comm == null || comm === "" || comm === "-") {
    return { pagato: "No", dataPagamento: "", extraNote: "" };
  }
  const s = String(comm).trim();
  const low = s.toLowerCase();
  if (low === "ko" || low === "no" || low === "0") {
    return { pagato: "No", dataPagamento: "", extraNote: low === "ko" ? "Prov: KO" : "" };
  }
  const d = asDate(comm);
  if (d) return { pagato: "Sì", dataPagamento: formatDate(d), extraNote: "" };
  return { pagato: "No", dataPagamento: "", extraNote: `Prov: ${s}` };
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
    IREN: "Iren",
    EDISON: "Edison",
    SFERA: "Sfera",
  };
  return map[upper] ?? n;
}

function cleanEmail(v: unknown): string {
  const s = asText(v).toLowerCase();
  if (!s.includes("@")) return "";
  return s;
}

type ColMap = Record<string, number>;

function detectColumns(sheet: ExcelJS.Worksheet): { cols: ColMap; ignored: string[] } {
  const headers: string[] = [];
  sheet.getRow(1).eachCell((c, col) => {
    headers[col] = asText(raw(c)).toLowerCase();
  });

  const patterns: { key: string; names: string[] }[] = [
    { key: "cognome", names: ["cognome"] },
    { key: "nome", names: ["nome"] },
    { key: "telefono", names: ["tel", "telefono", "cellulare"] },
    { key: "pod", names: ["pod/pdr", "pod", "pdr"] },
    { key: "consumi", names: ["consumi", "consumo"] },
    { key: "inserito", names: ["inserito", "inserimento", "caricato"] },
    { key: "ingresso", names: ["ingresso", "esecutivo", "fornitura"] },
    { key: "tipo", names: ["p/b", "tipo", "tipologia"] },
    { key: "fornitore", names: ["fornitore"] },
    { key: "storno", names: ["storno"] },
    { key: "prov", names: ["prov", "provvigione", "commissioni"] },
    { key: "agenzia", names: ["agenzia"] },
    { key: "collaboratore", names: ["collaboratore", "agente", "email"] },
    { key: "note", names: ["note"] },
  ];

  const cols: ColMap = {};
  const used = new Set<number>();
  const ignored: string[] = [];

  for (const { key, names } of patterns) {
    cols[key] = -1;
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

  // Colonna 13 spesso = agenzia senza intestazione chiara
  if ((cols.agenzia ?? -1) < 0) {
    for (let i = 1; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = (headers[i] ?? "").trim();
      if (!h || h === "n") continue;
      // colonna vuota / spazi tra PROV e collaboratore
      if (!h.replace(/\s/g, "")) {
        cols.agenzia = i;
        used.add(i);
        break;
      }
    }
  }

  for (let i = 1; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    if (!used.has(i) && i <= 20) ignored.push(`${i}:${h}`);
  }

  return { cols, ignored };
}

function cellAt(row: ExcelJS.Row, col: number | undefined): unknown {
  if (!col || col < 1) return null;
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
  console.log("Colonne ignorate (prime):", ignored.slice(0, 15));

  // Se agenzia non trovata ma esiste colonna 13 tipica
  if ((cols.agenzia ?? -1) < 0) cols.agenzia = 13;

  const outWb = new ExcelJS.Workbook();
  const out = outWb.addWorksheet("Archivio");
  out.addRow([...OUT_HEADERS]);
  out.getRow(1).font = { bold: true };

  let written = 0;
  let skipped = 0;
  let paid = 0;
  let unpaid = 0;
  let withRealPod = 0;
  const emailCounts = new Map<string, number>();

  for (let r = 2; r <= src.rowCount; r++) {
    const row = src.getRow(r);
    const cognome = asText(cellAt(row, cols.cognome));
    const nome = asText(cellAt(row, cols.nome));
    const telefono = cleanPhone(cellAt(row, cols.telefono));
    const podRaw = asText(cellAt(row, cols.pod));
    const { pod, utility: utilFromPod } = parsePodField(podRaw);
    const consumi = asNumber(cellAt(row, cols.consumi));
    const inserito = asDate(cellAt(row, cols.inserito));
    const ingresso = asDate(cellAt(row, cols.ingresso));
    const tipoRaw = asText(cellAt(row, cols.tipo));
    const fornitore = normalizeSupplier(asText(cellAt(row, cols.fornitore)));
    const storno = asNumber(cellAt(row, cols.storno));
    const agenzia = asText(cellAt(row, cols.agenzia));
    const noteOrig = asText(cellAt(row, cols.note));
    const email = cleanEmail(cellAt(row, cols.collaboratore));
    const { pagato, dataPagamento, extraNote } = parseProv(cellAt(row, cols.prov));

    if (!cognome && !nome && !pod && !podRaw) {
      skipped++;
      continue;
    }

    const companyHint = looksLikeCompany(cognome, nome);
    const tipo = mapTipo(tipoRaw || (companyHint ? "BUSINESS" : "PRIVATO"), companyHint);
    const ragione =
      tipo === "AZIENDA"
        ? [cognome, nome].filter(Boolean).join(" ").trim() || cognome
        : "";

    const noteParts = [
      noteOrig,
      !pod && podRaw && !/^(luce|gas)$/i.test(podRaw)
        ? `POD grezzo: ${podRaw}`
        : "",
      asText(cellAt(row, cols.consumi)) && consumi == null
        ? `Consumi/testo: ${asText(cellAt(row, cols.consumi))}`
        : "",
      extraNote,
    ].filter(Boolean);

    if (pagato === "Sì") paid++;
    else unpaid++;
    if (pod) withRealPod++;
    if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);

    out.addRow([
      tipo === "PRIVATO" ? nome : "",
      tipo === "PRIVATO" ? cognome : "",
      ragione,
      telefono,
      tipo,
      fornitore,
      pod,
      utilFromPod,
      consumi ?? "",
      formatDate(inserito),
      formatDate(ingresso),
      storno != null && storno > 0 ? storno : "",
      pagato,
      dataPagamento,
      "",
      agenzia,
      email, // email collaboratore — il CRM la riconosce
      noteParts.join(" | ").slice(0, 800),
    ]);
    written++;
  }

  const widths = [14, 16, 28, 14, 10, 14, 18, 10, 10, 16, 20, 12, 10, 14, 10, 14, 28, 40];
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

  // anche in Download
  const dl = path.join("C:/Users/miche/Downloads", OUT_NAME);
  fs.copyFileSync(outPath, dl);

  console.log("\nOK — file unico:");
  console.log("→", outPath);
  console.log("→", dl);
  console.log({ written, skipped, paid, unpaid, withRealPod });
  console.log(
    "Collaboratori (email):",
    [...emailCounts.entries()].sort((a, b) => b[1] - a[1]),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
