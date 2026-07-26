import "server-only";
import { headers } from "next/headers";

export type RequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

/** IP / User-Agent dalla richiesta (dietro Vercel proxy). */
export async function getRequestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ip =
      forwarded?.split(",")[0]?.trim() ||
      h.get("x-real-ip")?.trim() ||
      null;
    const userAgent = h.get("user-agent")?.slice(0, 400) || null;
    return { ipAddress: ip, userAgent };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}
