import { GET } from "@/app/api/recurring-summary/route";

export const dynamic = "force-dynamic";

export default async function DiagnosticaRicorrenzePage() {
  const response = await GET();
  const data = await response.json();
  return (
    <main className="rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold">Riepilogo ricorrenze</h1>
      <pre className="mt-4 whitespace-pre-wrap text-sm">
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  );
}
