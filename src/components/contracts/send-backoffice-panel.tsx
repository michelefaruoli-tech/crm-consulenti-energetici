"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SendBackofficePanel({
  contractIds,
  supplierName,
  attachmentCount,
  alreadyQueued,
}: {
  contractIds: string[];
  supplierName: string;
  attachmentCount: number;
  alreadyQueued?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const count = contractIds.length;
  const label =
    count > 1
      ? `${count} contratti collegati`
      : "questo contratto";

  function send() {
    if (attachmentCount === 0) {
      const go = window.confirm(
        "Non ci sono allegati su questa pratica.\n\nVuoi inviare comunque al back office?",
      );
      if (!go) return;
    }
    const ok = window.confirm(
      alreadyQueued
        ? `REINVIA AL BACK OFFICE\n\nFornitore: ${supplierName}\nPratiche: ${label}\n\nL'email va al back office assegnato a questo fornitore.\n\nConfermi?`
        : `INVIA AL BACK OFFICE\n\nFornitore: ${supplierName}\nPratiche: ${label}\n\nIl contratto entra in lavorazione e l'email va al back office del fornitore.\n\nConfermi?`,
    );
    if (!ok) return;

    setErr(null);
    setMsg(null);
    start(async () => {
      try {
        const res = await fetch("/api/contracts/notify-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractIds }),
        });
        const json = (await res.json().catch(() => null)) as {
          success?: boolean;
          emailSent?: boolean;
          message?: string;
          recipients?: string;
        } | null;
        if (!res.ok || !json?.emailSent) {
          setErr(json?.message || "Invio email non riuscito");
          return;
        }
        setMsg(
          json.message ||
            `Inviato al back office di ${supplierName}${json.recipients ? ` (${json.recipients})` : ""}.`,
        );
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Errore di rete");
      }
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border-4 border-emerald-600 bg-emerald-50 p-4 shadow-md sm:p-5">
      <h3 className="text-lg font-black uppercase tracking-wide text-emerald-950">
        {alreadyQueued ? "Reinvia al back office" : "Invia al back office"}
      </h3>
      <p className="text-sm text-emerald-900">
        Destinatari: back office assegnato a <strong>{supplierName}</strong>{" "}
        (più Master). L&apos;email contiene anagrafica, dati contratto e
        allegati
        {count > 1 ? ` · ${count} pratiche collegate (es. Luce + Gas)` : ""}.
      </p>
      {msg ? (
        <p className="rounded-lg bg-white px-3 py-2 text-sm text-emerald-800">{msg}</p>
      ) : null}
      {err ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="min-h-14 w-full bg-emerald-700 text-base font-bold uppercase tracking-wide text-white hover:bg-emerald-800 sm:w-auto sm:min-w-[16rem]"
        disabled={pending}
        onClick={send}
      >
        {pending
          ? "Invio in corso…"
          : alreadyQueued
            ? count > 1
              ? `Reinvia email (${count} contratti)`
              : "Reinvia email al BACK OFFICE"
            : count > 1
              ? `Invia al BACK OFFICE (${count})`
              : "Invia al BACK OFFICE"}
      </Button>
    </div>
  );
}
