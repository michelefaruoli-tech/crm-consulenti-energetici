"use client";

import { useRouter } from "next/navigation";
import { deleteContractRowAction, deleteClientRowAction } from "@/lib/delete-actions";

export function DeleteRowButton({
  kind,
  id,
  label = "Elimina",
}: {
  kind: "contract" | "client";
  id: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50"
      title="Elimina definitivamente"
      onClick={(e) => {
        e.stopPropagation();
        if (
          !confirm(
            kind === "contract"
              ? "Eliminare questo contratto? L'operazione non si può annullare."
              : "Eliminare questo cliente e tutti i suoi contratti?",
          )
        ) {
          return;
        }
        const fd = new FormData();
        if (kind === "contract") {
          fd.set("contractId", id);
          void deleteContractRowAction(fd).then(() => router.refresh());
        } else {
          fd.set("clientId", id);
          void deleteClientRowAction(fd).then(() => router.refresh());
        }
      }}
    >
      {label}
    </button>
  );
}
