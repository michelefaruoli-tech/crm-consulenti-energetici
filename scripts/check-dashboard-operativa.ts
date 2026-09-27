/**
 * P1.3 — Dashboard operativa (KPI economici, alert, azioni).
 * Uso: npx tsx scripts/check-dashboard-operativa.ts
 * Nessuna scrittura DB.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INCASSATO_NON_LIQUIDATO_DAYS,
  STALE_LAVORAZIONE_HOURS,
  buildDashboardQuickActions,
  buildOperativaKpiCards,
  resolveOperativaCompetenceMonth,
} from "../src/lib/dashboard-operativa";
import { provvigioniDeepLinkHref } from "../src/lib/provvigioni-deep-links";
import { resolveOptionalDashboardPeriod } from "../src/lib/storno-dashboard-kpi";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Soglie operative");
check("stale lavorazione 48h", STALE_LAVORAZIONE_HOURS, 48);
check("incassato non liquidato 30gg", INCASSATO_NON_LIQUIDATO_DAYS, 30);

console.log("\n• Competence mese ricorrenti");
check(
  "senza periodo → mese di now",
  resolveOperativaCompetenceMonth({
    now: new Date("2026-09-15T12:00:00.000Z"),
    period: null,
  }),
  "2026-09",
);
const period = resolveOptionalDashboardPeriod({ month: "2026-08" });
check(
  "con month filtro → 2026-08",
  resolveOperativaCompetenceMonth({
    now: new Date("2026-09-15T12:00:00.000Z"),
    period,
  }),
  "2026-08",
);

console.log("\n• Deep-link KPI / azioni");
check(
  "da incassare",
  provvigioniDeepLinkHref("da-incassare"),
  "/provvigioni?stato=Da+incassare",
);
check(
  "da liquidare",
  provvigioniDeepLinkHref("incassato-da-liquidare"),
  "/provvigioni?focus=incassato-da-liquidare",
);
check(
  "liquidato",
  provvigioniDeepLinkHref("liquidato"),
  "/provvigioni?stato=Liquidato",
);
check(
  "UT",
  provvigioniDeepLinkHref("ut-da-incassare"),
  "/provvigioni?focus=ut-da-incassare",
);
check(
  "M + competence",
  provvigioniDeepLinkHref("da-incassare-m", { competence: "2026-09" }),
  "/provvigioni?competence=2026-09&vista=mensile&stato=Da+incassare",
);

const money = {
  complessivo: 100,
  incassato: 40,
  daIncassare: 30,
  daIncassareUt: 10,
  daIncassareR: 20,
  ricorrenti: 50,
  liquidato: 25,
  daIncassareTotale: 80,
  incassatoFornitore: 65,
};
const cards = buildOperativaKpiCards({
  money,
  ricorrentiMese: 12,
  storni: { count: 3, amount: 0 },
  competence: "2026-09",
  period: null,
  linkExtras: {},
});
check("8 KPI economici", cards.length, 8);
check(
  "id KPI",
  cards.map((c) => c.id),
  [
    "da_incassare",
    "incassato_fornitore",
    "da_liquidare",
    "liquidato",
    "ut_da_incassare",
    "ricorrenti_mensili_mese",
    "ricorrenti_annuali",
    "storni_periodo",
  ],
);

const actions = buildDashboardQuickActions({});
check("7 azioni rapide", actions.length, 7);
check(
  "id azioni",
  actions.map((a) => a.id),
  [
    "nuovo_contratto",
    "pratiche_lavorare",
    "provvigioni_da_incassare",
    "da_liquidare",
    "importa_rendiconto",
    "anomalie",
    "genera_report",
  ],
);

console.log("\n• Wiring page / filtri deep-link");
const pageSrc = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/page.tsx"),
  "utf8",
);
check(
  "page importa DashboardOperativaSection",
  pageSrc.includes("DashboardOperativaSection"),
  true,
);
check(
  "page chiama loadOperativaAlerts",
  pageSrc.includes("loadOperativaAlerts"),
  true,
);
const contrattiSrc = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/contratti/page.tsx"),
  "utf8",
);
check(
  "contratti supporta ?status=",
  contrattiSrc.includes("CONTRATTI_STATUS_FILTER") &&
    contrattiSrc.includes("status?: string"),
  true,
);
const lavSrc = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/lavorazione/page.tsx"),
  "utf8",
);
check(
  "lavorazione supporta ?stale=",
  lavSrc.includes('stale?: string') && lavSrc.includes("staleOnly"),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} check falliti`);
  process.exit(1);
}
console.log("\nTutti i check P1.3 Dashboard operativa ok.\n");
