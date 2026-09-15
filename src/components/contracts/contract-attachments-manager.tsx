"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { DOC_TYPE_OPTIONS } from "@/lib/constants";
import { PersistentAlert } from "@/components/ui/persistent-alert";

export type ContractAttachmentRow = {
  id: string;
  filename: string;
  docType: string | null;
  size: number;
};

function docTypeLabel(value: string | null): string {
  if (!value) return "Allegato";
  return DOC_TYPE_OPTIONS.find((d) => d.value === value)?.label ?? value;
}

export function ContractAttachmentsManager({
  contractId,
  documents,
  canUpload,
}: {
  contractId: string;
  documents: ContractAttachmentRow[];
  canUpload: boolean;
}) {
  const inputId = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [docType, setDocType] = useState("BOLLETTA");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    setOk(null);
    start(async () => {
      const saved: string[] = [];
      const failed: string[] = [];
      for (const file of list) {
        if (file.size > 15 * 1024 * 1024) {
          failed.push(`${file.name}: troppo grande (max 15MB)`);
          continue;
        }
        const fd = new FormData();
        fd.append("files", file, file.name);
        fd.append("docTypes", docType);
        const res = await fetch(`/api/contracts/${contractId}/attachments`, {
          method: "POST",
          body: fd,
        });
        const json = (await res.json().catch(() => null)) as {
          success?: boolean;
          message?: string;
        } | null;
        if (!res.ok || !json?.success) {
          failed.push(`${file.name}: ${json?.message ?? `HTTP ${res.status}`}`);
        } else {
          saved.push(file.name);
        }
      }
      if (saved.length) {
        setOk(
          saved.length === 1
            ? `Allegato salvato: ${saved[0]}`
            : `Salvati ${saved.length} allegati.`,
        );
        router.refresh();
      }
      if (failed.length) {
        setError(failed.slice(0, 4).join(" · "));
      }
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-semibold text-slate-900">Allegati</h2>
      <p className="mb-4 text-sm text-slate-500">
        Carica identità, bolletta e moduli. Poi puoi inviare il contratto al
        back office del fornitore.
      </p>

      {error ? (
        <div className="mb-3">
          <PersistentAlert
            title="Upload non riuscito"
            messages={[error]}
            onClose={() => setError(null)}
          />
        </div>
      ) : null}
      {ok ? (
        <div className="mb-3">
          <PersistentAlert
            title="OK"
            messages={[ok]}
            tone="success"
            onClose={() => setOk(null)}
          />
        </div>
      ) : null}

      {documents.length > 0 ? (
        <ul className="mb-4 space-y-1 text-sm">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
            >
              <span>
                <span className="font-medium text-slate-900">{d.filename}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {docTypeLabel(d.docType)}
                  {d.size ? ` · ${Math.round(d.size / 1024)} KB` : ""}
                </span>
              </span>
              <a
                className="text-sm font-medium text-emerald-700 underline"
                href={`/api/documents/${d.id}`}
              >
                Scarica
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Nessun documento allegato. Aggiungili prima di inviare al back office.
        </p>
      )}

      {canUpload ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Tipo documento">
            <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <label
              htmlFor={inputId}
              className="inline-flex cursor-pointer items-center rounded-lg border border-dashed border-emerald-400 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
            >
              {pending ? "Caricamento…" : "Aggiungi file"}
            </label>
            <input
              id={inputId}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
              className="sr-only"
              disabled={pending}
              onChange={(e) => {
                const files = e.target.files;
                e.target.value = "";
                if (files?.length) uploadFiles(files);
              }}
            />
          </div>
          {pending ? (
            <Button type="button" disabled>
              Caricamento…
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
