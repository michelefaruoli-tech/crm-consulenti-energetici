"use client";

import { useState } from "react";
import { runBackupAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export function BackupButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);

  async function handleBackup() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await runBackupAction({ sendEmail });
      if ("error" in result && result.error) {
        setMessage(result.error);
        return;
      }
      if ("payloadBase64" in result && result.filename) {
        const binary = atob(result.payloadBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = result.filename;
        link.click();
        URL.revokeObjectURL(url);

        const parts = [
          `Backup Excel completo scaricato: ${result.filename}`,
          `(${result.counts.clients ?? "?"} clienti, ${result.counts.contracts ?? "?"} contratti)`,
        ];
        if (sendEmail) {
          parts.push(
            result.emailed
              ? "Email inviata con l'allegato."
              : `Email non inviata: ${result.mailError ?? "errore SMTP"}`,
          );
        }
        setMessage(parts.join(" "));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Errore backup");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Scarica un Excel <strong>completo</strong> con tutti i dati del CRM
        (Clienti, Contratti pagati/da pagare, Provvigioni, ecc.). Ogni sera alle
        ~22 ricevi lo stesso file via email in automatico. Per salvare una
        «versione funzionante» completa apri la pagina Backup.
      </p>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={sendEmail}
          onChange={(e) => setSendEmail(e.target.checked)}
          className="rounded border-slate-300"
        />
        Invia anche via email (allegato Excel)
      </label>
      <Button type="button" onClick={handleBackup} disabled={loading}>
        {loading ? "Backup in corso…" : "Esegui backup Excel ora"}
      </Button>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}
