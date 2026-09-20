import { cteSupplierPalette } from "@/lib/cte-supplier-colors";
import type { CteSummaryOffer, CteSummaryPayload } from "@/lib/cte-summary-types";

const COLS = [
  { key: "name", label: "NOME CTE", w: 280 },
  { key: "power", label: "POTENZA", w: 130 },
  { key: "cons", label: "CONSUMO ANNUO", w: 170 },
  { key: "f1", label: "PREZZO F1 / MONO", w: 160 },
  { key: "f2", label: "PREZZO F2", w: 120 },
  { key: "f3", label: "PREZZO F3", w: 120 },
  { key: "ccv", label: "QUOTA FISSA", w: 140 },
  { key: "seg", label: "SEGMENTO", w: 140 },
  { key: "scad", label: "SCADENZA", w: 120 },
] as const;

const PAD = 28;
const HEADER_H = 108;
const SECTION_H = 36;
const ROW_H = 34;
const COL_H = 32;
const TABLE_W = COLS.reduce((s, c) => s + c.w, 0);

function itNum(n: number, digits: number): string {
  return n.toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function priceCell(row: CteSummaryOffer, band: "f1" | "f2" | "f3"): string {
  const unit = row.utility === "GAS" ? "€/Smc" : "€/kWh";
  if (row.priceKind === "VARIABILE") {
    if (band !== "f1") return "—";
    const idx = row.utility === "GAS" ? "PSV" : "PUN";
    if (row.spread == null) return idx;
    if (row.spread === 0) return idx;
    return `${idx} + ${itNum(row.spread, 4)} ${unit}`;
  }
  const v = band === "f1" ? row.priceF1 : band === "f2" ? row.priceF2 : row.priceF3;
  if (v == null) return "—";
  return `${itNum(v, 4)} ${unit}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  roundRect(ctx, x, y, 56, 56, 12);
  ctx.fillStyle = "#10B981";
  ctx.fill();
  ctx.strokeStyle = "#059669";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ECFDF5";
  ctx.beginPath();
  ctx.moveTo(x + 30, y + 10);
  ctx.lineTo(x + 18, y + 30);
  ctx.lineTo(x + 28, y + 30);
  ctx.lineTo(x + 24, y + 46);
  ctx.lineTo(x + 40, y + 24);
  ctx.lineTo(x + 29, y + 24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#0F172A";
  ctx.font = "700 22px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("CRM Energia", x + 68, y + 22);
  ctx.font = "500 13px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#64748B";
  ctx.fillText("Catalogo CTE · consulenti energetici", x + 68, y + 44);
}

export function renderCteSummaryCanvas(payload: CteSummaryPayload): HTMLCanvasElement {
  const sections = payload.sections.filter((s) => s.rows.length > 0);
  const bodyH = sections.reduce(
    (h, s) => h + SECTION_H + COL_H + s.rows.length * ROW_H + 18,
    0,
  );
  const width = PAD * 2 + TABLE_W;
  const height = PAD + HEADER_H + bodyH + PAD + 24;
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non disponibile");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);

  drawLogo(ctx, PAD, PAD);

  ctx.textAlign = "right";
  ctx.font = "700 18px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#EA580C";
  ctx.textBaseline = "middle";
  ctx.fillText("Riepilogo offerte CTE per categoria", width - PAD, PAD + 22);
  ctx.font = "500 12px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#64748B";
  const when = new Date(payload.generatedAt).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  ctx.fillText(`Ordine: quota energia più bassa → più alta · ${when}`, width - PAD, PAD + 46);
  ctx.textAlign = "left";

  let y = PAD + HEADER_H;
  for (const section of sections) {
    roundRect(ctx, PAD, y, TABLE_W, SECTION_H, 6);
    ctx.fillStyle = "#0F172A";
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 14px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(section.title, PAD + 14, y + SECTION_H / 2);
    y += SECTION_H;

    let x = PAD;
    ctx.fillStyle = "#16A34A";
    ctx.fillRect(x, y, TABLE_W, COL_H);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "700 11px Inter, ui-sans-serif, system-ui, sans-serif";
    for (const col of COLS) {
      ctx.fillText(col.label, x + 8, y + COL_H / 2);
      x += col.w;
    }
    y += COL_H;

    for (const row of section.rows) {
      const pal = cteSupplierPalette(row.supplierName);
      ctx.fillStyle = pal.fill;
      ctx.fillRect(PAD, y, TABLE_W, ROW_H);
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(PAD + 2, y);
      ctx.lineTo(PAD + 2, y + ROW_H);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#E2E8F0";
      ctx.strokeRect(PAD, y, TABLE_W, ROW_H);

      const cells = [
        row.offerName,
        row.powerRangeLabel,
        row.consumptionRangeLabel,
        priceCell(row, "f1"),
        priceCell(row, "f2"),
        priceCell(row, "f3"),
        row.ccvLabel,
        row.commercialSegment || "—",
        row.validityLabel,
      ];
      x = PAD;
      ctx.fillStyle = pal.text;
      ctx.textBaseline = "middle";
      cells.forEach((cell, i) => {
        ctx.font =
          i === 0
            ? "700 12px Inter, ui-sans-serif, system-ui, sans-serif"
            : "500 11px Inter, ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(fitText(ctx, cell, COLS[i]!.w - 16), x + 8, y + ROW_H / 2);
        x += COLS[i]!.w;
      });
      y += ROW_H;
    }
    y += 18;
  }

  ctx.fillStyle = "#94A3B8";
  ctx.font = "400 11px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(
    "Quota energia: MONO o media F1/F2/F3 (fisse); spread PUN/PSV (variabili). Compensi non inclusi.",
    PAD,
    height - 18,
  );
  return canvas;
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}
