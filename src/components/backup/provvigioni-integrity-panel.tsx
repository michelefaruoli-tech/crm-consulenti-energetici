"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { applyMissingProvvigioniRowsAction } from "@/lib/recurring-backfill-actions";
import { applyRecurringCleanupAction } from "@/lib/recurring-cleanup-actions";
import {
  applyEarlyRecurringCleanupAction,
  applyManualOutOfWindowCleanupAction,
  applyPodDuplicateArchiveAction,
  checkProvvigioniTotalsAction,
  scanPodDuplicateAnomaliesAction,
  scanRecurringAnomaliesAction,
} from "@/lib/provvigioni-integrity-actions";
// Tipi importati dal modulo che li definisce, NON dal file "use server":
// un `export type { ... }` senza `from` in un file "use server" causa
// "X is not defined" a runtime nel bundle Server Actions (verificato).
import type { IntegrityRowFinding } from "@/lib/provvigioni-integrity-scan";
import type {
  PodDuplicateFinding,
  TotalsConsistencyResult,
} from "@/lib/provvigioni-integrity";
import { friendlyActionError } from "@/lib/friendly-client-error";

type Category = IntegrityRowFinding["category"];

const CATEGORY_LABELS: Record<Category, string> = {
  missing_monthly: "Rate mensili mancanti",
  missing_annual: "Rate annuali mancanti",
  early_monthly: "Rate mensili creata in anticipo",
  early_annual: "Rate annuali creata prima del 13° mese",
  out_of_window_removable: "Rate fuori intervallo (senza incasso, bonificabili)",
  out_of_window_manual: "Rate fuori intervallo con incasso (solo revisione manuale)",
  duplicate_period: "Righe duplicate stesso mese (difensivo)",
};

const CATEGORY_HINT: Record<Category, string> = {
  missing_monthly: "Contratto ricorrente mensile senza la rata che dovrebbe già avere.",
  missing_annual: "Contratto ricorrente annuale senza la rata di competenza già scaduta.",
  early_monthly:
    "Rata creata oltre il mese in cui doveva essere generata: la regola è crearla solo nel mese dovuto.",
  early_annual:
    "Rata dell'anno successivo creata prima del 13° mese (com'era prima di questo fix, PR #18): ora si crea solo quando è dovuta.",
  out_of_window_removable:
    "Rata prima dell'ingresso in fornitura o dopo chiusura/switch: nessun incasso, si può chiudere.",
  out_of_window_manual:
    "Rata fuori intervallo ma con incasso/rendiconto: visiona l'elenco, poi usa Applica per eliminare solo le righe confermate (nessuna cancellazione automatica).",
  duplicate_period: "Più righe per lo stesso contratto e lo stesso mese: non dovrebbe succedere.",
};

const EMPTY_SCAN = {
  findings: [] as IntegrityRowFinding[],
  scannedContracts: 0,
  countsByCategory: {
    missing_monthly: 0,
    missing_annual: 0,
    early_monthly: 0,
    early_annual: 0,
    out_of_window_removable: 0,
    out_of_window_manual: 0,
    duplicate_period: 0,
  } as Record<Category, number>,
  rowsByCategory: {
    missing_monthly: 0,
    missing_annual: 0,
    early_monthly: 0,
    early_annual: 0,
    out_of_window_removable: 0,
    out_of_window_manual: 0,
    duplicate_period: 0,
  } as Record<Category, number>,
};

function sumCounts(counts: Record<Category, number>): number {
  return Object.values(counts).reduce((s, n) => s + n, 0);
}

