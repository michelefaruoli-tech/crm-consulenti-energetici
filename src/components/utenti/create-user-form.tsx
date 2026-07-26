"use client";

import { useMemo, useState } from "react";
import { createUserAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";

type Opt = { id: string; name: string };

export function CreateUserForm({
  suppliers,
  collaborators,
}: {
  suppliers: Opt[];
  collaborators: Opt[];
}) {
  const [role, setRole] = useState<AppRole>("COLLABORATORE");
  const showScope = role === "BACKOFFICE";

  const roleHelp = useMemo(() => {
    if (role === "BACKOFFICE") {
      return "Il Backoffice vede solo i fornitori (e, se scelti, i collaboratori) che assegni qui. Riceve le email delle pratiche «da lavorare» di quei fornitori, insieme all’Admin.";
    }
    return null;
  }, [role]);

  return (
    <form
      action={createUserAction}
      className="grid max-w-3xl gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2"
    >
      <Field label="Nome">
        <Input name="name" required />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" required minLength={6} />
      </Field>
      <Field label="Ruolo">
        <Select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as AppRole)}
        >
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>

      {roleHelp ? (
        <p className="md:col-span-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {roleHelp}
        </p>
      ) : null}

      {showScope ? (
        <>
          <div className="md:col-span-2">
            <p className="mb-2 text-sm font-medium text-slate-800">
              Fornitori che può vedere / ricevere email
            </p>
            <p className="mb-2 text-xs text-slate-500">
              Es. seleziona solo Enel per i due backoffice Enel; Dolomiti + Edison
              per l’altro backoffice.
            </p>
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
              {suppliers.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input type="checkbox" name="supplierIds" value={s.id} />
                  {s.name}
                </label>
              ))}
              {suppliers.length === 0 ? (
                <p className="text-sm text-slate-500">Nessun fornitore attivo.</p>
              ) : null}
            </div>
          </div>
          <div className="md:col-span-2">
            <p className="mb-2 text-sm font-medium text-slate-800">
              Collaboratori (opzionale)
            </p>
            <p className="mb-2 text-xs text-slate-500">
              Se non selezioni nessuno, vede i contratti di <strong>tutti</strong>{" "}
              i collaboratori, ma solo dei fornitori sopra. Se selezioni qualcuno,
              vede solo quei collaboratori.
            </p>
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
              {collaborators.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input type="checkbox" name="collaboratorIds" value={c.id} />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <div className="md:col-span-2">
        <Button type="submit">Crea utente</Button>
      </div>
    </form>
  );
}
