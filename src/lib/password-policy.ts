/**
 * Policy password unica per tutto il CRM (gratis, senza servizi esterni).
 * Regole: lunghezza minima 12, lettera + numero, blocklist comuni.
 */

export const PASSWORD_MIN_LENGTH = Number(
  process.env.PASSWORD_MIN_LENGTH ?? 12,
);

/** Password troppo comuni / banali (lowercase). */
const COMMON_PASSWORD_BLOCKLIST = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "123456789012",
  "qwerty123",
  "qwertyuiop",
  "admin123",
  "admin1234",
  "admin12345",
  "welcome1",
  "welcome12",
  "welcome123",
  "changeme",
  "changeme1",
  "letmein1",
  "letmein12",
  "crm123456789",
  "fmconsulenza",
  "fmconsulenza1",
  "consulenza1",
  "consulenza12",
  "consulente1",
  "provvigioni1",
]);

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
    "Non usare password comuni (es. Password123)",
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

  const lowered = p.toLowerCase();
  if (
    COMMON_PASSWORD_BLOCKLIST.has(lowered) ||
    /^password\d*$/i.test(p) ||
    /^admin\d+$/i.test(p) ||
    /^qwerty\d*$/i.test(p)
  ) {
    return {
      ok: false,
      error: "Password troppo comune: scegline una più difficile da indovinare",
      hints,
    };
  }

  const email = opts?.email?.trim().toLowerCase();
  if (email && lowered === email) {
    return {
      ok: false,
      error: "La password non può essere uguale all’email",
      hints,
    };
  }
  if (email) {
    const local = email.split("@")[0] ?? "";
    if (local.length >= 4 && lowered.includes(local)) {
      return {
        ok: false,
        error: "Non usare pezzi della tua email nella password",
        hints,
      };
    }
  }

  return { ok: true, hints };
}
