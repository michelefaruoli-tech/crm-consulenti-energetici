/**
 * P1.1 B8 — deep-link Dashboard / KPI → viste Provvigioni (focus first-class).
 * Zero migration: solo URL; alias legacy restano validi via parse/resolve.
 */

export type ProvvigioniDeepLinkTarget =
  | "incassato-da-liquidare"
  | "ut-da-incassare"
  | "anomalie"
  | "da-confermare"
  | "ricorrenze-mancanti"
  | "fuori-storno"
  | "da-incassare-m"
  | "da-incassare-r"
  | "da-incassare"
  | "liquidato"
  | "stornato"
  | "tutti";

/**
 * Costruisce href Provvigioni per le viste P1.1.
 * `extras` conserva collab/settled/competence/vista (non sovrascrive focus/stato del target).
 */
export function provvigioniDeepLinkHref(
  target: ProvvigioniDeepLinkTarget,
  extras?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (!v) continue;
      if (k === "focus" || k === "stato") continue;
      params.set(k, v);
    }
  }

  switch (target) {
    case "incassato-da-liquidare":
    case "ut-da-incassare":
    case "anomalie":
    case "da-confermare":
    case "ricorrenze-mancanti":
    case "fuori-storno":
      // Vista resta se passata in extras (es. rendiconto mensile + coda).
      params.set("focus", target);
      break;
    case "da-incassare-m":
      params.set("vista", "mensile");
      params.set("stato", "Da incassare");
      break;
    case "da-incassare-r":
      params.set("vista", "annuale");
      params.set("stato", "Da incassare");
      break;
    case "da-incassare":
      params.set("stato", "Da incassare");
      break;
    case "liquidato":
      params.set("stato", "Liquidato");
      break;
    case "stornato":
      params.set("stato", "Stornato");
      break;
    case "tutti":
      break;
  }

  const q = params.toString();
  return q ? `/provvigioni?${q}` : "/provvigioni";
}

/**
 * Alias URL legacy (bookmark / link vecchi) → stesso href canonico B8.
 * Usato dai check e dalla documentazione deep-link.
 */
export function canonicalizeProvvigioniDeepLinkQuery(opts: {
  focus?: string | null;
  stato?: string | null;
  vista?: string | null;
}): string {
  const focusRaw = opts.focus?.trim().toLowerCase().replace(/_/g, "-") ?? "";
  const statoRaw = (opts.stato ?? "").trim();
  const vista = opts.vista?.trim().toLowerCase() ?? "";

  if (
    focusRaw === "incassato-da-liquidare" ||
    focusRaw === "incassato" ||
    focusRaw === "incassatodaliquidare"
  ) {
    return provvigioniDeepLinkHref("incassato-da-liquidare");
  }
  if (
    focusRaw === "ut-da-incassare" ||
    focusRaw === "ut" ||
    focusRaw === "una-tantum-da-incassare"
  ) {
    return provvigioniDeepLinkHref("ut-da-incassare");
  }
  if (focusRaw === "anomalie" || focusRaw === "anomalie-unificate") {
    return provvigioniDeepLinkHref("anomalie");
  }
  if (focusRaw === "da-confermare") {
    return provvigioniDeepLinkHref("da-confermare");
  }
  if (focusRaw === "ricorrenze-mancanti") {
    return provvigioniDeepLinkHref("ricorrenze-mancanti");
  }
  if (focusRaw === "fuori-storno") {
    return provvigioniDeepLinkHref("fuori-storno");
  }

  const statoNorm = statoRaw
    .replace(/\+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  if (
    statoNorm === "incassato" ||
    statoNorm === "incassato da liquidare"
  ) {
    return provvigioniDeepLinkHref("incassato-da-liquidare");
  }
  if (statoNorm === "pagato" || statoNorm === "liquidato") {
    return provvigioniDeepLinkHref("liquidato");
  }
  if (statoNorm === "stornato") {
    return provvigioniDeepLinkHref("stornato");
  }
  if (statoNorm === "da incassare") {
    if (vista === "mensile" || vista === "ricorrente") {
      return provvigioniDeepLinkHref("da-incassare-m");
    }
    if (vista === "annuale") {
      return provvigioniDeepLinkHref("da-incassare-r");
    }
    return provvigioniDeepLinkHref("da-incassare");
  }

  return provvigioniDeepLinkHref("tutti");
}
