"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/form";
import { monthToDateRange } from "@/lib/report-month";

type MonthOpt = { value: string; label: string };

/**
 * Tendina "Mese intero" + Dal/Al.
 * Se scegli un mese (es. Luglio 2026), Dal/Al si impostano automaticamente
 * al 1° e all'ultimo giorno. Puoi ancora cambiare le date a mano (periodo libero).
 */
export function ReportPeriodFields({
  monthOptions,
  initialMonth,
  initialFrom,
  initialTo,
}: {
  monthOptions: MonthOpt[];
  initialMonth: string;
  initialFrom: string;
  initialTo: string;
}) {
  const [month, setMonth] = useState(initialMonth || "");
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  useEffect(() => {
    setMonth(initialMonth || "");
    setFrom(initialFrom);
    setTo(initialTo);
  }, [initialMonth, initialFrom, initialTo]);

  function applyMonth(value: string) {
    setMonth(value);
    if (!value) return;
    const range = monthToDateRange(value);
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    }
  }

  return (
    <>
      <Field label="Mese intero">
        <Select
          name="month"
          value={month}
          onChange={(e) => applyMonth(e.target.value)}
        >
          <option value="">Periodo personalizzato (usa Dal / Al)</option>
          {monthOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Dal">
        <Input
          type="date"
          name="from"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setMonth("");
          }}
        />
      </Field>
      <Field label="Al">
        <Input
          type="date"
          name="to"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setMonth("");
          }}
        />
      </Field>
    </>
  );
}
