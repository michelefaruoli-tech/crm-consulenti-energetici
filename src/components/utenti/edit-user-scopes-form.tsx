"use client";

import { useState } from "react";
import { updateUserScopesAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";

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
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (user.role !== "BACKOFFICE") {
    return (
      <span className="text-xs text-slate-400">{ROLE_LABELS[user.role]}</span>
    );
  }

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
      action={async (fd) => {
        setMessage(null);
        const res = await updateUserScopesAction(fd);
        if (res?.error) setMessage(res.error);
        else {
          setMessage("Salvato");
          setOpen(false);
        }
      }}
    >
      <input type="hidden" name="userId" value={user.id} />
      <p className="text-sm font-medium text-slate-800">
        Scope di {user.name} (Backoffice)
      </p>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">Fornitori</p>
        <div className="grid max-h-36 gap-1 overflow-y-auto text-sm">
          {suppliers.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="supplierIds"
                value={s.id}
                defaultChecked={selectedSupplierIds.includes(s.id)}
              />
              {s.name}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">
          Collaboratori (opz.)
        </p>
        <div className="grid max-h-36 gap-1 overflow-y-auto text-sm">
          {collaborators.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="collaboratorIds"
                value={c.id}
                defaultChecked={selectedCollaboratorIds.includes(c.id)}
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          Salva scope
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
