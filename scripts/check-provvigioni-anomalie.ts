/**
 * P1.1 B5 — vista Anomalie unificata (focus read-only).
 * Uso: npx tsx scripts/check-provvigioni-anomalie.ts
 *
 * Verifica mapping focus/where e composizione bucket. Nessuna scrittura DB.
 */
import {
  buildProvvigioniListWhere,
  fuoriStornoWhere,
  isAnomalieFocus,
  isBucketSpecificFocus,
  parseProvvigioniFocus,
} from "../src/lib/provvigioni-filters";
import {
  ANOMALIE_PREVIEW_LIMIT,
  anomalieFocusListHref,
  composeAnomalyBuckets,
} from "../src/lib/provvigioni-anomalies";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Parse focus B5 anomalie");
check("parse anomalie", parseProvvigioniFocus("anomalie"), "anomalie");
check("parse sconosciuto", parseProvvigioniFocus("altro"), undefined);
check("isAnomalieFocus", isAnomalieFocus("anomalie"), true);
check(
  "non confondere ricorrenze-mancanti",
  isAnomalieFocus("ricorrenze-mancanti"),
  false,
);
check(
  "bucket-specific (non AND card)",
  isBucketSpecificFocus("anomalie"),
  true,
);

console.log("\n• Where focus=anomalie = OR mancanti / Helios / fuori storno");
const baseFilters = {
  canViewAll: true,
  sessionUserId: "u1",
  visibility: {},
};
const whereAnomalie = buildProvvigioniListWhere({
  filters: baseFilters,
  focus: "anomalie",
});
const whereMancanti = buildProvvigioniListWhere({
  filters: baseFilters,
  focus: "ricorrenze-mancanti",
});
const whereFuori = buildProvvigioniListWhere({
  filters: baseFilters,
  focus: "fuori-storno",
});
const whereIncassato = buildProvvigioniListWhere({
  filters: baseFilters,
  focus: "incassato-da-liquidare",
});

check(
  "where anomalie ≠ solo ricorrenze-mancanti",
  JSON.stringify(whereAnomalie) === JSON.stringify(whereMancanti),
  false,
);
check(
  "where anomalie ≠ solo fuori-storno",
  JSON.stringify(whereAnomalie) === JSON.stringify(whereFuori),
  false,
);
check(
  "where anomalie ≠ Incassato da liquidare",
  JSON.stringify(whereAnomalie) === JSON.stringify(whereIncassato),
  false,
);

const serialized = JSON.stringify(whereAnomalie);
check(
  "include ASSENTE_RENDICONTO",
  serialized.includes("ASSENTE_RENDICONTO"),
  true,
);
check(
  "include MISSING/PENDING",
  serialized.includes("MISSING") && serialized.includes("PENDING"),
  true,
);
check(
  "include ramo fuori storno (stornoEndDate)",
  serialized.includes("stornoEndDate"),
  true,
);

console.log("\n• fuoriStornoWhere invariato (storni critici)");
const fs = fuoriStornoWhere(new Date("2026-09-27T12:00:00Z"));
check("ha OR stornoEndDate / stornoMonths", Array.isArray(fs.OR), true);

console.log("\n• Composizione bucket (pura, D4 read-only → Backup)");
const overview = composeAnomalyBuckets({
  missingCount: 2,
  heliosAbsentCount: 1,
  missingPreview: [
    {
      id: "m1",
      label: "Cliente A · Helios · set 2026",
      href: "/contratti/c1",
    },
  ],
  heliosPreview: [
    {
      id: "h1",
      label: "Cliente B · Helios · ago 2026",
      href: "/contratti/c2",
    },
  ],
  fuoriCount: 3,
  fuoriTruncated: false,
  fuoriRows: [],
  podCount: 0,
  podTruncated: false,
  podRows: [],
  queryBase: { settled: "2026-09" },
});

check("4 bucket", overview.buckets.length, 4);
check(
  "ids bucket",
  overview.buckets.map((b) => b.id),
  ["rate_mancanti", "assenti_helios", "fuori_storno", "duplicati_pod"],
);
check("count mancanti", overview.buckets[0]?.count, 2);
check("count helios", overview.buckets[1]?.count, 1);
check("count fuori", overview.buckets[2]?.count, 3);
check("totalCount", overview.totalCount, 6);
check(
  "backup punta a integrità",
  overview.backupHref,
  "/backup#integrita",
);
check(
  "listHref ricorrenze-mancanti",
  overview.buckets[0]?.listHref,
  anomalieFocusListHref("ricorrenze-mancanti", { settled: "2026-09" }),
);
check(
  "listHref fuori-storno",
  overview.buckets[2]?.listHref?.includes("focus=fuori-storno") ?? false,
  true,
);
check("mancanti truncated (preview < count)", overview.buckets[0]?.truncated, true);
check(
  "preview limit costante",
  ANOMALIE_PREVIEW_LIMIT >= 10,
  true,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche B5 Anomalie fallite.`);
  process.exit(1);
}
console.log("\n✅ Vista Anomalie unificata (B5): ok.");
