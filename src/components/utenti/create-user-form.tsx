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
  allowedRoles,
  isAreaManager = false,
}: {
  suppliers: Opt[];
  collaborators: Opt[];
  /** Se impostato, limita i ruoli selezionabili (Area Manager). */
  allowedRoles?: AppRole[];
  isAreaManager?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const roleOptions = useMemo(() => {
    const entries = Object.entries(ROLE_LABELS) as [AppRole, string][];
    if (!allowedRoles?.length) return entries;
    return entries.filter(([v]) => allowedRoles.includes(v));
  }, [allowedRoles]);

  const [role, setRole] = useState<AppRole>(
    () => roleOptions[0]?.[0] ?? "COLLABORATORE",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supplierSelected, setSupplierSelected] = useState<Set<string>>(
    () => new Set(),
  );
  const [allSuppliers, setAllSuppliers] = useState(true);
  const [allCollaborators, setAllCollaborators] = useState(true);
  const [collabSelected, setCollabSelected] = useState<Set<string>>(
    () => new Set(),
  );

  const showSupplierScope =
    role === "BACKOFFICE" ||
    role === "AREA_MANAGER" ||
    role === "COLLABORATORE" ||
    role === "COMMERCIALE";
  const showCollabScope = role === "BACKOFFICE" || role === "AREA_MANAGER";
  const suppliersRequired = role === "BACKOFFICE";

  const roleHelp = useMemo(() => {
    if (role === "BACKOFFICE") {
      return "Il Backoffice vede solo i fornitori scelti. Con «Tutti i collaboratori» lavora con ogni commerciale/collaboratore su quei fornitori. Riceve le email delle pratiche da lavorare insieme all’Admin.";
    }
    if (role === "AREA_MANAGER") {
      return "L’Area Manager gestisce un team di collaboratori: può crearli e vedere i loro contratti. Puoi limitare i fornitori (tutti o solo alcuni).";
    }
    if (role === "COLLABORATORE" || role === "COMMERCIALE") {
      return "Puoi limitare i fornitori su cui può inserire/lavorare. «Tutti i fornitori» = nessun limite.";
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

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    fd.delete("supplierIds");
    fd.delete("collaboratorIds");
    fd.delete("allCollaborators");
    fd.delete("allSuppliers");

    if (allSuppliers) {
      fd.set("allSuppliers", "1");
    } else {
      fd.set("allSuppliers", "0");
      for (const id of supplierSelected) fd.append("supplierIds", id);
    }

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
        setMessage(res.error);
      } else {
        setMessage(
          isAreaManager
            ? "Collaboratore creato e aggiunto al tuo team."
            : "Utente creato.",
        );
      }
      (e.target as HTMLFormElement).reset();
      setRole(roleOptions[0]?.[0] ?? "COLLABORATORE");
      setSupplierSelected(new Set());
      setAllSuppliers(true);
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
        <Input name="password" type="password" required minLength={8} />
      </Field>
      <p className="md:col-span-2 -mt-2 text-xs text-slate-500">
        Minimo 8 caratteri, almeno una lettera e un numero (es.{" "}
        <code className="rounded bg-slate-100 px-1">Casa2026</code>).
      </p>
      <Field label="Ruolo">
        <Select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as AppRole)}
        >
          {roleOptions.map(([value, label]) => (
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

      {showSupplierScope ? (
        <div className="md:col-span-2 space-y-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">
              Fornitori{suppliersRequired ? " (obbligatorio)" : ""}
            </p>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={allSuppliers}
              onChange={() => {
                setAllSuppliers(true);
                setSupplierSelected(new Set());
              }}
            />
            <span>
              <strong>Tutti i fornitori</strong>
              <span className="mt-0.5 block text-xs text-slate-600">
                Nessun limite (consigliato per collaboratori / Area Manager).
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={!allSuppliers}
              onChange={() => setAllSuppliers(false)}
            />
            <span>
              <strong>Solo alcuni fornitori</strong>
            </span>
          </label>
          {!allSuppliers ? (
            <div>
              <div className="mb-2 flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-emerald-700 underline"
                  onClick={() =>
                    setSupplierSelected(new Set(suppliers.map((s) => s.id)))
                  }
                >
                  Seleziona tutti
                </button>
                <button
                  type="button"
                  className="text-slate-500 underline"
                  onClick={() => setSupplierSelected(new Set())}
                >
                  Nessuno
                </button>
              </div>
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
          ) : null}
        </div>
      ) : null}

      {showCollabScope ? (
        <div className="md:col-span-2 space-y-3">
          <p className="text-sm font-medium text-slate-800">
            {role === "AREA_MANAGER" ? "Team collaboratori" : "Collaboratori"}
          </p>
          <label className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm text-slate-800">
            <input
              type="radio"
              className="mt-1"
              checked={allCollaborators}
              onChange={() => {
                setAllCollaborators(true);
                setCollabSelected(new Set());
              }}
            />
            <span>
              <strong>
                {role === "AREA_MANAGER"
                  ? "Solo sé stessi per ora (aggiungi dopo)"
                  : "Tutti i collaboratori"}
              </strong>
              <span className="mt-0.5 block text-xs font-normal text-slate-600">
                {role === "AREA_MANAGER"
                  ? "Potrai creare collaboratori dopo: entreranno automaticamente nel team."
                  : "Vede i contratti di chiunque, ma solo sui fornitori sopra."}
              </span>
            </span>
          </label>
          {role === "BACKOFFICE" ? (
            <>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-800">
                <input
                  type="radio"
                  className="mt-1"
                  checked={!allCollaborators}
                  onChange={() => setAllCollaborators(false)}
                />
                <span>
                  <strong>Solo alcuni collaboratori</strong>
                </span>
              </label>
              {!allCollaborators ? (
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
              ) : null}
            </>
          ) : null}
        </div>
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
          {pending
            ? "Creazione…"
            : isAreaManager
              ? "Crea collaboratore"
              : "Crea utente"}
        </Button>
      </div>
    </form>
  );
}
