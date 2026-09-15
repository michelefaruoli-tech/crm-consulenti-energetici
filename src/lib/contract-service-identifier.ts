/** POD per LUCE, PDR per GAS. Non usare `pod || pdr` nei dual. */
export function serviceIdentifierLines(contract: {
  utilityType?: string | null;
  pod?: string | null;
  pdr?: string | null;
  podPdr?: string | null;
}): string[] {
  const utility = (contract.utilityType || "").trim().toUpperCase();
  const pod = (contract.pod ?? "").trim();
  const pdr = (contract.pdr ?? "").trim();
  const combined = (contract.podPdr ?? "").trim();

  if (utility === "GAS") {
    const value = pdr || combined;
    return value ? ["PDR", value] : [];
  }
  if (utility === "LUCE") {
    const value = pod || combined;
    return value ? ["POD", value] : [];
  }

  const lines: string[] = [];
  const podValue = pod || (/^IT/i.test(combined) ? combined : "");
  const pdrValue = pdr || (/^\d/.test(combined) && !/^IT/i.test(combined) ? combined : "");
  if (podValue) lines.push("POD", podValue);
  if (pdrValue) lines.push("PDR", pdrValue);
  if (lines.length === 0 && combined) lines.push("POD/PDR", combined);
  return lines;
}
