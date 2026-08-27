"use client";

import { X } from "lucide-react";
import { AttachmentDropZone } from "@/components/contracts/attachment-drop-zone";
import { cn } from "@/lib/cn";

export type ContractAttachmentItem = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  docType: string;
  file?: File;
  contentBase64?: string;
};

function guessDocType(filename: string): string {
  const n = filename.toLowerCase();
  if (/visura/.test(n)) return "VISURA";
  if (/fattur|bollett|bolletta|bill/.test(n)) return "BOLLETTA";
  return "ALTRO";
}

export function ContractAttachmentsPanel({
  attachments,
  onChange,
  requireDocs,
  clientType,
}: {
  attachments: ContractAttachmentItem[];
  onChange: (next: ContractAttachmentItem[]) => void;
  requireDocs: boolean;
  clientType: "PRIVATO" | "AZIENDA";
}) {
  const hasAny = attachments.length > 0;
  const isBusiness = clientType === "AZIENDA";

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = [...attachments];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const okType =
        ["application/pdf", "image/jpeg", "image/png", "image/jpg"].includes(
          file.type,
        ) || /\.(pdf|jpe?g|png)$/i.test(file.name);
      if (!okType) {
        errors.push(`Formato non supportato: ${file.name}`);
        continue;
      }
      if (file.size > 15 * 1024 * 1024) {
        errors.push(`File troppo grande (max 15MB): ${file.name}`);
        continue;
      }
      next.push({
        id: Math.random().toString(36).slice(2, 10),
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        docType: guessDocType(file.name),
        file,
      });
    }
    onChange(next);
    if (errors.length) {
      window.alert(errors.slice(0, 5).join("\n"));
    }
  }

  function remove(id: string) {
    onChange(attachments.filter((a) => a.id !== id));
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Documenti / Allegati</h2>
        <p className="text-xs text-slate-500">
          {requireDocs ? "Documento obbligatorio se invii al back office. " : null}
          Fattura consigliata
          {isBusiness ? "; visura consigliata per business" : null}.
        </p>
      </div>

      {requireDocs ? (
        <p
          className={cn(
            "rounded-lg px-3 py-2 text-xs ring-1",
            hasAny
              ? "bg-emerald-50 text-emerald-900 ring-emerald-300"
              : "bg-amber-50 text-amber-900 ring-amber-300",
          )}
        >
          {hasAny
            ? `✓ ${attachments.length} file — puoi inviare al back office.`
            : "Allega almeno un documento per inviare al back office."}
        </p>
      ) : null}

      <AttachmentDropZone
        title="Trascina qui i file"
        hint=""
        multiple
        fillStatus={
          requireDocs ? (hasAny ? "filled" : "empty") : hasAny ? "filled" : "off"
        }
        className="!p-2.5 sm:!p-3"
        onAdd={addFiles}
      />

      {attachments.length > 0 ? (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {a.filename}
                </p>
                <p className="text-[10px] text-slate-500">
                  {a.size ? `${Math.max(1, Math.round(a.size / 1024))} KB` : ""}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700"
                title="Rimuovi"
                onClick={() => remove(a.id)}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
