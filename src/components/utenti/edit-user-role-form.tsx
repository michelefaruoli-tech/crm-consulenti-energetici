"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserRoleAction } from "@/lib/user-actions";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import {
  ROLE_LABELS,
  USER_PROMOTABLE_ROLES,
  USER_PROMOTION_ROLE_LABELS,
  type AppRole,
  type UserPromotableRole,
} from "@/lib/constants";

type Opt = { id: string; name: string };

function isPromotable(role: AppRole): role is UserPromotableRole {
  return (USER_PROMOTABLE_ROLES as readonly AppRole[]).includes(role);
}

export function EditUserRoleForm({
  user,
  suppliers,
  collaborators,
  selectedSupplierIds,
  selectedCollaboratorIds,
}: {
  user: { id: string; name: string; role: AppRole; email: string };
  suppliers: Opt[];
  collaborators: Opt[];
  selectedSupplierIds: string[];
  selectedCollaboratorIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const initialRole = isPromotable(user.role) ? user.role : "COLLABORATORE";
  const [role, setRole] = useState<UserPromotableRole>(initialRole);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [allSuppliers, setAllSuppliers] = useState(
    user.role !== "BACKOFFICE" && selectedSupplierIds.length === 0,
  );
  const [supplierId, setSupplierId] = useState(
    selectedSupplierIds[0] ?? suppliers[0]?.id ?? "",
  );
  const [allCollaborators, setAllCollaborators] = useState(
    selectedCollaboratorIds.length === 0,
  );
  const [collabSelected, setCollabSelected] = useState<Set<string>>(
    () => new Set(selectedCollaboratorIds),
  );

  const showSupplierScope =
    role === "BACKOFFICE" ||
    role === "AREA_MANAGER" ||
    role === "COLLABORATORE";
  const showCollabScope = role === "BACKOFFICE" || role === "AREA_MANAGER";
  const backofficeSingleSupplier = role === "BACKOFFICE";

  const roleHelp = useMemo(() => {
    if (role === "BACKOFFICE") {
      return "Back Office: un solo fornitore, tutti i collaboratori (o un sottoinsieme).";
    }
    if (role === "AREA_MANAGER") {
      return "Area Manager: team + eventuale limite fornitori.";
    }
    if (role === "ADMIN") {
      return "Amministratore: visibilità su Area Manager e produzione sottostante (permessi legacy ADMIN, non identico al Master Michele).";
    }
    if (role === "COLLABORATORE") {
      return "Collaboratore: inserisce contratti in produzione propria.";
    }
    return null;
  }, [role]);

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        Cambia ruolo
      </Button>
    );
  }

  function toggleCollab(id: string, checked: boolean) {
    setCollabSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    fd.delete("supplierIds");
    fd.delete("collaboratorIds");
    fd.delete("allCollaborators");
    fd.delete("allSuppliers");

    if (backofficeSingleSupplier) {
      fd.set("allSuppliers", "0");
      if (supplierId) fd.append("supplierIds", supplierId);
    } else if (allSuppliers) {
      fd.set("allSuppliers", "1");
    } else {
      fd.set("allSuppliers", "0");
      for (const id of parseIdsFromForm(e.currentTarget)) {
        fd.append("supplierIds", id);
      }
    }

    if (allCollaborators) {
      fd.set("allCollaborators", "1");
    } else {
      fd.set("allCollaborators", "0");
      for (const id of collabSelected) fd.append("collaboratorIds", id);
    }

    start(async () => {
      const res = await updateUserRoleAction(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setMessage("Ruolo aggiornato");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="max-w-md space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3"
    >
      <input type="hidden" name="userId" value={user.id} />
      <p className="text-sm font-medium text-slate-800">
        Ruolo di {user.name}
      </p>
      {!isPromotable(user.role) ? (
        <p className="text-xs text-amber-800">
          Ruolo attuale «{ROLE_LABELS[user.role]}»: non più assegnabile. Scegli
          un ruolo sotto per migrare l’account.
        </p>
      ) : null}

      <Field label="Nuovo ruolo">
        <Select
          name="role"
          value={role}
          onChange={(e) => {
            const next = e.target.value as UserPromotableRole;
            setRole(next);
            if (next === "BACKOFFICE") setAllSuppliers(false);
          }}
        >
          {USER_PROMOTABLE_ROLES.map((value) => (
            <option key={value} value={value}>
              {USER_PROMOTION_ROLE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      {roleHelp ? (
        <p className="text-xs text-slate-600">{roleHelp}</p>
      ) : null}

      {showSupplierScope ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">
            Fornitori
            {backofficeSingleSupplier ? " (uno obbligatorio)" : ""}
          </p>
          {backofficeSingleSupplier ? (
            <select
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
            >
              <option value="">— Seleziona fornitore —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={allSuppliers}
                  onChange={() => setAllSuppliers(true)}
                />
                Tutti i fornitori
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={!allSuppliers}
                  onChange={() => setAllSuppliers(false)}
                />
                Solo alcuni
              </label>
              {!allSuppliers ? (
                <div className="grid max-h-32 gap-1 overflow-y-auto text-sm">
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
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {showCollabScope ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">
            {role === "AREA_MANAGER" ? "Team" : "Collaboratori"}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={allCollaborators}
              onChange={() => setAllCollaborators(true)}
            />
            {role === "AREA_MANAGER"
              ? "Nessuno in lista (solo sé + creati dopo)"
              : "Tutti i collaboratori"}
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
            <div className="grid max-h-32 gap-1 overflow-y-auto text-sm">
              {collaborators.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={collabSelected.has(c.id)}
                    onChange={(e) => toggleCollab(c.id, e.target.checked)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-xs text-rose-700">{error}</p>
      ) : null}
      {message ? (
        <p className="text-xs text-emerald-700">{message}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvo…" : "Salva ruolo"}
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
    </form>
  );
}

function parseIdsFromForm(form: HTMLFormElement): string[] {
  return [
    ...new Set(
      Array.from(form.querySelectorAll<HTMLInputElement>('input[name="supplierIds"]:checked'))
        .map((el) => el.value)
        .filter(Boolean),
    ),
  ];
}
