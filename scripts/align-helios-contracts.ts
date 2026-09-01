/**
 * Allinea contratti Helios: ricorrente mensile (M), gettone €4/€6, rate mensili.
 * Idempotente — si può rilanciare.
 *
 * Uso: npx tsx scripts/align-helios-contracts.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { alignAllHeliosContracts } = await import("../src/lib/helios-align");
  const result = await alignAllHeliosContracts();
  console.log("Helios allineamento completato:");
  console.log(`  Contratti controllati: ${result.checked}`);
  console.log(`  Contratti aggiornati:   ${result.aligned}`);
  console.log(`  Rate sincronizzate:     ${result.synced}`);
  console.log(`  Regole listino:         ${result.listinoRules}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