export function ProvvigioniIntegrityPanel({
  collaboratorOptions,
  supplierOptions,
}: {
  collaboratorOptions: Array<{ id: string; name: string }>;
  supplierOptions: Array<{ name: string }>;
}) {
  const [scan, setScan] = useState<typeof EMPTY_SCAN | null>(null);
  const [podFindings, setPodFindings] = useState<PodDuplicateFinding[] | null>(null);
  const [podScanned, setPodScanned] = useState(0);
  const [podTruncated, setPodTruncated] = useState(false);
  const [phase, setPhase] = useState<"idle" | "scanning" | "applying">("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [applyDetails, setApplyDetails] = useState<
    Array<{ period: string; outcome: string; motivo?: string }>
  >([]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [selectedPodKeys, setSelectedPodKeys] = useState<Set<string>>(new Set());

  const [collabFilter, setCollabFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [totalsResult, setTotalsResult] = useState<{
    results: TotalsConsistencyResult[];
    scannedContracts: number;
    truncated: boolean;
  } | null>(null);

  const totalAnomalies = scan ? sumCounts(scan.countsByCategory) : 0;

  async function runScan() {
    setPhase("scanning");
    setError(null);
    setMessage(null);
    setApplyDetails([]);
    setConfirmed({});
    setSelectedPodKeys(new Set());

    const acc = {
      findings: [] as IntegrityRowFinding[],
      scannedContracts: 0,
      countsByCategory: { ...EMPTY_SCAN.countsByCategory },
      rowsByCategory: { ...EMPTY_SCAN.rowsByCategory },
    };
    let cursor: string | null = null;

    try {
      for (let guard = 0; guard < 300; guard++) {
        const res = await scanRecurringAnomaliesAction({ cursor });
        if (!res.ok) {
          setError(res.error);
          setPhase("idle");
          return;
        }
        acc.findings.push(...res.findings);
        acc.scannedContracts += res.scannedContracts;
        for (const key of Object.keys(acc.countsByCategory) as Category[]) {
          acc.countsByCategory[key] += res.countsByCategory[key];
          acc.rowsByCategory[key] += res.rowsByCategory[key];
        }
        setProgress(`Analizzati ${acc.scannedContracts} contratti ricorrenti…`);
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      setScan(acc);

      const podRes = await scanPodDuplicateAnomaliesAction();
      if (podRes.ok) {
        setPodFindings(podRes.findings);
        setPodScanned(podRes.scannedContracts);
        setPodTruncated(podRes.truncated);
      } else {
        setError(podRes.error);
      }
      setProgress(null);
      setPhase("idle");
    } catch (e) {
      setError(friendlyActionError(e));
      setProgress(null);
      setPhase("idle");
    }
  }

  function findingsByCategory(category: Category): IntegrityRowFinding[] {
    return scan?.findings.filter((f) => f.category === category) ?? [];
  }

  async function applyMissing() {
    const ids = [
      ...new Set(
        [...findingsByCategory("missing_monthly"), ...findingsByCategory("missing_annual")].map(
          (f) => f.contractId,
        ),
      ),
    ];
    if (ids.length === 0) return;
    setPhase("applying");
    setError(null);
    try {
      const res = await applyMissingProvvigioniRowsAction({ contractIds: ids });
      if (!res.ok) {
        setError(res.error);
      } else {
        const skipped = res.rowResults.filter((r) => r.outcome === "saltata").length;
        setMessage(
          `Esito: ${res.created} create, ${res.updated} aggiornate` +
            (skipped > 0 ? `, ${skipped} saltate` : "") +
            ` su ${res.contracts} contratti.`,
        );
        setApplyDetails(
          res.rowResults.map((r) => ({
            period: r.period,
            outcome:
              r.outcome === "creata"
                ? "creata"
                : r.outcome === "aggiornata"
                  ? "aggiornata"
                  : "saltata",
            motivo: r.motivo,
          })),
        );
        await runScan();
        return;
      }
    } catch (e) {
      setError(friendlyActionError(e));
    }
    setPhase("idle");
  }

  async function applyEarly() {
    const monthIds = [
      ...findingsByCategory("early_monthly"),
      ...findingsByCategory("early_annual"),
    ].flatMap((f) => f.periods.map((p) => p.monthId).filter((id): id is string => Boolean(id)));
    if (monthIds.length === 0) return;
    setPhase("applying");
    setError(null);
    try {
      const res = await applyEarlyRecurringCleanupAction({ monthIds });
      if (!res.ok) {
        setError(res.error);
      } else {
        setMessage(
          `Eliminate ${res.deleted} rate create in anticipo.` +
            (res.rejected > 0 ? ` ${res.rejected} non più valide (già aggiornate).` : ""),
        );
        await runScan();
        return;
      }
    } catch (e) {
      setError(friendlyActionError(e));
    }
    setPhase("idle");
  }

  async function applyOutOfWindowManual() {
    const monthIds = findingsByCategory("out_of_window_manual").flatMap((f) =>
      f.periods.map((p) => p.monthId).filter((id): id is string => Boolean(id)),
    );
    if (monthIds.length === 0) return;
    setPhase("applying");
    setError(null);
    setApplyDetails([]);
    try {
      let deleted = 0;
      let skipped = 0;
      const allResults: Array<{ period: string; outcome: string; motivo?: string }> = [];
      for (let i = 0; i < monthIds.length; i += 200) {
        const batch = monthIds.slice(i, i + 200);
        setProgress(
          `Eliminazione rate con incasso: ${Math.min(i + batch.length, monthIds.length)} / ${monthIds.length}…`,
        );
        const res = await applyManualOutOfWindowCleanupAction({ monthIds: batch });
        if (!res.ok) {
          setError(res.error);
          setProgress(null);
          setPhase("idle");
          return;
        }
        deleted += res.deleted;
        for (const row of res.rowResults) {
          if (row.outcome === "saltata") skipped += 1;
          allResults.push({
            period: row.period,
            outcome: row.outcome,
            motivo: row.motivo,
          });
        }
      }
      setProgress(null);
      setMessage(
        `Esito: ${deleted} eliminate, ${skipped} saltate (su ${monthIds.length} rate nell'elenco).`,
      );
      setApplyDetails(allResults);
      await runScan();
      return;
    } catch (e) {
      setError(friendlyActionError(e));
    }
    setProgress(null);
    setPhase("idle");
  }

  async function applyOutOfWindow() {
    const monthIds = findingsByCategory("out_of_window_removable").flatMap((f) =>
      f.periods.map((p) => p.monthId).filter((id): id is string => Boolean(id)),
    );
    if (monthIds.length === 0) return;
    setPhase("applying");
    setError(null);
    try {
      // Lotti da 100 (stesso limite del pannello Cestino esistente).
      let deleted = 0;
      for (let i = 0; i < monthIds.length; i += 100) {
        const res = await applyRecurringCleanupAction({ monthIds: monthIds.slice(i, i + 100) });
        if (!res.ok) {
          setError(res.error);
          setPhase("idle");
          return;
        }
        deleted += res.deleted;
      }
      setMessage(`Rimosse ${deleted} rate fuori intervallo senza incasso.`);
      await runScan();
      return;
    } catch (e) {
      setError(friendlyActionError(e));
    }
    setPhase("idle");
  }

  async function applyPodDuplicates() {
    const keys = [...selectedPodKeys];
    if (keys.length === 0) return;
    setPhase("applying");
    setError(null);
    try {
      const res = await applyPodDuplicateArchiveAction({ podKeys: keys });
      if (!res.ok) {
        setError(res.error);
      } else {
        setMessage(
          `Archiviati ${res.archived} contratti · ${res.keptMonthly} mensili in attesa · ${res.keptForStorno} restati per storno.`,
        );
        const podRes = await scanPodDuplicateAnomaliesAction();
        if (podRes.ok) {
          setPodFindings(podRes.findings);
          setPodScanned(podRes.scannedContracts);
          setSelectedPodKeys(new Set());
        }
      }
    } catch (e) {
      setError(friendlyActionError(e));
    }
    setPhase("idle");
  }

  async function runTotalsCheck() {
    setError(null);
    setTotalsResult(null);
    try {
      const res = await checkProvvigioniTotalsAction({
        collaboratorId: collabFilter || null,
        supplierName: supplierFilter || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTotalsResult(res);
    } catch (e) {
      setError(friendlyActionError(e));
    }
  }

  const busy = phase !== "idle";

  return (
    <section className="rounded-xl border border-red-200 bg-red-50/30 p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-slate-900">
        Controllo integrità provvigioni
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        Scansiona TUTTI i contratti e le rate ricorrenti (RecurringMonth) e
        segnala solo le anomalie secondo le regole di{" "}
        <code className="rounded bg-white px-1 text-xs">docs/regole-provvigioni.md</code>.
        Nessuna scrittura automatica: ogni bonifica ha Anteprima → Applica e
        conferma esplicita.
      </p>

      <Button type="button" variant="secondary" onClick={runScan} disabled={busy}>
        {phase === "scanning" ? "Analisi in corso…" : "1. Analizza tutto il database"}
      </Button>

      {progress ? <p className="mt-3 text-sm text-slate-600">{progress}</p> : null}
      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <p>{message}</p>
          {applyDetails.length > 0 ? (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-emerald-900">
              {applyDetails.slice(0, 80).map((row, i) => (
                <li key={`${row.period}-${i}`}>
                  {row.period}: <strong>{row.outcome}</strong>
                  {row.motivo ? ` — ${row.motivo}` : ""}
                </li>
              ))}
              {applyDetails.length > 80 ? (
                <li className="text-emerald-700">+ altre {applyDetails.length - 80} righe</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {scan ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat value={scan.scannedContracts} label="Contratti ricorrenti esaminati" />
            <Stat
              value={totalAnomalies}
              label="Contratti con anomalie"
              tone={totalAnomalies > 0 ? "text-red-700" : "text-emerald-700"}
            />
            <Stat
              value={podFindings?.length ?? 0}
              label={`Repliche POD non gestite (su ${podScanned} contratti)`}
              tone={(podFindings?.length ?? 0) > 0 ? "text-red-700" : "text-emerald-700"}
            />
          </div>

          {totalAnomalies === 0 && (podFindings?.length ?? 0) === 0 ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              Nessuna riga saltata: tutti i contratti ricorrenti hanno esattamente le
              righe previste dalle regole.
            </p>
          ) : null}

          <CategoryBlock
            title={CATEGORY_LABELS.missing_monthly + " / " + CATEGORY_LABELS.missing_annual}
            hint={CATEGORY_HINT.missing_monthly}
            findings={[...findingsByCategory("missing_monthly"), ...findingsByCategory("missing_annual")]}
            confirmKey="missing"
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            confirmLabel="Ho controllato l'elenco e confermo la creazione delle rate mancanti (Da incassare)."
            applyLabel="2. Crea le rate mancanti"
            onApply={applyMissing}
            busy={busy}
          />

          <CategoryBlock
            title={CATEGORY_LABELS.early_monthly + " / " + CATEGORY_LABELS.early_annual}
            hint={CATEGORY_HINT.early_annual}
            findings={[...findingsByCategory("early_monthly"), ...findingsByCategory("early_annual")]}
            confirmKey="early"
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            confirmLabel="Ho controllato l'elenco e confermo l'eliminazione delle rate create in anticipo (nessuna ha incasso)."
            applyLabel="2. Elimina le rate in anticipo"
            onApply={applyEarly}
            busy={busy}
          />

          <CategoryBlock
            title={CATEGORY_LABELS.out_of_window_removable}
            hint={CATEGORY_HINT.out_of_window_removable}
            findings={findingsByCategory("out_of_window_removable")}
            confirmKey="outOfWindow"
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            confirmLabel="Ho controllato l'elenco e confermo la rimozione delle rate fuori intervallo (nessuna ha incasso)."
            applyLabel="2. Rimuovi le rate fuori intervallo"
            onApply={applyOutOfWindow}
            busy={busy}
          />

          <CategoryBlock
            title={CATEGORY_LABELS.out_of_window_manual}
            hint={CATEGORY_HINT.out_of_window_manual}
            findings={findingsByCategory("out_of_window_manual")}
            confirmKey="outOfWindowManual"
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            confirmLabel="Ho visionato l'elenco e confermo l'eliminazione delle rate fuori intervallo che hanno già incasso o rendiconto (operazione irreversibile)."
            applyLabel="Applica"
            onApply={applyOutOfWindowManual}
            busy={busy}
          />

          <CategoryBlock
            title={CATEGORY_LABELS.duplicate_period}
            hint={CATEGORY_HINT.duplicate_period}
            findings={findingsByCategory("duplicate_period")}
            readOnly
          />

          {podFindings && podFindings.length > 0 ? (
            <div className="rounded-lg border border-orange-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Repliche POD non gestite ({podFindings.length})
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Nuovo contratto sullo stesso POD/PDR: il precedente doveva restare
                (in storno) o essere archiviato (fuori storno) e non lo è. Seleziona
                i POD e applica: userà la stessa regola di sempre.
              </p>
              {podTruncated ? (
                <p className="mt-1 text-xs text-amber-700">
                  Attenzione: più di {podScanned} contratti con POD/PDR nel database,
                  verifica parziale. Ripeti l&apos;analisi dopo aver bonificato questi
                  per controllare il resto.
                </p>
              ) : null}
              <div className="mt-3 max-h-72 overflow-auto rounded border border-slate-100">
                {podFindings.map((f) => (
                  <label
                    key={f.podKey}
                    className="flex items-start gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-0"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedPodKeys.has(f.podKey)}
                      onChange={(e) => {
                        const next = new Set(selectedPodKeys);
                        if (e.target.checked) next.add(f.podKey);
                        else next.delete(f.podKey);
                        setSelectedPodKeys(next);
                      }}
                    />
                    <div>
                      <p className="font-medium text-slate-900">
                        POD/PDR {f.podKey} · attuale: {f.latest.label}
                      </p>
                      {f.unhandled.map((u) => (
                        <p key={u.contractId} className="text-slate-500">
                          precedente non gestito: {u.label} (
                          {u.reason === "mensile_da_chiudere"
                            ? "mensile da chiudere"
                            : "fuori storno, da archiviare"}
                          )
                        </p>
                      ))}
                    </div>
                  </label>
                ))}
              </div>
              <Button
                type="button"
                className="mt-3"
                disabled={busy || selectedPodKeys.size === 0}
                onClick={applyPodDuplicates}
              >
                {phase === "applying"
                  ? "Applicazione in corso…"
                  : `Applica ai ${selectedPodKeys.size} POD selezionati`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Verifica totali</h3>
        <p className="mt-1 text-xs text-slate-500">
          Confronta il totale della card (Incassato / Da incassare / Pagato) con
          la somma indipendente delle righe visibili, con lo stesso filtro
          collaboratore/fornitore che useresti in Provvigioni o Report.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={collabFilter}
            onChange={(e) => setCollabFilter(e.target.value)}
          >
            <option value="">Tutti i collaboratori</option>
            {collaboratorOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
          >
            <option value="">Tutti i fornitori</option>
            {supplierOptions.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={runTotalsCheck}>
            Verifica
          </Button>
        </div>
        {totalsResult ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs text-slate-700">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Stato</th>
                  <th className="py-1 pr-3">Card (dichiarato)</th>
                  <th className="py-1 pr-3">Somma righe visibili</th>
                  <th className="py-1 pr-3">Differenza</th>
                </tr>
              </thead>
              <tbody>
                {totalsResult.results.map((r) => (
                  <tr key={r.stato} className="border-t border-slate-100">
                    <td className="py-1 pr-3 font-medium">{r.stato}</td>
                    <td className="py-1 pr-3">{r.declaredAmount.toFixed(2)} €</td>
                    <td className="py-1 pr-3">{r.rowsAmount.toFixed(2)} €</td>
                    <td
                      className={`py-1 pr-3 font-semibold ${r.ok ? "text-emerald-700" : "text-red-700"}`}
                    >
                      {r.ok ? "0,00 € (ok)" : `${r.diff.toFixed(2)} € — verificare il codice`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalsResult.truncated ? (
              <p className="mt-2 text-amber-700">
                Attenzione: più di {totalsResult.scannedContracts} contratti nello
                scope selezionato, verifica parziale.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CategoryBlock({
  title,
  hint,
  findings,
  readOnly,
  confirmKey,
  confirmed,
  setConfirmed,
  confirmLabel,
  applyLabel,
  onApply,
  busy,
}: {
  title: string;
  hint: string;
  findings: IntegrityRowFinding[];
  readOnly?: boolean;
  confirmKey?: string;
  confirmed?: Record<string, boolean>;
  setConfirmed?: (v: Record<string, boolean>) => void;
  confirmLabel?: string;
  applyLabel?: string;
  onApply?: () => void;
  busy?: boolean;
}) {
  const rowCount = useMemo(
    () => findings.reduce((s, f) => s + f.periods.length, 0),
    [findings],
  );
  if (findings.length === 0) return null;
  const isConfirmed = confirmKey ? Boolean(confirmed?.[confirmKey]) : false;

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">
        {title} — {findings.length} contratti · {rowCount} righe
      </summary>
      <p className="mt-2 text-xs text-slate-500">{hint}</p>
      <div className="mt-3 max-h-64 overflow-auto rounded border border-slate-100">
        {findings.slice(0, 200).map((f, i) => (
          <div
            key={`${f.contractId}-${i}`}
            className="border-b border-slate-100 px-3 py-2 text-xs last:border-0"
          >
            <p className="font-medium text-slate-900">{f.label}</p>
            <p className="text-slate-500">
              {f.collaboratorName} · {f.periods.map((p) => p.label).join(", ")}
              {f.detail ? ` · ${f.detail}` : ""}
            </p>
          </div>
        ))}
        {findings.length > 200 ? (
          <p className="px-3 py-2 text-xs text-slate-400">
            + altri {findings.length - 200} contratti (esegui di nuovo
            l&apos;analisi dopo la prima bonifica per vederli tutti).
          </p>
        ) : null}
      </div>
      {!readOnly && confirmKey && setConfirmed ? (
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isConfirmed}
              onChange={(e) => setConfirmed({ ...confirmed, [confirmKey]: e.target.checked })}
              disabled={busy}
            />
            {confirmLabel}
          </label>
          <Button type="button" onClick={onApply} disabled={busy || !isConfirmed}>
            {applyLabel}
          </Button>
        </div>
      ) : null}
    </details>
  );
}

function Stat({
  value,
  label,
  tone = "text-slate-900",
}: {
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
      <p className={`text-xl font-semibold ${tone}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
