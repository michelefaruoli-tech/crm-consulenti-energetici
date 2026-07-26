"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createUserAction } from "@/lib/user-actions";
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
  const router = useRouter();
  const [pending, start] = useTransition();
  const [role, setRole] = useState<AppRole>("COLLABORATORE");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supplierSelected, setSupplierSelected] = useState<Set<string>>(
    () => new Set(),
  );
  /** true = vede tutti i collaboratori (nessuna riga in UserCollaboratorScope) */
  const [allCollaborators, setAllCollaborators] = useState(true);
  const [collabSelected, setCollabSelected] = useState<Set<string>>(
    () => new Set(),
  );

  const showScope = role === "BACKOFFICE";

  const roleHelp = useMemo(() => {
    if (role === "BACKOFFICE") {
      return "Il Backoffice vede solo i fornitori scelti. Con «Tutti i collaboratori» lavora con ogni commerciale/collaboratore su quei fornitori (anche i nuovi in futuro). Riceve le email delle pratiche da lavorare insieme all’Admin.";
    }
    return null;
  }, [role]);

  function toggleSet(
    set: Set<string>,
    id: string,
    checked: boolean,
  ): Set<string> {
    const next = new Set(set);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  }

  function selectAllSuppliers() {
    setSupplierSelected(new Set(suppliers.map((s) => s.id)));
  }

  function clearSuppliers() {
    setSupplierSelected(new Set());
  }

  function selectAllCollabs() {
    setAllCollaborators(false);
    setCollabSelected(new Set(collaborators.map((c) => c.id)));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    // Sovrascrivi checkbox controllati
    fd.delete("supplierIds");
    fd.delete("collaboratorIds");
    fd.delete("allCollaborators");
    for (const id of supplierSelected) fd.append("supplierIds", id);
    if (allCollaborators) {
      fd.set("allCollaborators", "1");
    } else {
      fd.set("allCollaborators", "0");
      for (const id of collabSelected) fd.append("collaboratorIds", id);
    }

    start(async () => {
      const res = await createUserAction(fd);
      if (res.error && !res.ok) {
        setError(res.error);
        return;
      }
      if (res.error && res.ok) {
        // Creato ma scope parziale
        setMessage(res.error);
      } else {
        setMessage("Utente creato.");
      }
      (e.target as HTMLFormElement).reset();
      setRole("COLLABORATORE");
      setSupplierSelected(new Set());
      setAllCollaborators(true);
      setCollabSelected(new Set());
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
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
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">
                Fornitori (obbligatorio)
              </p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-emerald-700 underline"
                  onClick={selectAllSuppliers}
                >
                  Seleziona tutti
                </button>
                <button
                  type="button"
                  className="text-slate-500 underline"
                  onClick={clearSuppliers}
                >
                  Nessuno
                </button>
              </div>
            </div>
            <p className="mb-2 text-xs text-slate-500">
              Es. solo Enel, oppure Dolomiti + Edison.
            </p>
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
              {suppliers.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={supplierSelected.has(s.id)}
                    onChange={(e) =>
                      setSupplierSelected((prev) =>
                        toggleSet(prev, s.id, e.target.checked),
                      )
                    }
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </div>

          <div className="md:col-span-2 space-y-3">
            <p className="text-sm font-medium text-slate-800">Collaboratori</p>
            <label className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm text-slate-800">
              <input
                type="radio"
                name="collabMode"
                className="mt-1"
                checked={allCollaborators}
                onChange={() => {
                  setAllCollaborators(true);
                  setCollabSelected(new Set());
                }}
              />
              <span>
                <strong>Tutti i collaboratori</strong>
                <span className="mt-0.5 block text-xs font-normal text-slate-600">
                  Consigliato. Vede i contratti di chiunque, ma solo sui
                  fornitori sopra (anche collaboratori aggiunti in futuro).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-800">
              <input
                type="radio"
                name="collabMode"
                className="mt-1"
                checked={!allCollaborators}
                onChange={() => setAllCollaborators(false)}
              />
              <span>
                <strong>Solo alcuni collaboratori</strong>
                <span className="mt-0.5 block text-xs font-normal text-slate-600">
                  Limita la vista a persone scelte (usa «Seleziona tutti» per
                  spuntarli tutti ora).
                </span>
              </span>
            </label>

            {!allCollaborators ? (
              <div>
                <div className="mb-2 flex gap-2 text-xs">
                  <button
                    type="button"
                    className="text-emerald-700 underline"
                    onClick={selectAllCollabs}
                  >
                    Seleziona tutti
                  </button>
                  <button
                    type="button"
                    className="text-slate-500 underline"
                    onClick={() => setCollabSelected(new Set())}
                  >
                    Nessuno
                  </button>
                </div>
                <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                  {collaborators.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={collabSelected.has(c.id)}
                        onChange={(e) =>
                          setCollabSelected((prev) =>
                            toggleSet(prev, c.id, e.target.checked),
                          )
                        }
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {error ? (
        <p className="md:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="md:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creazione…" : "Crea utente"}
        </Button>
      </div>
    </form>
  );
}
