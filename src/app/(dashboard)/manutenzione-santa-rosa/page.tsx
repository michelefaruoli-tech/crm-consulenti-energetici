import { markSantaRosaPaidThroughJulyAction } from "@/lib/recurring-actions";

export default function ManutenzioneSantaRosaPage() {
  return (
    <form action={markSantaRosaPaidThroughJulyAction} className="rounded-xl bg-white p-6">
      <h1 className="text-xl font-semibold">Correzione Santa Rosa</h1>
      <p className="my-4 text-sm">Segna pagate tutte le ricorrenze fino a luglio 2026.</p>
      <button className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white">
        Applica correzione autorizzata
      </button>
    </form>
  );
}
