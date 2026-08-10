/**
 * Euristiche nomi/cognomi italiani: ordine corretto, particelle, CF.
 * Usato per display, creazione da ricerca e correzione dati invertiti.
 */

/** Nomi di battesimo italiani più comuni (e varianti). */
const ITALIAN_FIRST_NAMES = new Set(
  [
    "alessandra",
    "alessandro",
    "alessio",
    "alfredo",
    "alice",
    "ambra",
    "andrea",
    "angela",
    "angelo",
    "anna",
    "annalisa",
    "antonella",
    "antonio",
    "assunta",
    "barbara",
    "beatrice",
    "benedetta",
    "biagio",
    "brunella",
    "bruno",
    "carlo",
    "carmela",
    "carmine",
    "caterina",
    "chiara",
    "cinzia",
    "claudia",
    "concetta",
    "cosimo",
    "cristina",
    "damiano",
    "daniela",
    "daniele",
    "davide",
    "diego",
    "domenico",
    "donatella",
    "edoardo",
    "elena",
    "elisa",
    "elvira",
    "emanuela",
    "emanuele",
    "enzo",
    "ernesto",
    "eugenio",
    "fabiana",
    "fabio",
    "fabrizio",
    "federica",
    "federico",
    "ferruccio",
    "filippo",
    "flavia",
    "francesca",
    "francesco",
    "franco",
    "gabriele",
    "gaetano",
    "gerardo",
    "giacomo",
    "giada",
    "gianluca",
    "gianni",
    "giorgia",
    "giorgio",
    "giovanna",
    "giovanni",
    "giulia",
    "giulio",
    "giuseppe",
    "giuseppina",
    "grazia",
    "graziano",
    "ilaria",
    "irene",
    "ivano",
    "jacopo",
    "loredana",
    "lorenzo",
    "luca",
    "lucia",
    "luciano",
    "luigi",
    "luisa",
    "manuela",
    "marcella",
    "marco",
    "maria",
    "mariangela",
    "marina",
    "mario",
    "marta",
    "martina",
    "massimo",
    "matilde",
    "matteo",
    "mattia",
    "maurizio",
    "michele",
    "mirko",
    "monica",
    "nadia",
    "nicola",
    "nicolo",
    "nicolò",
    "nunzia",
    "ornella",
    "paolo",
    "pasquale",
    "patrizia",
    "piero",
    "pietro",
    "raffaele",
    "raffaella",
    "riccardo",
    "roberta",
    "roberto",
    "rocco",
    "rosa",
    "rosario",
    "rossella",
    "sabrina",
    "salvatore",
    "samuele",
    "sandra",
    "sara",
    "serena",
    "sergio",
    "silvana",
    "silvia",
    "simona",
    "simone",
    "stefania",
    "stefano",
    "tiziana",
    "tiziano",
    "thomas",
    "tommaso",
    "umberto",
    "valentina",
    "valeria",
    "vincenzo",
    "vito",
    "vittorio",
    "luciano",
    "raffaela",
    "enrico",
    "manuel",
    "mariapia",
    "fulvio",
    "antonia",
    "antonino",
    "margherita",
    "bernardo",
    "laura",
    "leonardo",
    "giovanna",
  ].map((s) => s.toLowerCase()),
);

/** Particelle tipiche del cognome italiano (restano col cognome). */
const SURNAME_PARTICLES = new Set(
  [
    "de",
    "di",
    "del",
    "della",
    "dello",
    "dei",
    "degli",
    "da",
    "dal",
    "dalla",
    "dallo",
    "lo",
    "la",
    "li",
    "le",
    "san",
    "santa",
    "van",
    "von",
  ].map((s) => s.toLowerCase()),
);

