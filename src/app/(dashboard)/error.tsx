"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold text-slate-900">Errore di caricamento</h2>
      <p className="max-w-md text-sm text-slate-600">
        {error.message || "Si è verificato un errore sul server."}
      </p>
      {error.digest ? (
        <p className="text-xs text-slate-400">Codice: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Riprova
      </button>
    </div>
  );
}
