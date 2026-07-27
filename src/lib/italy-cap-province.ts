/**
 * Zippopotam.it lascia vuota la sigla provincia ("state abbreviation").
 * Qui mappiamo CAP → sigla provincia (Poste / ISTAT, range indicativi).
 */
type CapRange = { from: number; to: number; sigla: string };

/** Range CAP → provincia (inclusivi). Ordine: range più specifici prima se servisse. */
const CAP_RANGES: CapRange[] = [
  // Valle d'Aosta / Piemonte
  { from: 11000, to: 11100, sigla: "AO" },
  { from: 10000, to: 10999, sigla: "TO" },
  { from: 12000, to: 12999, sigla: "CN" },
  { from: 13000, to: 13999, sigla: "VC" },
  { from: 14000, to: 14999, sigla: "AT" },
  { from: 15000, to: 15999, sigla: "AL" },
  { from: 28000, to: 28999, sigla: "NO" },
  { from: 28800, to: 28899, sigla: "VB" },
  { from: 13900, to: 13999, sigla: "BI" },
  // Lombardia
  { from: 20000, to: 20999, sigla: "MI" },
  { from: 21000, to: 21999, sigla: "VA" },
  { from: 22000, to: 22999, sigla: "CO" },
  { from: 23000, to: 23999, sigla: "SO" },
  { from: 23800, to: 23899, sigla: "LC" },
  { from: 24000, to: 24999, sigla: "BG" },
  { from: 25000, to: 25999, sigla: "BS" },
  { from: 26000, to: 26999, sigla: "CR" },
  { from: 27000, to: 27999, sigla: "PV" },
  { from: 46000, to: 46999, sigla: "MN" },
  { from: 20800, to: 20999, sigla: "MB" },
  // Trentino-Alto Adige / Veneto / Friuli
  { from: 38000, to: 38999, sigla: "TN" },
  { from: 39000, to: 39999, sigla: "BZ" },
  { from: 30000, to: 30999, sigla: "VE" },
  { from: 31000, to: 31999, sigla: "TV" },
  { from: 32000, to: 32999, sigla: "BL" },
  { from: 33000, to: 33999, sigla: "UD" },
  { from: 34000, to: 34170, sigla: "TS" },
  { from: 34170, to: 34999, sigla: "GO" },
  { from: 33070, to: 33099, sigla: "PN" },
  { from: 35000, to: 35999, sigla: "PD" },
  { from: 36000, to: 36999, sigla: "VI" },
  { from: 37000, to: 37999, sigla: "VR" },
  { from: 45000, to: 45999, sigla: "RO" },
  // Liguria / Emilia-Romagna
  { from: 16000, to: 16999, sigla: "GE" },
  { from: 17000, to: 17999, sigla: "SV" },
  { from: 18000, to: 18999, sigla: "IM" },
  { from: 19000, to: 19999, sigla: "SP" },
  { from: 40000, to: 40999, sigla: "BO" },
  { from: 29000, to: 29999, sigla: "PC" },
  { from: 43000, to: 43999, sigla: "PR" },
  { from: 42000, to: 42999, sigla: "RE" },
  { from: 41000, to: 41999, sigla: "MO" },
  { from: 44000, to: 44999, sigla: "FE" },
  { from: 48000, to: 48999, sigla: "RA" },
  { from: 47000, to: 47900, sigla: "FC" },
  { from: 47900, to: 47999, sigla: "RN" },
  // Toscana / Umbria / Marche / Lazio
  { from: 50000, to: 50999, sigla: "FI" },
  { from: 51000, to: 51999, sigla: "PT" },
  { from: 52000, to: 52999, sigla: "AR" },
  { from: 53000, to: 53999, sigla: "SI" },
  { from: 54000, to: 54999, sigla: "MS" },
  { from: 55000, to: 55999, sigla: "LU" },
  { from: 56000, to: 56999, sigla: "PI" },
  { from: 57000, to: 57999, sigla: "LI" },
  { from: 58000, to: 58999, sigla: "GR" },
  { from: 59000, to: 59999, sigla: "PO" },
  { from: 05000, to: 05999, sigla: "TR" },
  { from: 06000, to: 06999, sigla: "PG" },
  { from: 60000, to: 60999, sigla: "AN" },
  { from: 61000, to: 61999, sigla: "PU" },
  { from: 62000, to: 62999, sigla: "MC" },
  { from: 63000, to: 63999, sigla: "AP" },
  { from: 63800, to: 63999, sigla: "FM" },
  { from: 00000, to: 00999, sigla: "RM" },
  { from: 01000, to: 01999, sigla: "VT" },
  { from: 02000, to: 02999, sigla: "RI" },
  { from: 03000, to: 03999, sigla: "FR" },
  { from: 04000, to: 04999, sigla: "LT" },
  // Abruzzo / Molise
  { from: 64000, to: 64999, sigla: "TE" },
  { from: 65000, to: 65999, sigla: "PE" },
  { from: 66000, to: 66999, sigla: "CH" },
  { from: 67000, to: 67999, sigla: "AQ" },
  { from: 86000, to: 86999, sigla: "CB" },
  { from: 86070, to: 86099, sigla: "IS" },
  // Campania
  { from: 80000, to: 80999, sigla: "NA" },
  { from: 81000, to: 81999, sigla: "CE" },
  { from: 82000, to: 82999, sigla: "BN" },
  { from: 83000, to: 83999, sigla: "AV" },
  { from: 84000, to: 84999, sigla: "SA" },
  // Puglia / Basilicata / Calabria
  { from: 70000, to: 70999, sigla: "BA" },
  { from: 71000, to: 71999, sigla: "FG" },
  { from: 72000, to: 72999, sigla: "BR" },
  { from: 73000, to: 73999, sigla: "LE" },
  { from: 74000, to: 74999, sigla: "TA" },
  { from: 76000, to: 76999, sigla: "BT" },
  { from: 75000, to: 75999, sigla: "MT" },
  { from: 85000, to: 85999, sigla: "PZ" },
  { from: 87000, to: 87999, sigla: "CS" },
  { from: 88000, to: 88999, sigla: "CZ" },
  { from: 89000, to: 89999, sigla: "RC" },
  { from: 89800, to: 89999, sigla: "VV" },
  { from: 88800, to: 88899, sigla: "KR" },
  // Sicilia / Sardegna
  { from: 90000, to: 90999, sigla: "PA" },
  { from: 91000, to: 91999, sigla: "TP" },
  { from: 92000, to: 92999, sigla: "AG" },
  { from: 93000, to: 93999, sigla: "CL" },
  { from: 94000, to: 94999, sigla: "EN" },
  { from: 95000, to: 95999, sigla: "CT" },
  { from: 96000, to: 96999, sigla: "SR" },
  { from: 97000, to: 97999, sigla: "RG" },
  { from: 98000, to: 98999, sigla: "ME" },
  { from: 07000, to: 07999, sigla: "SS" },
  { from: 08000, to: 08999, sigla: "NU" },
  { from: 09000, to: 09100, sigla: "CA" },
  { from: 09010, to: 09099, sigla: "SU" },
  { from: 07020, to: 07029, sigla: "OT" },
  { from: 08020, to: 08029, sigla: "OG" },
  { from: 08030, to: 08049, sigla: "NU" },
];

/** Override puntuali CAP noti dove il range non basta (frazioni / conflitti). */
const CAP_OVERRIDE: Record<string, string> = {
  "85025": "PZ", // Melfi
  "75100": "MT", // Matera
};

/**
 * Da CAP a sigla provincia (2 lettere). Vuoto se sconosciuto.
 */
export function provinceSiglaFromCap(cap: string): string {
  const clean = String(cap ?? "").replace(/\D/g, "");
  if (clean.length !== 5) return "";
  if (CAP_OVERRIDE[clean]) return CAP_OVERRIDE[clean]!;
  const n = Number(clean);
  // Preferisci range più stretti: ordina per ampiezza crescente
  const sorted = [...CAP_RANGES].sort(
    (a, b) => a.to - a.from - (b.to - b.from),
  );
  for (const r of sorted) {
    if (n >= r.from && n <= r.to) return r.sigla;
  }
  return "";
}

/** Normalizza input provincia a sigla 2 lettere maiuscole. */
export function normalizeProvinceSigla(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
}