function foldIt(s: string): string {
  return s
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function lettersOnly(s: string): string {
  return foldIt(s)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/** Codice CF a 3 lettere da cognome (regola standard). */
export function cfSurnameCode(surname: string): string {
  const up = lettersOnly(surname);
  const cons = [...up].filter((c) => !"AEIOU".includes(c));
  const vows = [...up].filter((c) => "AEIOU".includes(c));
  return (cons.join("") + vows.join("") + "XXX").slice(0, 3);
}

/**
 * Codice CF a 3 lettere da nome.
 * Con 4+ consonanti: 1ª, 3ª, 4ª (regola Agenzia Entrate).
 */
export function cfGivenNameCode(given: string): string {
  const up = lettersOnly(given);
  const cons = [...up].filter((c) => !"AEIOU".includes(c));
  const vows = [...up].filter((c) => "AEIOU".includes(c));
  if (cons.length >= 4) {
    return (cons[0] + cons[2] + cons[3]).slice(0, 3);
  }
  return (cons.join("") + vows.join("") + "XXX").slice(0, 3);
}

export function isLikelyItalianFirstName(word: string): boolean {
  const w = foldIt(word);
  if (!w) return false;
  if (ITALIAN_FIRST_NAMES.has(w)) return true;
  const parts = w.split(/\s+/).filter(Boolean);
  // Nomi composti (Maria Rosa): tutti i pezzi devono essere nomi noti (non bastano 1-2 lettere)
  if (parts.length <= 1) return false;
  return parts.every((p) => ITALIAN_FIRST_NAMES.has(p));
}

export function isSurnameParticle(word: string): boolean {
  return SURNAME_PARTICLES.has(foldIt(word));
}

function scoreAsGivenName(text: string): number {
  const t = foldIt(text);
  if (!t) return 0;
  let score = 0;
  if (ITALIAN_FIRST_NAMES.has(t)) score += 5;
  const parts = t.split(/\s+/);
  for (const p of parts) {
    if (ITALIAN_FIRST_NAMES.has(p)) score += 3;
    if (SURNAME_PARTICLES.has(p)) score -= 2;
  }
  // Nomi spesso più corti dei cognomi, ma non decisivo
  if (parts.length === 1 && t.length <= 8) score += 0.5;
  return score;
}

function scoreAsSurname(text: string): number {
  const t = foldIt(text);
  if (!t) return 0;
  let score = 0;
  const parts = t.split(/\s+/);
  if (parts.some((p) => SURNAME_PARTICLES.has(p))) score += 4;
  if (ITALIAN_FIRST_NAMES.has(t) && parts.length === 1) score -= 3;
  // Cognomi tipici lunghi / non in lista nomi
  if (!ITALIAN_FIRST_NAMES.has(t) && parts.length === 1) score += 1.5;
  for (const p of parts) {
    if (ITALIAN_FIRST_NAMES.has(p) && !SURNAME_PARTICLES.has(p)) score -= 1;
  }
  return score;
}

export type NameOrderSuggestion = {
  firstName: string;
  lastName: string;
  swapped: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
};

/**
 * Decide se firstName/lastName sono nell'ordine giusto.
 * Priorità: codice fiscale → euristica nomi italiani.
 */
export function suggestPersonNameOrder(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fiscalCode?: string | null,
): NameOrderSuggestion {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();

  if (!first && !last) {
    return { firstName: "", lastName: "", swapped: false, confidence: "low", reason: "vuoto" };
  }
  if (!first || !last) {
    return {
      firstName: first,
      lastName: last,
      swapped: false,
      confidence: "low",
      reason: "solo un campo valorizzato",
    };
  }

  const cf = (fiscalCode ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) {
    const cfSur = cf.slice(0, 3);
    const cfNam = cf.slice(3, 6);
    const normalScore =
      (cfSurnameCode(last) === cfSur ? 2 : 0) + (cfGivenNameCode(first) === cfNam ? 2 : 0);
    const swapScore =
      (cfSurnameCode(first) === cfSur ? 2 : 0) + (cfGivenNameCode(last) === cfNam ? 2 : 0);
    if (swapScore >= 3 && swapScore > normalScore) {
      return {
        firstName: last,
        lastName: first,
        swapped: true,
        confidence: "high",
        reason: "codice fiscale: nome/cognome invertiti",
      };
    }
    if (normalScore >= 3 && normalScore >= swapScore) {
      return {
        firstName: first,
        lastName: last,
        swapped: false,
        confidence: "high",
        reason: "codice fiscale conferma ordine",
      };
    }
  }

  const firstIsGiven = isLikelyItalianFirstName(first);
  const lastIsGiven = isLikelyItalianFirstName(last);
  const firstHasParticle = first.split(/\s+/).some((p) => isSurnameParticle(p));
  const lastHasParticle = last.split(/\s+/).some((p) => isSurnameParticle(p));

  // Entrambi sembrano nomi di battesimo → non auto-correggere (doppio nome / ambiguo)
  if (firstIsGiven && lastIsGiven) {
    return {
      firstName: first,
      lastName: last,
      swapped: false,
      confidence: "low",
      reason: "entrambi sembrano nomi di battesimo",
    };
  }

  // Cognome = nome tipico, Nome = non è un nome tipico (è il cognome) → invertiti
  if (lastIsGiven && !firstIsGiven) {
    return {
      firstName: last,
      lastName: first,
      swapped: true,
      confidence: "high",
      reason: "cognome sembra nome di battesimo, nome sembra cognome",
    };
  }

  // Particella del cognome finita nel campo Nome
  if (firstHasParticle && lastIsGiven && !lastHasParticle) {
    return {
      firstName: last,
      lastName: first,
      swapped: true,
      confidence: "high",
      reason: "particella cognome nel campo nome",
    };
  }

  const normal = scoreAsGivenName(first) + scoreAsSurname(last);
  const swappedScore = scoreAsGivenName(last) + scoreAsSurname(first);

  if (swappedScore >= normal + 5 && lastIsGiven && !firstIsGiven) {
    return {
      firstName: last,
      lastName: first,
      swapped: true,
      confidence: "medium",
      reason: "euristica nomi italiani: invertiti",
    };
  }

  return {
    firstName: first,
    lastName: last,
    swapped: false,
    confidence: normal >= swappedScore + 2 ? "medium" : "low",
    reason: "ordine attuale plausibile",
  };
}

/**
 * Spezza un testo libero in Nome + Cognome (per creazione da ricerca).
 * Accetta sia «Nome Cognome» sia «Cognome Nome» grazie alle euristiche.
 */
export function splitItalianPersonName(raw: string): {
  firstName: string;
  lastName: string;
} {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return { firstName: "", lastName: "" };

  const parts = text.split(" ");
  if (parts.length === 1) {
    // Una sola parola: meglio come cognome (elenchi IT) se non è nome noto
    if (isLikelyItalianFirstName(parts[0])) {
      return { firstName: parts[0], lastName: "" };
    }
    return { firstName: "", lastName: parts[0] };
  }

  // Particelle: «De Luca Marco» / «Marco De Luca»
  if (parts.length >= 3 && isSurnameParticle(parts[0])) {
    // Cognome Nome: De Luca Marco
    const maybeFirst = parts[parts.length - 1];
    if (isLikelyItalianFirstName(maybeFirst)) {
      return {
        firstName: maybeFirst,
        lastName: parts.slice(0, -1).join(" "),
      };
    }
  }
  if (parts.length >= 3 && isSurnameParticle(parts[1])) {
    // Nome Cognome: Marco De Luca
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
    };
  }

  // Due pezzi: prova entrambi gli ordini
  const a = parts[0];
  const b = parts.slice(1).join(" ");
  const asNomeCognome = suggestPersonNameOrder(a, b);
  const asCognomeNome = suggestPersonNameOrder(b, a);

  // Preferisci l'interpretazione con confidence migliore
  if (asNomeCognome.confidence === "high" && !asNomeCognome.swapped) {
    return { firstName: a, lastName: b };
  }
  if (asCognomeNome.confidence === "high" && !asCognomeNome.swapped) {
    return { firstName: b, lastName: a };
  }
  if (asNomeCognome.swapped && asNomeCognome.confidence !== "low") {
    return { firstName: asNomeCognome.firstName, lastName: asNomeCognome.lastName };
  }
  if (asCognomeNome.swapped && asCognomeNome.confidence !== "low") {
    return { firstName: asCognomeNome.firstName, lastName: asCognomeNome.lastName };
  }

  // Nome tipico in prima posizione → «Nome Cognome»
  if (isLikelyItalianFirstName(a) && !isLikelyItalianFirstName(b)) {
    return { firstName: a, lastName: b };
  }
  // Nome tipico in seconda posizione → «Cognome Nome» (come in Provvigioni)
  if (isLikelyItalianFirstName(b) && !isLikelyItalianFirstName(a)) {
    return { firstName: b, lastName: a };
  }
  // Entrambi sconosciuti: default = Cognome Nome (formato elenchi / cella Cliente)
  return { firstName: b, lastName: a };
}
