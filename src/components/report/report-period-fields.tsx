"use client";

import { useEffect, useState } from "react";
import { Field, Input } from "@/components/ui/form";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import {
  REPORT_ALL_PERIODS,
  isReportAllPeriods,
  monthToDateRange,
  parseMonthList,
} from "@/lib/report-month";

type MonthOpt = { value: string; label: string };

/**
 * Tendina multi-mese + Dal/Al.
 * Spunta uno o più mesi (es. Maggio + Giugno): Dal/Al si impostano
 * al 1° del mese più vecchio e all'ultimo del più recente.
 * «Tutti i periodi» = stessa card Provvigioni senza filtro mese.
 * Se cambi Dal/Al a mano, la tendina mesi si svuota (periodo libero).
 */
export function ReportPeriodFields({
  monthOptions,
  initialMonth,
  initialFrom,
  initialTo,
}: {
  monthOptions: MonthOpt[];
  /** Uno o più mesi YYYY-MM uniti con `|`, oppure `all` */
  initialMonth: string;
  initialFrom: string;
  initialTo: string;
}) {
  const [months, setMonths] = useState<string[]>(() =>
    isReportAllPeriods(initialMonth)
      ? [REPORT_ALL_PERIODS]
      : parseMonthList(initialMonth),
  );
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  useEffect(() => {
    setMonths(
      isReportAllPeriods(initialMonth)
        ? [REPORT_ALL_PERIODS]
        : parseMonthList(initialMonth),
    );
    setFrom(initialFrom);
    setTo(initialTo);
  }, [initialMonth, initialFrom, initialTo]);

  function applyMonths(values: string[]) {
    const justAll = values.includes(REPORT_ALL_PERIODS);
    if (justAll) {
      // «Tutti i periodi» è esclusivo: non si combina con mesi singoli.
      setMonths([REPORT_ALL_PERIODS]);
      return;
    }
    const sorted = [...values]
      .filter((v) => v !== REPORT_ALL_PERIODS)
      .sort();
    setMonths(sorted);
    if (sorted.length === 0) return;
    const first = monthToDateRange(sorted[0]!);
    const last = monthToDateRange(sorted[sorted.length - 1]!);
    if (first && last) {
      setFrom(first.from);
      setTo(last.to);
    }
  }

  return (
    <>
      <Field label="Mese di incasso">
        <MultiSelectFilter
          name="month"
          emptyLabel="Periodo personalizzato (usa Dal / Al)"
          initialValues={months}
          options={monthOptions}
          onChange={applyMonths}
        />
      </Field>
      <Field label="Dal">
        <Input
          type="date"
          name="from"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setMonths([]);
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
            setMonths([]);
          }}
        />
      </Field>
    </>
  );
}
