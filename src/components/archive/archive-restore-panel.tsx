"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { restoreContractsToProvvigioniAction } from "@/lib/archive-restore-actions";
import type { ContractTableRow } from "@/lib/contract-row";

/**
 * Selezione + ripristino contratti da Archivio verso Provvigioni
 * (Incassato / Pagato / Da incassare).
 */
export function ArchiveRestorePanel({ rows }: { rows: ContractTableRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState<"Pagato" | "Incassato" | "Da incassare">(
    "Pagato",
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ids = useMemo(
    () => rows.map((r) => r.id).filter(Boolean),
    [rows],
  );
  const selectedIds = ids.filter((id) => selected[id]);

  function toggleAll(on: boolean) {
    const next: Record<string, boolean> = {};
    if (on) {
      for (const id of ids) next[id] = true;
    }
    setSelected(next);
  }

  function restore() {
    if (selectedIds.length === 0) {
      setErr("Seleziona almeno un contratto");
      return;
    }
    const ok = window.confirm(
      `Ripristinare ${selectedIds.length} contratti in Provvigioni come «${target}»?\n` +
        "Usciranno dall’Archivio e potrai gestirli nella lista Provvigioni.",
    );
    if (!ok) return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("contractIds", selectedIds.join(","));
      fd.set("targetStato", target);
      const res = await restoreContractsToProvvigioniAction(fd);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(`${res.count} contratti ripristinati in Provvigioni («${target}»).`);
      setSelected({});
      router.refresh();
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
      <h3 className="font-semibold text-slate-900">
        Ripristina in Provvigioni
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Se un contratto è finito in Archivio o KO per sbaglio, selezionalo e
        ripristinalo come <strong>Pagato</strong>, <strong>Incassato</strong> o{" "}
        <strong>Da incassare</strong>. Comparirà di nuovo in Provvigioni.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          onClick={() => toggleAll(true)}
        >
          Seleziona tutti ({ids.length})
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          onClick={() => toggleAll(false)}
        >
          Deseleziona
        </button>
        <select
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          value={target}
          onChange={(e) =>
            setTarget(e.target.value as "Pagato" | "Incassato" | "Da incassare")
          }
        >
          <option value="Pagato">Pagato</option>
          <option value="Incassato">Incassato</option>
          <option value="Da incassare">Da incassare</option>
        </select>
        <Button
          type="button"
          disabled={pending || selectedIds.length === 0}
          onClick={restore}
        >
          {pending
            ? "Ripristino…"
            : `Ripristina selezionati (${selectedIds.length})`}
        </Button>
      </div>

      {err ? <p className="mt-2 text-sm text-red-700">{err}</p> : null}
      {msg ? <p className="mt-2 text-sm text-emerald-800">{msg}</p> : null}

      <div className="mt-3 max-h-56 overflow-auto rounded border border-amber-100 bg-white">
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((r) => {
            const label = r.clientName || r.id.slice(0, 8);
            return (
              <li key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={Boolean(selected[r.id])}
                  onChange={(e) =>
                    setSelected((prev) => ({
                      ...prev,
                      [r.id]: e.target.checked,
                    }))
                  }
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {label}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {r.supplierName ?? "—"} · {r.podPdr || "—"}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {r.archiveLabel || r.status}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
