import fs from "fs";
import ExcelJS from "exceljs";

const FILE =
  "c:\\Users\\miche\\OneDrive\\utenze\\Inviti Helios\\Provvigioni_Luglio_2026_AG_MELFI_PZ4 - FARUOLI MICHELE.xlsx";

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  console.log("Sheets:", wb.worksheets.map((s) => s.name));
  for (const sheet of wb.worksheets) {
    console.log("\n===", sheet.name, "rows:", sheet.rowCount, "===");
    const headers: string[] = [];
    sheet.getRow(1).eachCell((c, col) => {
      headers[col] = String(c.value ?? "").trim();
    });
    console.log("Headers:", headers.filter(Boolean).slice(0, 12));
    for (let r = 2; r <= Math.min(5, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const vals: string[] = [];
      row.eachCell((c, col) => {
        vals[col] = String(c.value ?? "").slice(0, 40);
      });
      console.log("R" + r, vals.filter(Boolean).join(" | "));
    }
    if (/foglio2|luglio|2026-07/i.test(sheet.name)) {
      let posta = 0;
      let sum = 0;
      for (let r = 2; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r);
        const line = row.values as unknown[];
        const text = line.map((v) => String(v ?? "")).join(" ");
        if (/postaservice/i.test(text)) {
          posta++;
          const amt = Number(String(line[4] ?? "").replace(",", "."));
          if (Number.isFinite(amt)) sum += amt;
        }
      }
      console.log("postaservice rows (any col):", posta, "sum amt col4?", sum);
    }
  }
}

main().catch(console.error);
