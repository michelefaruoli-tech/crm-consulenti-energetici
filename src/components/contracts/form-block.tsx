"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Intestazione blocco progressivo form contratto (P1.4). */
export function FormBlock({
  step,
  title,
  description,
  children,
  className,
}: {
  step: number;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5",
        className,
      )}
      data-form-block={step}
    >
      <div className="mb-1 flex items-start gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white"
          aria-hidden
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-slate-500">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Nav rapida ai 7 blocchi (anchor). */
export function FormBlockNav({
  blocks,
}: {
  blocks: ReadonlyArray<{ step: number; title: string }>;
}) {
  return (
    <nav
      className="flex gap-1.5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2"
      aria-label="Sezioni form contratto"
    >
      {blocks.map((b) => (
        <a
          key={b.step}
          href={`#form-block-${b.step}`}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          {b.step}. {b.title}
        </a>
      ))}
    </nav>
  );
}
