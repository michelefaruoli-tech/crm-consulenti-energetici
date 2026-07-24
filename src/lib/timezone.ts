import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const APP_TZ = "Europe/Rome";

/** YYYY-MM-DD in Europe/Rome */
export function romeDateString(date = new Date()): string {
  return formatInTimeZone(date, APP_TZ, "yyyy-MM-dd");
}

/** Inizio/fine giornata Europe/Rome come Date UTC */
export function romeDayBounds(dateYmd?: string): { start: Date; end: Date; reportDate: string } {
  const reportDate = dateYmd ?? romeDateString();
  const start = fromZonedTime(`${reportDate}T00:00:00`, APP_TZ);
  const end = fromZonedTime(`${reportDate}T23:59:59.999`, APP_TZ);
  return { start, end, reportDate };
}

export function formatRomeDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, APP_TZ, "dd/MM/yyyy HH:mm");
}
