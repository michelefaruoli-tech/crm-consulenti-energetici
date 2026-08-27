"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/form";
import { normalizeProvinceSigla } from "@/lib/italy-cap-province";
import {
  formatItalianAddressLine,
  parseItalianAddressLine,
} from "@/lib/parse-italian-address";

type Place = {
  city: string;
  province: string;
  region: string;
  label: string;
};

type CapResult = {
  found?: boolean;
  multi?: boolean;
  places?: Place[];
  city?: string;
  province?: string;
  region?: string;
};

export function CapAddressFields({
  zipCode,
  city,
  province,
  region,
  onZipChange,
  onCityChange,
  onProvinceChange,
  onRegionChange,
  street,
  streetNumber,
  onStreetChange,
  onStreetNumberChange,
  zipLabel = "CAP",
  provinceReadOnly = true,
  highlightRequired = false,
  compact = false,
  compactLabel = "Indirizzo",
}: {
  zipCode: string;
  city: string;
  province: string;
  region: string;
  onZipChange: (v: string) => void;
  onCityChange: (v: string) => void;
  onProvinceChange: (v: string) => void;
  onRegionChange: (v: string) => void;
  street: string;
  streetNumber: string;
  onStreetChange: (v: string) => void;
  onStreetNumberChange: (v: string) => void;
  zipLabel?: string;
  /** Provincia compilata dal CAP: sola lettura solo se già valorizzata. */
  provinceReadOnly?: boolean;
  /** Evidenza giallo/verde campi obbligatori (invio back office). */
  highlightRequired?: boolean;
  /** Una sola riga visibile; CAP/città restano nei campi strutturati. */
  compact?: boolean;
  compactLabel?: string;
}) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [multi, setMulti] = useState(false);
  const [capStatus, setCapStatus] = useState<"idle" | "loading" | "ok" | "missing">("idle");
  const [lastLookedUp, setLastLookedUp] = useState("");

  useEffect(() => {
    const clean = zipCode.replace(/\D/g, "");
    if (clean.length !== 5) {
      setPlaces([]);
      setMulti(false);
      setCapStatus("idle");
      setLastLookedUp("");
      return;
    }
    let cancelled = false;
    setCapStatus("loading");
    void fetch(`/api/cap/${clean}`)
      .then((r) => r.json())
      .then((d: CapResult) => {
        if (cancelled) return;
        const list = d.places ?? [];
        setPlaces(list);
        setMulti(Boolean(d.multi && list.length > 1));
        const capChanged = lastLookedUp !== clean;

        if (list.length === 1) {
          const p = list[0]!;
          onCityChange(p.city);
          onProvinceChange(normalizeProvinceSigla(p.province));
          onRegionChange(p.region);
          setCapStatus(p.province ? "ok" : "missing");
        } else if (list.length > 1) {
          const match =
            city &&
            list.find(
              (p) =>
                p.city.toLowerCase() === city.toLowerCase() &&
                (!province ||
                  p.province.toLowerCase() === province.toLowerCase()),
            );
          if (match) {
            onCityChange(match.city);
            onProvinceChange(normalizeProvinceSigla(match.province));
            onRegionChange(match.region);
          } else if (capChanged) {
            onCityChange("");
            onProvinceChange("");
            onRegionChange("");
          }
          setCapStatus("ok");
        } else {
          setCapStatus("missing");
        }
        setLastLookedUp(clean);
      })
      .catch(() => {
        if (!cancelled) setCapStatus("missing");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambio CAP
  }, [zipCode]);

  function pickPlace(label: string) {
    const p = places.find((x) => x.label === label);
    if (!p) return;
    onCityChange(p.city);
    onProvinceChange(normalizeProvinceSigla(p.province));
    onRegionChange(p.region);
  }

  const selectedLabel =
    city && places.length
      ? places.find(
          (p) => p.city === city && (!province || p.province === province),
        )?.label ??
        places.find((p) => p.city === city)?.label ??
        ""
      : "";

  const provinceLocked = provinceReadOnly && Boolean(province);
  const fs = (filled: boolean): "off" | "empty" | "filled" =>
    highlightRequired ? (filled ? "filled" : "empty") : "off";
  const addressLine = [street, streetNumber].filter(Boolean).join(" ").trim();
  const structuredLine = formatItalianAddressLine({
    street,
    streetNumber,
    zipCode,
    city,
    province,
  });
  const [compactDraft, setCompactDraft] = useState(structuredLine);
  const [compactFocused, setCompactFocused] = useState(false);

  useEffect(() => {
    if (!compactFocused) setCompactDraft(structuredLine);
  }, [structuredLine, compactFocused]);

  function applyParsedLine(raw: string) {
    const parsed = parseItalianAddressLine(raw);
    onStreetChange(parsed.street);
    onStreetNumberChange(parsed.streetNumber);
    onZipChange(parsed.zipCode);
    if (parsed.city) onCityChange(parsed.city);
    if (parsed.province) onProvinceChange(parsed.province);
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name="province" value={province} readOnly />
      <input type="hidden" name="city" value={city} readOnly />
      <input type="hidden" name="region" value={region} readOnly />
      <input type="hidden" name="zipCode" value={zipCode} readOnly />

      {compact ? (
        <Field
          label={compactLabel}
          fillStatus={fs(
            Boolean(street.trim() || zipCode.replace(/\D/g, "").length === 5),
          )}
        >
          <Input
            value={compactDraft}
            onChange={(e) => {
              const v = e.target.value;
              setCompactDraft(v);
              applyParsedLine(v);
            }}
            onFocus={() => setCompactFocused(true)}
            onBlur={() => {
              setCompactFocused(false);
              applyParsedLine(compactDraft);
            }}
            placeholder="Via Roma 12, 85025 Melfi PZ"
            autoComplete="street-address"
          />
        </Field>
      ) : (
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-6">
        <Field label={`${zipLabel}`} fillStatus={fs(zipCode.replace(/\D/g, "").length === 5)}>
          <Input
            value={zipCode}
            onChange={(e) => onZipChange(e.target.value)}
            placeholder="85025"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
          />
        </Field>
        {multi ? (
          <div className="md:col-span-3">
            <Field label="Comune (scegli dalla lista)" fillStatus={fs(Boolean(city))}>
              <Select
                value={selectedLabel}
                onChange={(e) => pickPlace(e.target.value)}
              >
                <option value="">Seleziona comune / località</option>
                {places.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          <div className="md:col-span-2">
            <Field label="Comune" fillStatus={fs(Boolean(city.trim()))}>
              <Input
                value={city}
                onChange={(e) => onCityChange(e.target.value)}
                autoComplete="address-level2"
              />
            </Field>
          </div>
        )}
        <Field label="Provincia (sigla)" fillStatus={fs(Boolean(province.trim()))}>
          <Input
            value={province}
            onChange={(e) =>
              onProvinceChange(normalizeProvinceSigla(e.target.value))
            }
            readOnly={provinceLocked}
            className={provinceLocked ? "bg-slate-50" : undefined}
            placeholder={capStatus === "loading" ? "…" : "PZ"}
            maxLength={2}
            autoComplete="off"
            spellCheck={false}
            title="Sigla provincia a 2 lettere (es. PZ, RM, NA)"
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Regione" fillStatus={fs(Boolean(region.trim()))}>
            <Input
              value={region}
              onChange={(e) => onRegionChange(e.target.value)}
              readOnly={provinceReadOnly && Boolean(region)}
              className={
                provinceReadOnly && region ? "bg-slate-50" : undefined
              }
            />
          </Field>
        </div>
        <div className="md:col-span-6">
          <Field label="Indirizzo" fillStatus={fs(Boolean(addressLine))}>
            <Input
              value={addressLine}
              onChange={(e) => {
                // Un solo campo: via + civico insieme (es. "Via Roma 12")
                onStreetChange(e.target.value);
                onStreetNumberChange("");
              }}
              placeholder="Es. Via Roma 12"
              autoComplete="street-address"
            />
          </Field>
        </div>
      </div>
      )}
      {compact && multi ? (
        <Field label="Comune (scegli dalla lista)" fillStatus={fs(Boolean(city))}>
          <Select
            value={selectedLabel}
            onChange={(e) => pickPlace(e.target.value)}
          >
            <option value="">Seleziona comune / località</option>
            {places.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {multi ? (
        <p className="text-xs text-amber-800">
          Questo CAP corrisponde a più località: scegli il comune (es. Melfi —
          PZ — Basilicata). La provincia si compila automaticamente.
        </p>
      ) : null}
      {capStatus === "missing" &&
      zipCode.replace(/\D/g, "").length === 5 ? (
        <p className="text-xs text-amber-800">
          CAP non trovato in elenco: inserisci manualmente Comune e Provincia
          (sigla a 2 lettere, es. PZ).
        </p>
      ) : null}
    </div>
  );
}
