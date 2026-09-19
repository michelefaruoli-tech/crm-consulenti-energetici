import { CTE_PDF_MAX_BYTES, CTE_PDF_MAX_FILES } from "@/lib/cte-form-schema";
import type { CtePdfParseResult } from "@/lib/cte-pdf-parse";

export type CtePdfQueueStatus =
  | "pending"
  | "reading"
  | "review"
  | "saving"
  | "saved"
  | "error"
  | "skipped";

export type CteListinoPrefill = {
  filename: string;
  supplierId: string | null;
  supplierMatchName: string | null;
  extracted: CtePdfParseResult;
  textPreview: string;
};

export type CtePdfQueueItem = {
  file: File;
  status: CtePdfQueueStatus;
  error?: string;
  savedId?: string;
  savedOfferName?: string;
  listinoPrefill?: CteListinoPrefill;
};

export type CtePdfFileSelectResult = {
  files: File[];
  errors: string[];
  truncated: boolean;
};

function isCteUploadFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.type === "image/jpg" ||
    /\.(pdf|png|jpe?g)$/i.test(file.name)
  );
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}`;
}

export function selectCtePdfFiles(
  incoming: File[],
  options?: {
    maxFiles?: number;
    maxBytes?: number;
    alreadyCount?: number;
    existingKeys?: Iterable<string>;
  },
): CtePdfFileSelectResult {
  const maxFiles = options?.maxFiles ?? CTE_PDF_MAX_FILES;
  const maxBytes = options?.maxBytes ?? CTE_PDF_MAX_BYTES;
  const already = options?.alreadyCount ?? 0;
  const errors: string[] = [];
  const files: File[] = [];
  let truncated = false;
  const seen = new Set<string>(options?.existingKeys ? [...options.existingKeys] : []);

  for (const file of incoming) {
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isCteUploadFile(file)) {
      errors.push(`${file.name}: serve un PDF o un'immagine PNG/JPG`);
      continue;
    }
    if (file.size <= 0) {
      errors.push(`${file.name}: file vuoto`);
      continue;
    }
    if (file.size > maxBytes) {
      errors.push(`${file.name}: troppo grande (max ${maxBytes / (1024 * 1024)} MB)`);
      continue;
    }
    if (already + files.length >= maxFiles) {
      truncated = true;
      continue;
    }
    files.push(file);
  }
  if (truncated) {
    errors.push(`Massimo ${maxFiles} file per volta. I file in eccesso non sono stati aggiunti.`);
  }
  return { files, errors, truncated };
}

export function ctePdfFileKey(file: File): string {
  return fileKey(file);
}

export function nextUnfinishedIndex(
  statuses: CtePdfQueueStatus[],
  afterIndex: number,
): number | null {
  for (let i = afterIndex + 1; i < statuses.length; i++) {
    const status = statuses[i];
    if (status === "pending" || status === "error") return i;
  }
  return null;
}

export function queueHasUnfinished(statuses: CtePdfQueueStatus[]): boolean {
  return statuses.some(
    (status) =>
      status === "pending" ||
      status === "reading" ||
      status === "review" ||
      status === "saving" ||
      status === "error",
  );
}

export function queueProgressLabel(index: number, total: number): string {
  if (total <= 0) return "";
  return `File ${index + 1} di ${total}`;
}

export function queueStatusLabel(status: CtePdfQueueStatus): string {
  switch (status) {
    case "pending":
      return "In coda";
    case "reading":
      return "Lettura…";
    case "review":
      return "Da rivedere";
    case "saving":
      return "Salvataggio…";
    case "saved":
      return "Salvata";
    case "error":
      return "Errore";
    case "skipped":
      return "Saltata";
    default:
      return status;
  }
}
