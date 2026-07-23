import ExcelJS from "exceljs";

function cellVal(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v !== null) {
    if ("text" in v) return (v as { text?: string }).text ?? null;
    if ("result" in v) return (v as { result?: unknown }).result ?? null;
    if ("richText" in v) {
      return ((v as { richText: { text: string }[] }).richText ?? [])
        .map((t) => t.text)
        .join("");
    }
  }
  return v;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile("c:/Users/miche/OneDrive/BONUS BOOKMAKER/UTENZE APRILE 2026.xlsx");
  const sheet = wb.worksheets.find((s) => s.name.toUpperCase() === "UTENZE") ?? wb.worksheets[0];
  console.log("sheet", sheet.name, "dims", sheet.dimensions?.toString());

  // Dump first 20 rows, columns 1..40
  for (let r = 1; r <= 20; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= 45; c++) {
      const v = cellVal(row.getCell(c).value);
      if (v != null && String(v).trim() !== "") {
        cells.push(`${c}:${JSON.stringify(v)}`);
      }
    }
    if (cells.length) console.log(`R${r} ${cells.join(" | ")}`);
  }

  // Find a row that looks like headers (contains POD or Cognome or Cliente)
  console.log("\n--- searching header-like row ---");
  for (let r = 1; r <= 30; r++) {
    const row = sheet.getRow(r);
    const vals: string[] = [];
    for (let c = 1; c <= 60; c++) {
      const v = String(cellVal(row.getCell(c).value) ?? "").toLowerCase();
      if (v) vals.push(v);
    }
    const joined = vals.join(" ");
    if (
      joined.includes("pod") ||
      joined.includes("cognome") ||
      joined.includes("cliente") ||
      joined.includes("prov") ||
      joined.includes("fornitore") ||
      joined.includes("helios")
    ) {
      console.log(`CANDIDATE R${r}:`, vals.slice(0, 40).join(" || "));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
