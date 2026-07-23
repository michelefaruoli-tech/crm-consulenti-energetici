"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { importHistoricalExcelAction } from "@/lib/archive-actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

export function ArchiveImportForm() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const result = await importHistoricalExcelAction(fd);
    setPending(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setMessage(`Importati ${result.imported} contratti nel lotto "${result.label}".`);
    e.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <Field label="Nome lotto / database">
        <Input
          name="archiveLabel"
          required
          placeholder="Es. Pagati 2024 - Enel"
        />
      </Field>
      <Field label="File Excel (.xlsx)">
        <Input name="file" type="file" accept=".xlsx,.xls" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Import in corso…" : "Importa storico"}
      </Button>
      {message ? (
        <p className="md:col-span-3 text-sm text-slate-600">{message}</p>
      ) : null}
    </form>
  );
}
