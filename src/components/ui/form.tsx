import { cn } from "@/lib/cn";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // text-base su mobile evita zoom iOS; touch target alto
        "w-full min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none ring-emerald-500 placeholder:text-slate-400 focus:ring-2 sm:min-h-0 sm:py-2 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none ring-emerald-500 focus:ring-2 sm:min-h-0 sm:py-2 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none ring-emerald-500 placeholder:text-slate-400 focus:ring-2 sm:py-2 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1 block text-sm font-medium text-slate-700", className)}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
