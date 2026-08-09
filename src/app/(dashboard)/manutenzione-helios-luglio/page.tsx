import { resetHeliosJuly2026Action } from "@/lib/recurring-actions";

export default function ManutenzioneHeliosLuglioPage() {
  return (
    <form action={resetHeliosJuly2026Action} className="rounded-xl bg-white p-6">
      <h1 className="text-xl font-semibold">Correzione Helios luglio 2026</h1>
      <p className="my-4 text-sm">Riporta tutte le rate Helios di luglio a Da incassare.</p>
      <button className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white">Applica correzione autorizzata</button>
    </form>
  );
}
