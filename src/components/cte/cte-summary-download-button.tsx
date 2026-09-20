"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  downloadCanvasPng,
  renderCteSummaryCanvas,
} from "@/lib/cte-summary-image";
import type { CteSummaryPayload } from "@/lib/cte-summary-types";

export function CteSummaryDownloadButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDownload() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/catalogo-cte/riepilogo");
      const data = (await res.json()) as
        | ({ ok: true } & CteSummaryPayload)
        | { ok: false; error: string };
      if (!res.ok || !data.ok) {
        setError(!data.ok ? data.error : "Download non riuscito");
        return;
      }
      if (data.sections.length === 0) {
        setError("Nessuna CTE attiva da esportare.");
        return;
      }
      const canvas = renderCteSummaryCanvas(data);
      const day = new Date().toISOString().slice(0, 10);
      downloadCanvasPng(canvas, `cte-riepilogo-${day}.png`);
    } catch {
      setError("Download non riuscito");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" disabled={pending} onClick={() => void onDownload()}>
        <Download className="mr-2 h-4 w-4" />
        {pending ? "Preparazione…" : "Scarica riepilogo"}
      </Button>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
