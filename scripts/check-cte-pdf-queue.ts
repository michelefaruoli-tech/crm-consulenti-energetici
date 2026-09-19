/**
 * Verifica selezione e avanzamento coda PDF CTE (senza OCR / senza rete).
 * Uso: npx tsx scripts/check-cte-pdf-queue.ts
 */
import { CTE_PDF_MAX_BYTES, CTE_PDF_MAX_FILES } from "../src/lib/cte-form-schema";
import {
  nextUnfinishedIndex,
  queueHasUnfinished,
  queueProgressLabel,
  selectCtePdfFiles,
} from "../src/lib/cte-pdf-queue";

function pdf(name: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const mixed = selectCtePdfFiles([
  pdf("a.pdf"),
  new File([new Uint8Array(10)], "note.txt", { type: "text/plain" }),
  pdf("a.pdf"),
  pdf("b.pdf"),
  new File([new Uint8Array(CTE_PDF_MAX_BYTES + 1)], "grosso.pdf", { type: "application/pdf" }),
]);
assert(mixed.files.map((f) => f.name).join(",") === "a.pdf,b.pdf", "accetta solo PDF nuovi");
assert(mixed.errors.some((e) => e.includes("note.txt")), "rifiuta non-PDF");
assert(mixed.errors.some((e) => e.includes("grosso.pdf")), "rifiuta oversize");
assert(!mixed.truncated, "non tronca sotto il tetto");

const pngOk = selectCtePdfFiles([
  new File([new Uint8Array(20)], "listino.png", { type: "image/png" }),
]);
assert(pngOk.files.map((f) => f.name).join(",") === "listino.png", "accetta PNG listino");

const overflow = selectCtePdfFiles(
  Array.from({ length: CTE_PDF_MAX_FILES + 2 }, (_, i) => pdf(`f${i}.pdf`)),
);
assert(overflow.files.length === CTE_PDF_MAX_FILES, "rispetta max file");
assert(overflow.truncated, "segnala troncamento");

const append = selectCtePdfFiles([pdf("c.pdf"), pdf("a.pdf")], {
  alreadyCount: 1,
  existingKeys: ["a.pdf:100"],
});
assert(append.files.map((f) => f.name).join(",") === "c.pdf", "dedupe in append");

assert(nextUnfinishedIndex(["saved", "pending", "error"], 0) === 1, "next pending");
assert(nextUnfinishedIndex(["saved", "saved", "error"], 1) === 2, "next error");
assert(nextUnfinishedIndex(["saved", "skipped"], 0) === null, "fine coda");
assert(queueHasUnfinished(["saved", "review"]), "review è unfinished");
assert(!queueHasUnfinished(["saved", "skipped"]), "solo saved/skipped = finito");
assert(queueProgressLabel(0, 5) === "File 1 di 5", "etichetta 1-based");

console.log("check-cte-pdf-queue: ok");
