import "server-only";

/**
 * Autorizza i job `/api/cron/*`.
 * Solo header `Authorization: Bearer <CRON_SECRET>` — niente `?secret=`
 * (finirebbe nei log di accesso Vercel/CDN).
 */
export function authorizeCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}
