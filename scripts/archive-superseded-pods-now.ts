/**
 * Archivia tutti i POD ricontrattualizzati (precedenti).
 * Uso: npx tsx scripts/archive-superseded-pods-now.ts
 */
import "dotenv/config";
import { archiveSupersededPodContracts } from "../src/lib/contract-pod-archive";

async function main() {
  const r = await archiveSupersededPodContracts();
  console.log("Archiviati contratti precedenti sullo stesso POD:", r.archived);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
