"use client";

import { useState } from "react";
import {
  resendWorkingBackupAction,
  runBackupAction,
  runWorkingSnapshotAction,
} from "@/lib/actions";
import { Button } from "@/components/ui/button";

function downloadBase64Excel(filename: string, payloadBase64: string) {
  const binary = atob(payloadBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function BackupPanel({
  backupEmail,
  gitHash,
}: {
  backupEmail: string;
  gitHash: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState<
    null | "excel" | "working" | "restore"
  >(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [note, setNote] = useState("");

  async function handleExcel() {
    setLoading("excel");
    setMessage(null);
    try {
      const result = await runBackupAction({ sendEmail });
      if ("error" in result && result.error) {
        setMessage(result.error);
        return;
      }
      if ("payloadBase64" in result && result.filename) {
        downloadBase64Excel(result.filename, result.payloadBase64);
        const parts = [
          `Excel scaricato: ${result.filename}`,
          `(${result.counts.contracts ?? "?"} contratti, ${result.counts.clients ?? "?"} clienti)`,
        ];
        if (sendEmail) {
          parts.push(
            result.emailed
              ? `Email inviata a ${backupEmail}.`
              : `Email non inviata: ${result.mailError ?? "errore SMTP"}`,
          );
        }
        setMessage(parts.join(" "));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Errore backup");
    } finally {
      setLoading(null);
    }
  }

  async function handleWorking() {
    setLoading("working");
    setMessage(null);
    try {
      const result = await runWorkingSnapshotAction({
        note: note.trim() || undefined,
        sendEmail: true,
      });
      if ("error" in result && result.error) {
        setMessage(result.error);
        return;
      }
      if ("payloadBase64" in result && result.filename) {
        downloadBase64Excel(result.filename, result.payloadBase64);
        const parts = [
          `Versione funzionante salvata.`,
          `Excel: ${result.filename}`,
          result.gitHash ? `Commit codice: ${result.gitHash}` : "",
          result.emailed
            ? `Email con Excel${result.jsonIncludedInEmail ? " + JSON" : ""} inviata a ${backupEmail}.`
            : `Email non inviata: ${result.mailError ?? "errore SMTP"}`,
        ].filter(Boolean);
        setMessage(parts.join(" "));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Errore snapshot");
    } finally {
      setLoading(null);
    }
  }

  async function handleRestore() {
    setLoading("restore");
    setMessage(null);
    try {
      const result = await resendWorkingBackupAction();
      if ("error" in result && result.error) {
        setMessage(result.error);
        return;
      }
      if ("payloadBase64" in result && result.filename) {
        downloadBase64Excel(result.filename, result.payloadBase64);
        const parts = [
          `Copia di sicurezza scaricata e inviata: ${result.filename}`,
          `(${result.counts.contracts ?? "?"} contratti)`,
          result.emailed
            ? `Email a ${backupEmail}.`
            : `Email non inviata: ${result.mailError ?? "errore SMTP"}`,
          result.lastWorkingAt
            ? `Ultimo punto «funzionante» registrato: ${new Date(result.lastWorkingAt).toLocaleString("it-IT")}${result.lastWorkingNote ? ` — ${result.lastWorkingNote}` : ""}. Controlla anche quella email per Excel/JSON storici.`
            : "Non c’è ancora uno snapshot «funzionante»: creane uno col pulsante verde.",
        ];
        setMessage(parts.join(" "));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Errore");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">
          1. Backup dati (Excel)
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          Scarica un Excel con <strong>tutti</strong> i contratti (pagati e da
          pagare), clienti, provvigioni, fornitori. È il file più importante.
          Ogni sera alle ~22 (ora italiana) lo stesso backup parte in automatico
          via email a <span className="font-medium">{backupEmail}</span>.
        </p>
        <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            className="rounded border-slate-300"
          />
          Invia anche via email adesso
        </label>
        <Button
          type="button"
          onClick={handleExcel}
          disabled={loading !== null}
        >
          {loading === "excel" ? "Backup in corso…" : "Scarica Excel dati ora"}
        </Button>
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">
          2. Salva versione funzionante
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          Quando il CRM funziona bene, salva un punto di ripristino: Excel + JSON
          completo via email, con il codice della versione del sito (
          <code className="rounded bg-white px-1 text-xs">{gitHash}</code>).
          Se qualcosa si rompe, hai i dati e sai quale versione codice ripristinare
          su GitHub.
        </p>
        <label className="mb-2 block text-sm text-slate-700">
          Nota (opzionale)
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Es. Prima di importare Excel Fabiana"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <Button
          type="button"
          onClick={handleWorking}
          disabled={loading !== null}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          {loading === "working"
            ? "Salvataggio…"
            : "Salva e invia versione funzionante"}
        </Button>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">
          3. Carica ultima funzionante
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          Ti riscarica subito l’Excel dello stato <strong>attuale</strong> del
          database e te lo rimanda via email. Controlla anche la casella per
          l’ultimo snapshot «WORKING» (Excel + JSON). Il codice del sito non
          viene cambiato da questo pulsante: per tornare a una versione vecchia
          del programma serve GitHub (commit indicato nella email WORKING).
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={handleRestore}
          disabled={loading !== null}
        >
          {loading === "restore"
            ? "Preparazione…"
            : "Scarica / invia copia di sicurezza ora"}
        </Button>
      </section>

      {message ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}
