"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { AttachmentDropZone } from "@/components/contracts/attachment-drop-zone";
import { Select } from "@/components/ui/form";
import { DOC_TYPE_OPTIONS } from "@/lib/constants";
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

const MAIN_DOC_TYPES = [
  "CI_UNICO",
  "CI_FRONTE",
  "CI_RETRO",
  "CF_TS",
  "BOLLETTA",
  "VISURA",
  "DOC_AMM",
  "MODULO",
  "SEPA",
  "ALTRO",
] as const;

function guessDocType(filename: string): string {
  const n = filename.toLowerCase();
  if (/visura/.test(n)) return "VISURA";
  if (/fattur|bollett|bolletta|bill/.test(n)) return "BOLLETTA";
  if (/sepa|mandato/.test(n)) return "SEPA";
  if (/cf|tessera|sanitar/.test(n)) return "CF_TS";
  if (/fronte|front/.test(n)) return "CI_FRONTE";
  if (/retro|back/.test(n)) return "CI_RETRO";
  if (/ci|identit|passaport|carta.?ident/.test(n)) return "CI_UNICO";
  if (/modulo|contratto.?firmat/.test(n)) return "MODULO";
  if (/amm|amministr/.test(n)) return "DOC_AMM";
  return "ALTRO";
}

function labelOf(docType: string) {
  return DOC_TYPE_OPTIONS.find((d) => d.value === docType)?.label ?? docType;
}

export function ContractAttachmentsPanel({
  attachments,
  onChange,
  requireDocs,
  identityOk,
  billOk,
}: {
  attachments: ContractAttachmentItem[];
  onChange: (next: ContractAttachmentItem[]) => void;
  requireDocs: boolean;
  identityOk: boolean;
  billOk: boolean;
}) {
  const [defaultType, setDefaultType] = useState<string>("AUTO");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attachments) {
      m.set(a.docType, (m.get(a.docType) ?? 0) + 1);
    }
    return m;
  }, [attachments]);

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
      const docType =
        defaultType === "AUTO" ? guessDocType(file.name) : defaultType;
      next.push({
        id: Math.random().toString(36).slice(2, 10),
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        docType,
        file,
      });
    }
    onChange(next);
    if (errors.length) {
      window.alert(errors.slice(0, 5).join("\n"));
    }
  }

  function setType(id: string, docType: string) {
    onChange(attachments.map((a) => (a.id === id ? { ...a, docType } : a)));
  }

  function remove(id: string) {
    onChange(attachments.filter((a) => a.id !== id));
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Documenti / Allegati</h2>
        <p className="text-xs text-slate-500">
          Una sola casella: trascina uno o più file insieme. Poi assegna il tipo a ciascun
          documento.
        </p>
      </div>

      {requireDocs ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          Obbligatori: <strong>documento identità</strong> (unico{" "}
          <em>oppure</em> fronte+retro) e <strong>almeno una fattura/bolletta</strong>.
        </p>
      ) : null}

      {/* Checklist tipi principali */}
      <div className="flex flex-wrap gap-1.5">
        {MAIN_DOC_TYPES.map((value) => {
          const label = labelOf(value);
          const n = counts.get(value) ?? 0;
          const requiredId =
            value === "CI_UNICO" ||
            value === "CI_FRONTE" ||
            value === "CI_RETRO"
              ? "identity"
              : value === "BOLLETTA"
                ? "bill"
                : null;
          const ok =
            requiredId === "identity"
              ? identityOk
              : requiredId === "bill"
                ? billOk
                : n > 0;
          const highlightRequired =
            requireDocs &&
            ((requiredId === "identity" && !identityOk) ||
              (requiredId === "bill" && !billOk));
          return (
            <button
              key={value}
              type="button"
              title={`Imposta «${label}» come tipo per i prossimi file`}
              onClick={() => setDefaultType(value)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                defaultType === value
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : n > 0 || ok
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : highlightRequired
                      ? "border-amber-400 bg-amber-50 text-amber-950"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300",
              )}
            >
              {n > 0 || (requiredId && ok) ? (
                <Check className="h-3 w-3" />
              ) : null}
              {label}
              {n > 0 ? ` (${n})` : ""}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setDefaultType("AUTO")}
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
            defaultType === "AUTO"
              ? "border-slate-800 bg-slate-800 text-white"
              : "border-slate-200 bg-white text-slate-600",
          )}
        >
          Auto (dal nome file)
        </button>
      </div>

      <AttachmentDropZone
        title={
          defaultType === "AUTO"
            ? "Trascina qui tutti i documenti"
            : `Prossimi file → ${labelOf(defaultType)}`
        }
        hint="Puoi selezionare o trascinare più PDF/foto insieme (anche 5–10 file)"
        multiple
        fillStatus={
          requireDocs
            ? identityOk && billOk
              ? "filled"
              : "empty"
            : attachments.length
              ? "filled"
              : "off"
        }
        className="!p-2.5 sm:!p-3"
        onAdd={addFiles}
      />

      {attachments.length > 0 ? (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {a.filename}
                </p>
                <p className="text-[10px] text-slate-500">
                  {a.size ? `${Math.max(1, Math.round(a.size / 1024))} KB` : ""}
                  {a.mimeType ? ` · ${a.mimeType}` : ""}
                </p>
              </div>
              <Select
                className="h-9 w-full max-w-[14rem] text-xs sm:w-auto"
                value={a.docType}
                onChange={(e) => setType(a.id, e.target.value)}
              >
                {DOC_TYPE_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
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
      ) : (
        <p className="text-xs text-slate-500">
          Nessun documento ancora. Tipi tipici: documento identità, fattura, visura,
          SEPA, modulo firmato…
        </p>
      )}
    </section>
  );
}
