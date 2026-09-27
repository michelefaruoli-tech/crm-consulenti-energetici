/**
 * P1.2 B3 — peer stesso POD (ordinamento, switch certo/possibile, campi).
 * Uso: npx tsx scripts/check-contract-pod-peers.ts
 *
 * Non tocca regole archivio / latest / Helios.
 */
import {
  buildContractPodPeerRows,
  podPeerSwitchHintLabel,
  resolvePodPeerSwitchHint,
  type ContractPodPeerInput,
} from "../src/lib/contract-pod-peers";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Switch certo / possibile");
check("CAMBIO → certo", resolvePodPeerSwitchHint("CAMBIO"), "switch_certo");
check("SWITCH → certo", resolvePodPeerSwitchHint("SWITCH"), "switch_certo");
check(
  "cambio_fornitore → certo",
  resolvePodPeerSwitchHint("CAMBIO_FORNITORE"),
  "switch_certo",
);
check("VOLTURA → possibile", resolvePodPeerSwitchHint("VOLTURA"), "switch_possibile");
check(
  "ATTIVAZIONE → possibile",
  resolvePodPeerSwitchHint("ATTIVAZIONE"),
  "switch_possibile",
);
check("vuoto → possibile", resolvePodPeerSwitchHint(null), "switch_possibile");
check(
  "label certo",
  podPeerSwitchHintLabel("switch_certo"),
  "switch certo",
);
check(
  "label possibile",
  podPeerSwitchHintLabel("switch_possibile"),
  "switch possibile",
);

const baseClient = {
  type: "PERSONA_FISICA",
  firstName: "Mario",
  lastName: "Rossi",
  companyName: null as string | null,
};

function peer(
  partial: Partial<ContractPodPeerInput> &
    Pick<ContractPodPeerInput, "id" | "contractNumber" | "supplierId">,
): ContractPodPeerInput {
  return {
    clientId: "cli-1",
    status: "PAGATO",
    operationType: "CAMBIO",
    podPdr: "IT001E12345678",
    pod: "IT001E12345678",
    pdr: null,
    utilityType: "LUCE",
    serviceOther: null,
    productName: null,
    supplyStartDate: new Date("2026-06-01"),
    insertionDate: new Date("2026-04-15"),
    createdAt: new Date("2026-04-15"),
    collectionDate: new Date("2026-06-01"),
    stornoEndDate: null,
    expiryDate: null,
    durationMonths: 12,
    isHistorical: false,
    recurrence: "UNA_TANTUM",
    client: baseClient,
    supplier: { name: "Helios", stornoMonths: 12 },
    service: { name: "Luce" },
    commission: null,
    ...partial,
  };
}

console.log("\n• Ordinamento per inizio fornitura (recente → vecchio)");
const rows = buildContractPodPeerRows(
  [
    peer({
      id: "old",
      contractNumber: "C-OLD",
      supplierId: "sup-a",
      supplyStartDate: new Date("2025-01-01"),
      operationType: "VOLTURA",
      supplier: { name: "Enel", stornoMonths: 12 },
    }),
    peer({
      id: "new",
      contractNumber: "C-NEW",
      supplierId: "sup-b",
      supplyStartDate: new Date("2026-09-01"),
      operationType: "SWITCH",
      supplier: { name: "Helios", stornoMonths: 12 },
    }),
    peer({
      id: "mid",
      contractNumber: "C-MID",
      supplierId: "sup-a",
      supplyStartDate: new Date("2026-03-01"),
      isHistorical: true,
      supplier: { name: "Enel", stornoMonths: 12 },
    }),
  ],
  { currentId: "new", podKey: "IT001E12345678" },
);

check(
  "ordine id",
  rows.map((r) => r.id),
  ["new", "mid", "old"],
);
check("current flagged", rows.find((r) => r.id === "new")?.isCurrent, true);
check(
  "cross-fornitore incluso",
  [...new Set(rows.map((r) => r.supplierName))].sort(),
  ["Enel", "Helios"],
);
check(
  "new switch certo",
  rows.find((r) => r.id === "new")?.switchHintLabel,
  "switch certo",
);
check(
  "old switch possibile",
  rows.find((r) => r.id === "old")?.switchHintLabel,
  "switch possibile",
);
check(
  "mid storico badge",
  rows.find((r) => r.id === "mid")?.badges.some((b) => b.id === "storico"),
  true,
);
check(
  "campi obbligatori presenti",
  Boolean(
    rows[0]?.contractNumber &&
      rows[0]?.clientName &&
      rows[0]?.supplierName &&
      rows[0]?.serviceLabel &&
      rows[0]?.supplyStartLabel,
  ),
  true,
);

console.log("\n• POD diverso escluso");
const filtered = buildContractPodPeerRows(
  [
    peer({ id: "a", contractNumber: "A", supplierId: "s1" }),
    peer({
      id: "b",
      contractNumber: "B",
      supplierId: "s1",
      podPdr: "IT999E99999999",
      pod: "IT999E99999999",
    }),
  ],
  { currentId: "a", podKey: "it001e12345678" },
);
check("solo stesso POD", filtered.map((r) => r.id), ["a"]);

console.log("\n• POD troppo corto → lista vuota");
check(
  "key corta",
  buildContractPodPeerRows(
    [peer({ id: "x", contractNumber: "X", supplierId: "s" })],
    { currentId: "x", podKey: "IT" },
  ).length,
  0,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche B3 peer POD fallite.`);
  process.exit(1);
}
console.log("\n✅ Contratti sullo stesso POD (B3): ok.");
