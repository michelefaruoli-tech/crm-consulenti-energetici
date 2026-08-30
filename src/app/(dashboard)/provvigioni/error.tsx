"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ProvvigioniError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Provvigioni]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-rose-200 bg-rose-50 p-6">
      <h2 className="text-lg font-semibold text-rose-950">
        Errore caricamento Provvigioni
      </h2>
      <p className="text-sm text-rose-900/90">
        La pagina non è riuscita a caricarsi. Prova a ricaricare o torna alla
        lista senza filtri pesanti (es. «Incassato» su tutti i mesi con molte
        righe).
      </p>
      {error.digest ? (
        <p className="text-xs text-rose-800/70">Riferimento: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => reset()}>
          Riprova
        </Button>
        <Link href="/provvigioni">
          <Button type="button" variant="secondary">
            Provvigioni (reset filtri)
          </Button>
        </Link>
      </div>
    </div>
  );
}
