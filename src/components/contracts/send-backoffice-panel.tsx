"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type NotifyJson = {
  success?: boolean;
  queued?: boolean;
  emailSent?: boolean;
  message?: string;
  recipients?: string;
  hasDedicatedBo?: boolean;
  boWarning?: string | null;
  code?: string;
};

export function SendBackofficePanel({
  contractIds,
  supplierName,
  supplierId,
  attachmentCount,
  alreadyQueued,
}: {
  contractIds: string[];
  supplierName: string;
  /** Se noto, usato per pre-caricare l’avviso destinazione BO. */
  supplierId?: string | null;
  attachmentCount: number;
  alreadyQueued?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
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
        ? `REINVIA AL BACK OFFICE\n\nFornitore: ${supplierName}\nPratiche: ${label}\n\nLa pratica resta In lavorazione; l'email va ai destinatari del fornitore (o solo Master se non c’è BO dedicato).\n\nConfermi?`
        : `INVIA AL BACK OFFICE\n\nFornitore: ${supplierName}\nPratiche: ${label}\n\nIl contratto entra in In lavorazione (IN_LAVORAZIONE) e nel percorso Provvigioni. L'email va al BO del fornitore se assegnato, altrimenti solo al Master con avviso.\n\nConfermi?`,
    );
    if (!ok) return;

    setErr(null);
    setMsg(null);
    setWarn(null);
    start(async () => {
      try {
        const res = await fetch("/api/contracts/notify-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractIds }),
        });
        const json = (await res.json().catch(() => null)) as NotifyJson | null;
        // Coda ok = successo operativo (non far sparire la pratica se manca email/BO)
        if (!res.ok || !json?.success) {
          setErr(json?.message || "Invio / messa in coda non riuscita");
          return;
        }
        if (json.boWarning) {
          setWarn(json.boWarning);
        } else if (json.hasDedicatedBo === false) {
          setWarn(
            `Nessun Back Office dedicato per «${supplierName}». Pratica comunque in lavorazione.`,
          );
        }
        if (!json.emailSent) {
          setWarn((w) =>
            [
              w,
              "Email non inviata: puoi riprovare con Reinvia. Stato In lavorazione già attivo.",
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
        setMsg(
          json.message ||
            (json.emailSent
              ? `In coda e notificato${json.recipients ? ` (${json.recipients})` : ""}.`
              : `In coda In lavorazione per ${supplierName}.`),
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
        (più Master). Se il fornitore non ha BO in scope, la pratica resta
        comunque <strong>In lavorazione</strong> e in Provvigioni — con avviso
        esplicito, senza sparire.
        {count > 1 ? ` · ${count} pratiche collegate (es. Luce + Gas)` : ""}
        {supplierId ? null : null}
      </p>
      {msg ? (
        <p className="rounded-lg bg-white px-3 py-2 text-sm text-emerald-800">{msg}</p>
      ) : null}
      {warn ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {warn}
        </p>
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
