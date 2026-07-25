/**
 * Converte "clienti UFFICIALE.xlsx" → Excel Archivio CRM.
 * Tutto assegnato a collaboratore Vizzino.
 * Unisce fogli RESIDENZIALI + BUSINESS (+ FOTOVOLTAICO se ha dati).
 *
 * Uso: npx tsx scripts/convert-clienti-ufficiale-vizzino.ts
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const SRC = "C:/Users/miche/Downloads/clienti UFFICIALE.xlsx";
const OUT_NAME = "Clienti-UFFICIALE-Vizzino-CRM.xlsx";
const COLLAB = "Vizzino";

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
  "Nome offerta",
  "Operazione",
  "Durata mesi",
  "Scadenza",
  "Note",
] as const;

function raw(c: ExcelJS.Cell): unknown {
  let v = c.value;
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "formula" in v && "result" in v) {
    return (v as { result?: unknown }).result ?? null;
  }
  if (typeof v === "object" && v !== null && "sharedFormula" in v && "result" in v) {
    return (v as { result?: unknown }).result ?? null;
  }
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
  const s = String(v).replace(/\u00a0/g, " ").trim();
  if (s === "/" || s === "-" || s === "#VALUE!" || s === "[object Object]") return "";
  return s;
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
  if (v == null || v === "" || v === "-" || v === "/") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "number") return excelSerialToDate(v);
  const s = String(v).trim();
  if (!s || s === "-" || s === "/") return null;
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
  if (v == null || v === "" || v === "-" || v === "/") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 20000 && v < 80000) return null; // serial date
    return v;
  }
  const s = String(v).replace(",", ".").replace(/[^\d.-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeSupplier(name: string): string {
  const n = name.trim();
  if (!n) return "Sconosciuto";
  const upper = n.toUpperCase();
  const map: Record<string, string> = {
    ENEL: "Enel",
    PLENITUDE: "Plenitude",
    ENI: "Plenitude",
    HELIOS: "Helios",
    DOLOMITI: "Dolomiti",
    A2A: "A2A",
    IREN: "Iren",
    EDISON: "Edison",
    ETRURIA: "Etruria",
    SORGENIA: "Sorgenia",
    SINERGY: "Sinergy",
    DUFERCO: "Duferco",
  };
  return map[upper] ?? n;
}

function normalizeUtility(t: string): string {
  const u = t.toUpperCase();
  if (u.includes("LUCE") || u === "EE") return "Luce";
  if (u.includes("GAS")) return "Gas";
  if (u.includes("FOTO") || u.includes("PV")) return "Fotovoltaico";
  return t;
}

function isRealPod(s: string): boolean {
  const t = s.replace(/\s/g, "").toUpperCase();
  if (!t || t === "/" || t === "-") return false;
  if (t === "LUCE" || t === "GAS") return false;
  if (/^IT[0-9A-Z]{10,}$/i.test(t)) return true;
  if (/^\d{11,}$/.test(t)) return true;
  return t.length >= 12;
}

function detectHeaders(sheet: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  const row = sheet.getRow(1);
  row.eachCell((c, col) => {
    const h = asText(raw(c)).toLowerCase();
    if (h) map.set(h, col);
  });
  return map;
}

function findCol(headers: Map<string, number>, ...names: string[]): number {
  for (const name of names) {
    for (const [h, col] of headers) {
      if (h === name) return col;
    }
  }
  for (const name of names) {
    for (const [h, col] of headers) {
      if (h.includes(name)) return col;
    }
  }
  return -1;
}

function cell(row: ExcelJS.Row, col: number): unknown {
  if (col < 1) return null;
  return raw(row.getCell(col));
}

type OutRow = (string | number)[];

function processSheet(
  sheet: ExcelJS.Worksheet,
  kind: "PRIVATO" | "AZIENDA" | "FOTO",
): { rows: OutRow[]; skipped: number } {
  const headers = detectHeaders(sheet);
  const col = {
    cognome: findCol(headers, "cognome"),
    nome: findCol(headers, "nome"),
    ragione: findCol(headers, "ragione sociale", "ragione"),
    telefono: findCol(headers, "telefono", "tel"),
    pod: findCol(headers, "pod/pdr", "pod", "pdr"),
    consumi: findCol(headers, "consumi", "consumo"),
    accettaz: findCol(headers, "data accettaz", "accettaz", "inserimento"),
    fornitura: findCol(headers, "data inizio fornitura", "inizio fornitura", "fornitura"),
    operazione: findCol(headers, "operazione"),
    fornitore: findCol(headers, "fornitore"),
    offerta: findCol(headers, "nome offerta", "offerta"),
    tipo: findCol(headers, "tipo"), // LUCE/GAS — attenzione non tipocliente
    durata: findCol(headers, "durata cte", "durata"),
    pcv: findCol(headers, "pcv"),
    prezzo: findCol(headers, "prezzo"),
    tipoPrezzo: findCol(headers, "tipo prezzo"),
    storno: findCol(headers, "storno"),
    rid: findCol(headers, "rid"),
    tipoCompenso: findCol(headers, "tipologia compenso"),
    compenso: findCol(headers, "compenso"),
    compensoIva: findCol(headers, "compenso dopo iva"),
    agenzia: findCol(headers, "agenzia"),
    collabs: findCol(headers, "collabs", "collaboratore"),
    firma: findCol(headers, "firma cte", "firma"),
    scadenza: findCol(headers, "scadenza cte", "scadenza"),
    liquidazione: findCol(
      headers,
      "data liquidazione una tantum",
      "liquidazione una tantum",
      "data liquidazione",
    ),
    liquidato: findCol(headers, "importo gia liquidato", "già liquidato", "gia liquidato"),
    residuo: findCol(headers, "residuo da liquidare"),
    mensile: findCol(headers, "compenso mensile"),
    tipoImpianto: findCol(headers, "tipo impianto"),
    caratteristiche: findCol(headers, "caratteristiche"),
    incentivo: findCol(headers, "incentivo"),
    importoSpeso: findCol(headers, "importo speso"),
    installazione: findCol(headers, "installazione"),
  };

  const rows: OutRow[] = [];
  let skipped = 0;

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cognome = asText(cell(row, col.cognome));
    const nome = asText(cell(row, col.nome));
    const ragione = asText(cell(row, col.ragione));
    const telefono = cleanPhone(cell(row, col.telefono));
    const podRaw = asText(cell(row, col.pod));
    const pod = isRealPod(podRaw) ? podRaw.replace(/\s/g, "").toUpperCase() : "";
    const consumi = asNumber(cell(row, col.consumi));
    const inserimento = asDate(cell(row, col.accettaz));
    const fornitura = asDate(cell(row, col.fornitura));
    const operazione = asText(cell(row, col.operazione));
    const fornitore = normalizeSupplier(asText(cell(row, col.fornitore)));
    const offerta = asText(cell(row, col.offerta));
    const utility = normalizeUtility(asText(cell(row, col.tipo)));
    const durata = asNumber(cell(row, col.durata));
    const storno = asNumber(cell(row, col.storno));
    const agenzia = asText(cell(row, col.agenzia));
    const collabs = asText(cell(row, col.collabs));
    const scadenza = asDate(cell(row, col.scadenza));
    const liquidazione = asDate(cell(row, col.liquidazione));
    const gettone =
      asNumber(cell(row, col.compensoIva)) ??
      asNumber(cell(row, col.compenso)) ??
      asNumber(cell(row, col.liquidato)) ??
      0;
    const liquidatoAmt = asNumber(cell(row, col.liquidato));
    const firma = asText(cell(row, col.firma));
    const rid = asText(cell(row, col.rid));
    const tipoCompenso = asText(cell(row, col.tipoCompenso));
    const pcv = asText(cell(row, col.pcv));
    const prezzo = asText(cell(row, col.prezzo));
    const tipoPrezzo = asText(cell(row, col.tipoPrezzo));

    // Foglio foto
    const tipoImpianto = asText(cell(row, col.tipoImpianto));
    const caratteristiche = asText(cell(row, col.caratteristiche));
    const incentivo = asText(cell(row, col.incentivo));
    const installazione = asText(cell(row, col.installazione));

    if (!cognome && !nome && !ragione && !pod) {
      skipped++;
      continue;
    }

    // Skip legend/footer junk
    if (
      cognome.toUpperCase().includes("LEGENDA") ||
      nome.toUpperCase().includes("LEGENDA")
    ) {
      skipped++;
      continue;
    }

    let tipoCliente: "PRIVATO" | "AZIENDA" =
      kind === "AZIENDA" || ragione ? "AZIENDA" : "PRIVATO";
    if (kind === "FOTO") tipoCliente = "PRIVATO";

    const ragioneOut =
      tipoCliente === "AZIENDA"
        ? ragione || [cognome, nome].filter(Boolean).join(" ").trim()
        : "";

    const pagato =
      liquidazione || (liquidatoAmt != null && liquidatoAmt > 0) || /^ok$/i.test(firma)
        ? "Sì"
        : "No";
    // Preferisci data liquidazione; se manca ma firmato/liquidato → usa inserimento
    const dataPagamento = formatDate(
      liquidazione ?? (pagato === "Sì" ? inserimento : null),
    );

    const noteParts = [
      tipoCompenso ? `Compenso: ${tipoCompenso}` : "",
      rid ? `RID: ${rid}` : "",
      pcv ? `PCV: ${pcv}` : "",
      prezzo ? `Prezzo: ${prezzo}` : "",
      tipoPrezzo ? `Tipo prezzo: ${tipoPrezzo}` : "",
      firma ? `Firma CTE: ${firma}` : "",
      collabs ? `Collab foglio: ${collabs}` : "",
      liquidatoAmt != null ? `Importo liquidato foglio: ${liquidatoAmt}` : "",
      !pod && podRaw ? `POD grezzo: ${podRaw}` : "",
      tipoImpianto ? `Impianto: ${tipoImpianto}` : "",
      caratteristiche ? `Caratteristiche: ${caratteristiche}` : "",
      incentivo ? `Incentivo: ${incentivo}` : "",
      installazione ? `Installazione: ${installazione}` : "",
      kind === "FOTO" ? "Origine: FOTOVOLTAICO" : "",
      kind === "AZIENDA" ? "Origine: CLIENTI BUSINESS" : "",
      kind === "PRIVATO" ? "Origine: CLIENTI RESIDENZIALI" : "",
    ].filter(Boolean);

    rows.push([
      tipoCliente === "PRIVATO" ? nome : "",
      tipoCliente === "PRIVATO" ? cognome : "",
      ragioneOut,
      telefono,
      tipoCliente,
      kind === "FOTO" ? fornitore || "Fotovoltaico" : fornitore,
      pod,
      kind === "FOTO" ? "Fotovoltaico" : utility,
      consumi ?? "",
      formatDate(inserimento),
      formatDate(fornitura),
      storno != null && storno > 0 ? storno : "",
      pagato,
      dataPagamento,
      gettone || "",
      agenzia,
      COLLAB,
      offerta || (kind === "FOTO" ? tipoImpianto : ""),
      operazione || (kind === "FOTO" ? "FOTOVOLTAICO" : ""),
      durata ?? "",
      formatDate(scadenza),
      noteParts.join(" | ").slice(0, 900),
    ]);
  }

  return { rows, skipped };
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`File non trovato: ${SRC}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);

  const outWb = new ExcelJS.Workbook();
  const out = outWb.addWorksheet("Archivio");
  out.addRow([...OUT_HEADERS]);
  out.getRow(1).font = { bold: true };

  let written = 0;
  let skipped = 0;
  let paid = 0;

  const sheets: { name: string; kind: "PRIVATO" | "AZIENDA" | "FOTO" }[] = [
    { name: "CLIENTI RESIDENZIALI", kind: "PRIVATO" },
    { name: "CLIENTI BUSINESS", kind: "AZIENDA" },
    { name: "FOTOVOLTAICO", kind: "FOTO" },
  ];

  for (const { name, kind } of sheets) {
    const sheet = wb.getWorksheet(name);
    if (!sheet) {
      console.warn("Foglio assente:", name);
      continue;
    }
    const { rows, skipped: sk } = processSheet(sheet, kind);
    skipped += sk;
    for (const row of rows) {
      out.addRow(row);
      written++;
      if (row[12] === "Sì") paid++;
    }
    console.log(`${name}: +${rows.length} (skip ${sk})`);
  }

  const widths = [
    14, 16, 28, 14, 10, 14, 18, 12, 10, 16, 20, 12, 10, 14, 10, 14, 14, 22, 18, 12, 14, 40,
  ];
  widths.forEach((w, i) => {
    out.getColumn(i + 1).width = w;
  });
  out.views = [{ state: "frozen", ySplit: 1 }];
  out.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: OUT_HEADERS.length },
  };

  const desktop = path.join("C:/Users/miche/Desktop", OUT_NAME);
  const downloads = path.join("C:/Users/miche/Downloads", OUT_NAME);
  const project = path.join(process.cwd(), "import", OUT_NAME);
  fs.mkdirSync(path.dirname(project), { recursive: true });
  await outWb.xlsx.writeFile(desktop);
  fs.copyFileSync(desktop, downloads);
  fs.copyFileSync(desktop, project);

  console.log("\nOK file unico →", desktop);
  console.log({ written, skipped, paid, unpaid: written - paid, collaboratore: COLLAB });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
