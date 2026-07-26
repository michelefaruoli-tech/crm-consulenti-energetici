"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateUserScopesAction } from "@/lib/user-actions";
import { Button } from "@/components/ui/button";
import type { AppRole } from "@/lib/constants";

type Opt = { id: string; name: string };

export function EditUserScopesForm({
  user,
  suppliers,
  collaborators,
  selectedSupplierIds,
  selectedCollaboratorIds,
}: {
  user: { id: string; name: string; role: AppRole };
  suppliers: Opt[];
  collaborators: Opt[];
  selectedSupplierIds: string[];
  selectedCollaboratorIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allCollaborators, setAllCollaborators] = useState(
    selectedCollaboratorIds.length === 0,
  );

  if (user.role !== "BACKOFFICE") return null;

  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Scope fornitori
      </Button>
    );
  }

  return (
    <form
      className="max-w-md space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);
        const fd = new FormData(e.currentTarget);
        if (allCollaborators) {
          fd.set("allCollaborators", "1");
          fd.delete("collaboratorIds");
        } else {
          fd.set("allCollaborators", "0");
        }
        const res = await updateUserScopesAction(fd);
        setSaving(false);
        if (res?.error) {
          setMessage(res.error);
          return;
        }
        setMessage("Salvato");
        setOpen(false);
        router.refresh();
      }}
    >
      <input type="hidden" name="userId" value={user.id} />
      <p className="text-sm font-medium text-slate-800">
        Scope di {user.name} (Backoffice)
      </p>
      <div>
        <div className="mb-1 flex justify-between gap-2">
          <p className="text-xs font-medium text-slate-600">Fornitori</p>
          <button
            type="button"
            className="text-xs text-emerald-700 underline"
            onClick={() => {
              const boxes = document.querySelectorAll<HTMLInputElement>(
                `input[data-scope-sup="${user.id}"]`,
              );
              boxes.forEach((b) => {
                b.checked = true;
              });
            }}
          >
            Seleziona tutti
          </button>
        </div>
        <div className="grid max-h-36 gap-1 overflow-y-auto text-sm">
          {suppliers.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="supplierIds"
                value={s.id}
                data-scope-sup={user.id}
                defaultChecked={selectedSupplierIds.includes(s.id)}
              />
              {s.name}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600">Collaboratori</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={allCollaborators}
            onChange={() => setAllCollaborators(true)}
          />
          Tutti i collaboratori
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={!allCollaborators}
            onChange={() => setAllCollaborators(false)}
          />
          Solo alcuni
        </label>
        {!allCollaborators ? (
          <div>
            <button
              type="button"
              className="mb-1 text-xs text-emerald-700 underline"
              onClick={() => {
                const boxes = document.querySelectorAll<HTMLInputElement>(
                  `input[data-scope-collab="${user.id}"]`,
                );
                boxes.forEach((b) => {
                  b.checked = true;
                });
              }}
            >
              Seleziona tutti
            </button>
            <div className="grid max-h-36 gap-1 overflow-y-auto text-sm">
              {collaborators.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="collaboratorIds"
                    value={c.id}
                    data-scope-collab={user.id}
                    defaultChecked={selectedCollaboratorIds.includes(c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Salvo…" : "Salva scope"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Annulla
        </Button>
      </div>
      {message ? <p className="text-xs text-slate-600">{message}</p> : null}
    </form>
  );
}
