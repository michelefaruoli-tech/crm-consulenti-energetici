/**
 * Converte UT GEN 2026.xlsx nel formato atteso dall'import Archivio CRM.
 * Tutti i contratti → collaboratore "Vito Postaservice".
 * Esclude colonne spurie (password, URL, ecc.).
 *
 * Uso:
 *   npx tsx scripts/convert-ut-gen-vito.ts
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const SRC = "C:/Users/miche/Downloads/UT GEN 2026.xlsx";
const OUT_DIR = "C:/Users/miche/Downloads";
const OUT_NAME = "UT-GEN-2026-Vito-Postaservice-CRM.xlsx";
const COLLAB = "Vito Postaservice";

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
  // Solo se sembra un telefono (almeno 6 cifre)
  const digits = s.replace(/\D/g, "");
  if (digits.length < 6) return "";
  return s;
}

function mapTipo(rawTipo: string, hasCompanyHint: boolean): string {
  const t = rawTipo.toUpperCase();
  if (t.includes("BUSINESS") || t.includes("AZIENDA") || t === "BOX" || t.includes("COORPORATE") || t.includes("CORPORATE")) {
    return "AZIENDA";
  }
  if (!t && hasCompanyHint) return "AZIENDA";
  return "PRIVATO";
}

function parsePagamento(comm: unknown): { pagato: "Sì" | "No"; dataPagamento: string } {
  if (comm == null || comm === "" || comm === "-") {
    return { pagato: "No", dataPagamento: "" };
  }
  const s = String(comm).trim().toLowerCase();
  if (s.includes("ko") || s === "0") {
    return { pagato: "No", dataPagamento: "" };
  }
  const d = asDate(comm);
  if (d) {
    return { pagato: "Sì", dataPagamento: formatDate(d) };
  }
  // es. "1 rata" senza data → considerato non liquidato chiaramente
  return { pagato: "No", dataPagamento: "" };
}

function normalizeSupplier(name: string): string {
  const n = name.trim();
  if (!n) return "Sconosciuto";
  const upper = n.toUpperCase();
  // Uniforma casing tipici
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

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`File non trovato: ${SRC}`);
  }

  const srcWb = new ExcelJS.Workbook();
  await srcWb.xlsx.readFile(SRC);
  const src = srcWb.worksheets[0];
  if (!src) throw new Error("Foglio vuoto");

  const outWb = new ExcelJS.Workbook();
  const out = outWb.addWorksheet("Archivio");

  const headers = [
    "Nome",
    "Cognome",
    "Ragione sociale",
    "Telefono",
    "Tipo",
    "Fornitore",
    "POD/PDR",
    "Data inserimento",
    "Data ingresso fornitura",
    "Pagamento",
    "Data pagamento",
    "Gettone",
    "Collaboratore",
    "Note",
  ];
  out.addRow(headers);
  out.getRow(1).font = { bold: true };

  let written = 0;
  let skipped = 0;
  let paid = 0;
  let unpaid = 0;

  for (let r = 2; r <= src.rowCount; r++) {
    const row = src.getRow(r);
    const cognome = asText(raw(row.getCell(2)));
    const nome = asText(raw(row.getCell(3)));
    const telefono = cleanPhone(raw(row.getCell(4)));
    const pod = asText(raw(row.getCell(5)));
    const caricato = asDate(raw(row.getCell(7)));
    const esecutivo = asDate(raw(row.getCell(8)));
    const tipoRaw = asText(raw(row.getCell(9)));
    const fornitore = normalizeSupplier(asText(raw(row.getCell(10))));
    const noteParts = [
      asText(raw(row.getCell(14))),
      asText(raw(row.getCell(15))),
      asText(raw(row.getCell(13))) ? `Agenzia: ${asText(raw(row.getCell(13)))}` : "",
    ].filter(Boolean);
    const { pagato, dataPagamento } = parsePagamento(raw(row.getCell(12)));

    if (!cognome && !nome && !pod) {
      skipped++;
      continue;
    }

    const tipo = mapTipo(tipoRaw, false);
    // BUSINESS senza ragione → usa Nome+Cognome come ragione sociale
    const ragione =
      tipo === "AZIENDA" ? [nome, cognome].filter(Boolean).join(" ").trim() : "";

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
      formatDate(caricato),
      formatDate(esecutivo),
      pagato,
      dataPagamento,
      "", // gettone assente nel file originale
      COLLAB,
      noteParts.join(" | ").slice(0, 500),
    ]);
    written++;
  }

  // Larghezze colonne leggibili
  const widths = [14, 16, 28, 14, 10, 14, 18, 16, 20, 10, 14, 10, 22, 40];
  widths.forEach((w, i) => {
    out.getColumn(i + 1).width = w;
  });

  const outPath = path.join(OUT_DIR, OUT_NAME);
  await outWb.xlsx.writeFile(outPath);

  // Copia anche in import/ del progetto
  const projectDir = path.join(process.cwd(), "import");
  fs.mkdirSync(projectDir, { recursive: true });
  const projectOut = path.join(projectDir, OUT_NAME);
  fs.copyFileSync(outPath, projectOut);

  // Spezza in pezzi da 250 righe (upload più stabile su Vercel)
  const CHUNK = 250;
  const dataRows = out.rowCount - 1;
  const parts: string[] = [];
  let part = 1;
  for (let start = 2; start <= out.rowCount; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, out.rowCount);
    const partWb = new ExcelJS.Workbook();
    const partSheet = partWb.addWorksheet("Archivio");
    partSheet.addRow(headers);
    partSheet.getRow(1).font = { bold: true };
    for (let r = start; r <= end; r++) {
      const values = out.getRow(r).values;
      // ExcelJS values is 1-indexed array
      const arr = Array.isArray(values) ? values.slice(1) : [];
      partSheet.addRow(arr);
    }
    widths.forEach((w, i) => {
      partSheet.getColumn(i + 1).width = w;
    });
    const partName = `UT-GEN-2026-Vito-parte${part}.xlsx`;
    const partPath = path.join(OUT_DIR, partName);
    await partWb.xlsx.writeFile(partPath);
    fs.copyFileSync(partPath, path.join(projectDir, partName));
    parts.push(partPath);
    part++;
  }

  console.log("OK convertito");
  console.log("→ completo:", outPath);
  console.log("→ pezzi:", parts);
  console.log({ written, skipped, paid, unpaid, collaboratore: COLLAB, dataRows });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
