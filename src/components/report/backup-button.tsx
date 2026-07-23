"use client";

import { useState } from "react";
import { runBackupAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export function BackupButton() {
  const [message, setMessage] = useState<string | null>(null);

  async function handleBackup() {
    const result = await runBackupAction();
    if ("error" in result && result.error) {
      setMessage(result.error);
      return;
    }
    if ("payload" in result && result.filename && result.payload) {
      const blob = new Blob([result.payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(`Backup ${result.filename} creato con successo.`);
    }
  }

  return (
    <div>
      <Button type="button" onClick={handleBackup}>
        Esegui backup ora
      </Button>
      {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}
