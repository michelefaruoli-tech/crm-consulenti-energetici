"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import { importCteListinoAction, importDolomitiListinoAction } from "@/lib/cte-actions";
import { buildCatalogRedirectAfterListinoImport } from "@/lib/cte-listino-catalog-redirect";
import type { CteListinoKind } from "@/lib/cte-listino-detect";

const ITEMS: Array<{ kind: CteListinoKind; title: string }> = [
  { kind: "duferco-fix-family", title: "Duferco Fix Family" },
  { kind: "duferco-flex-condomini", title: "Duferco Flex" },
  { kind: "dolomiti", title: "Dolomiti" },
  { kind: "enel-corporate", title: "Enel" },
  { kind: "iren", title: "Iren" },
  { kind: "sev-iren", title: "SEV Iren" },
  { kind: "compara", title: "Compara" },
];

export function CteListinoImportPanel() {
  const router = useRouter();
  const [pending, setPending] = useState<CteListinoKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onImport(kind: CteListinoKind) {
    setPending(kind);
    setError(null);
    try {
      if (kind === "dolomiti") {
        const res = await importDolomitiListinoAction();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.push(
          buildCatalogRedirectAfterListinoImport({
            kind,
            created: res.created,
            updated: res.updated,
            label: "Dolomiti",
          }),
        );
        router.refresh();
        return;
      }

      const res = await importCteListinoAction(kind);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(
        buildCatalogRedirectAfterListinoImport({
          kind,
          created: res.created,
          updated: res.updated,
          deactivated: res.deactivated,
          label: res.label,
        }),
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import non riuscito");
    } finally {
      setPending(null);
    }
  }

  return (
    <div id="duferco-flex-condomini" className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
      <h2 className="font-semibold text-slate-900">Listini</h2>
      <p className="mt-1 text-sm text-slate-600">
        Un click aggiorna le CTE del fornitore nel catalogo (idempotente). In alternativa carica il
        file CTE/PDF sotto.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {ITEMS.map((item) => (
          <div
            key={item.kind}
            className="flex flex-col items-stretch gap-2 rounded-lg border border-sky-100 bg-white/80 p-3"
          >
            <p className="font-medium text-slate-900">{item.title}</p>
            <Button
              type="button"
              className="w-full"
              disabled={pending != null}
              onClick={() => void onImport(item.kind)}
            >
              {pending === item.kind ? "Aggiornamento…" : "Aggiorna"}
            </Button>
          </div>
        ))}
      </div>
      {error ? (
        <div className="mt-3">
          <PersistentAlert title="Import listino" messages={[error]} tone="error" />
        </div>
      ) : null}
    </div>
  );
}
