"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
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
}: {
  attachments: ContractAttachmentItem[];
  onChange: (next: ContractAttachmentItem[]) => void;
  /** Se true (invio back office): serve almeno 1 allegato; casella gialla finché manca */
  requireDocs: boolean;
}) {
  /** Tipi spuntati dall'utente (cosa intende allegare / ha allegato) */
  const [checkedTypes, setCheckedTypes] = useState<Set<string>>(new Set());
  const [defaultType, setDefaultType] = useState<string>("AUTO");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attachments) {
      m.set(a.docType, (m.get(a.docType) ?? 0) + 1);
    }
    return m;
  }, [attachments]);

  const hasAny = attachments.length > 0;

  function toggleType(value: string) {
    setCheckedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else {
        next.add(value);
        setDefaultType(value);
      }
      return next;
    });
  }

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = [...attachments];
    const errors: string[] = [];
    const newlyUsed = new Set<string>();
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
      newlyUsed.add(docType);
      next.push({
        id: Math.random().toString(36).slice(2, 10),
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        docType,
        file,
      });
    }
    if (newlyUsed.size) {
      setCheckedTypes((prev) => {
        const s = new Set(prev);
        for (const t of newlyUsed) s.add(t);
        return s;
      });
    }
    onChange(next);
    if (errors.length) {
      window.alert(errors.slice(0, 5).join("\n"));
    }
  }

  function setType(id: string, docType: string) {
    onChange(attachments.map((a) => (a.id === id ? { ...a, docType } : a)));
    setCheckedTypes((prev) => new Set(prev).add(docType));
  }

  function remove(id: string) {
    onChange(attachments.filter((a) => a.id !== id));
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Documenti / Allegati</h2>
        <p className="text-xs text-slate-500">
          Spunta i documenti che alleghi, poi trascina i file (anche più di uno insieme).
          Per inviare al back office basta <strong>almeno un allegato</strong>.
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
            ? `✓ ${attachments.length} documento/i allegato/i — puoi inviare al back office.`
            : "Obbligatorio: allega almeno un documento (spunta i tipi sotto e carica i file)."}
        </p>
      ) : null}

      {/* Spunte tipi documento */}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {MAIN_DOC_TYPES.map((value) => {
          const label = labelOf(value);
          const n = counts.get(value) ?? 0;
          const checked = checkedTypes.has(value) || n > 0;
          return (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition",
                checked
                  ? "border-emerald-400 bg-emerald-50 text-emerald-950"
                  : requireDocs && !hasAny
                    ? "border-amber-200 bg-amber-50/40 text-slate-800"
                    : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300",
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={checked}
                onChange={() => toggleType(value)}
              />
              <span className="min-w-0 flex-1 font-medium">{label}</span>
              {n > 0 ? (
                <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {n}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>Tipo per i prossimi file:</span>
        <Select
          className="h-9 max-w-xs text-xs"
          value={defaultType}
          onChange={(e) => setDefaultType(e.target.value)}
        >
          <option value="AUTO">Auto (dal nome file)</option>
          {MAIN_DOC_TYPES.map((v) => (
            <option key={v} value={v}>
              {labelOf(v)}
            </option>
          ))}
        </Select>
      </div>

      <AttachmentDropZone
        title={
          defaultType === "AUTO"
            ? "Trascina qui i documenti (anche più file)"
            : `Prossimi file → ${labelOf(defaultType)}`
        }
        hint="Seleziona o trascina più PDF/foto insieme"
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
          Nessun file ancora. Spunta i tipi e carica i documenti.
        </p>
      )}
    </section>
  );
}
