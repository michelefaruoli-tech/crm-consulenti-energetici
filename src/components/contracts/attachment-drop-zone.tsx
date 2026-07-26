"use client";

import { useRef, useState } from "react";
import { Camera, FolderOpen, Paperclip, Upload } from "lucide-react";
import { cn } from "@/lib/cn";

type Props = {
  title: string;
  hint?: string;
  accept?: string;
  multiple?: boolean;
  /** Solo immagini (fotocamera). Default: image/* */
  cameraAccept?: string;
  onAdd: (files: FileList | null) => void;
  className?: string;
  /** Contenuto sotto i pulsanti (lista file già caricati) */
  children?: React.ReactNode;
};

/**
 * Zona allegati con 3 modi:
 * 1) Trascina file / foto / PDF
 * 2) Clic → scegli file dal PC
 * 3) Su telefono → fotocamera (capture)
 */
export function AttachmentDropZone({
  title,
  hint = "Trascina qui, oppure scegli dal PC / scatta una foto",
  accept = ".pdf,.jpg,.jpeg,.png,application/pdf,image/*",
  multiple = true,
  cameraAccept = "image/*",
  onAdd,
  className,
  children,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border-2 border-dashed bg-slate-50/60 p-3 transition-colors sm:p-4",
        dragOver
          ? "border-emerald-500 bg-emerald-50"
          : "border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/40",
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onAdd(e.dataTransfer.files);
      }}
    >
      <div className="mb-2 flex items-start gap-2">
        <Paperclip className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(
            "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm",
            "hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-900",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
          )}
          onClick={() => fileRef.current?.click()}
        >
          <FolderOpen className="h-4 w-4" />
          Scegli file
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm",
            "hover:border-sky-500 hover:bg-sky-50 hover:text-sky-900",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
            "sm:flex-none",
          )}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="h-4 w-4" />
          Foto
        </button>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Upload className="h-3.5 w-3.5" />
        Oppure trascina qui PDF o immagini
        {dragOver ? " — rilascia ora" : ""}
      </p>

      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />
      {/* capture=environment → fotocamera posteriore su telefono */}
      <input
        ref={cameraRef}
        type="file"
        accept={cameraAccept}
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />

      {children}
    </div>
  );
}
