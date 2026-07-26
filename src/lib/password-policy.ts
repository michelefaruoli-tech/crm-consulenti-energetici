/**
 * Policy password unica per tutto il CRM (gratis, senza servizi esterni).
 * Regole semplici ma utili: lunghezza + lettera + numero.
 */

export const PASSWORD_MIN_LENGTH = Number(
  process.env.PASSWORD_MIN_LENGTH ?? 8,
);

export type PasswordCheck = {
  ok: boolean;
  error?: string;
  /** Suggerimenti per l’utente (anche se ok) */
  hints: string[];
};

export function passwordPolicyHints(): string[] {
  return [
    `Almeno ${PASSWORD_MIN_LENGTH} caratteri`,
    "Almeno una lettera",
    "Almeno un numero",
    "Meglio se diversa dall’email",
  ];
}

/** Validazione password (creazione / cambio / reset). */
export function validatePassword(
  password: string,
  opts?: { email?: string | null },
): PasswordCheck {
  const hints = passwordPolicyHints();
  const p = password ?? "";

  if (p.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri`,
      hints,
    };
  }
  if (!/[a-zA-ZàèéìòùÀÈÉÌÒÙ]/.test(p)) {
    return {
      ok: false,
      error: "La password deve contenere almeno una lettera",
      hints,
    };
  }
  if (!/[0-9]/.test(p)) {
    return {
      ok: false,
      error: "La password deve contenere almeno un numero",
      hints,
    };
  }

  const email = opts?.email?.trim().toLowerCase();
  if (email && p.toLowerCase() === email) {
    return {
      ok: false,
      error: "La password non può essere uguale all’email",
      hints,
    };
  }
  if (email) {
    const local = email.split("@")[0] ?? "";
    if (local.length >= 4 && p.toLowerCase().includes(local)) {
      return {
        ok: false,
        error: "Non usare pezzi della tua email nella password",
        hints,
      };
    }
  }

  return { ok: true, hints };
}
