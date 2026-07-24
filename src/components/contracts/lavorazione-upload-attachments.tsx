"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { DOC_TYPE_OPTIONS } from "@/lib/constants";
import { PersistentAlert } from "@/components/ui/persistent-alert";

export function LavorazioneUploadAttachments({ contractId }: { contractId: string }) {
  const inputId = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [docType, setDocType] = useState("BOLLETTA");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-2 font-semibold text-slate-900">Carica allegati</h2>
      <p className="mb-3 text-xs text-slate-500">
        Se l&apos;upload iniziale è fallito, puoi aggiungere i file qui (max 3MB ciascuno).
      </p>
      {error ? (
        <div className="mb-3">
          <PersistentAlert title="Upload non riuscito" messages={[error]} onClose={() => setError(null)} />
        </div>
      ) : null}
      {ok ? (
        <div className="mb-3">
          <PersistentAlert title="OK" messages={[ok]} tone="success" onClose={() => setOk(null)} />
        </div>
      ) : null}
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
            Scegli file
          </label>
          <input
            id={inputId}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 15 * 1024 * 1024) {
                setError("File troppo grande (max 15MB)");
                return;
              }
              setError(null);
              setOk(null);
              start(async () => {
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
                  setError(json?.message ?? `Upload fallito (HTTP ${res.status})`);
                  return;
                }
                setOk(json.message ?? "Allegato salvato");
                router.refresh();
              });
            }}
          />
        </div>
        {pending ? <Button type="button" disabled>Caricamento…</Button> : null}
      </div>
    </section>
  );
}
