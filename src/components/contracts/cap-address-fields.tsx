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
  const [cityLookupStatus, setCityLookupStatus] = useState<
    "idle" | "loading" | "ok" | "missing"
  >("idle");
  const [lastCityLookedUp, setLastCityLookedUp] = useState("");

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
          // CAP fuori elenco Zippopotam: precompila comunque provincia/regione
          if (d.province) {
            onProvinceChange(normalizeProvinceSigla(d.province));
          }
          if (d.region) onRegionChange(d.region);
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

  // Autocomplete inverso: comune (+ eventuale provincia) → CAP
  useEffect(() => {
    const cityQ = city.trim();
    const hasCap = zipCode.replace(/\D/g, "").length === 5;
    if (hasCap || cityQ.length < 3) {
      setCityLookupStatus("idle");
      return;
    }
    const key = `${cityQ}|${province}`.toLowerCase();
    if (key === lastCityLookedUp) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCityLookupStatus("loading");
      const qs = new URLSearchParams({ q: cityQ });
      if (province.trim()) qs.set("province", province.trim());
      void fetch(`/api/cap/city?${qs.toString()}`)
        .then((r) => r.json())
        .then(
          (d: {
            found?: boolean;
            multi?: boolean;
            matches?: Array<{
              city: string;
              province: string;
              region: string;
              zipCode: string;
              label: string;
            }>;
            zipCode?: string;
            city?: string;
            province?: string;
            region?: string;
          }) => {
            if (cancelled) return;
            setLastCityLookedUp(key);
            const list = d.matches ?? [];
            if (list.length === 1 || (d.found && d.zipCode)) {
              const m = list[0];
              const zip = m?.zipCode || d.zipCode || "";
              if (zip) onZipChange(zip);
              if (m?.city || d.city) onCityChange(m?.city || d.city || cityQ);
              if (m?.province || d.province) {
                onProvinceChange(
                  normalizeProvinceSigla(m?.province || d.province || ""),
                );
              }
              if (m?.region || d.region) {
                onRegionChange(m?.region || d.region || "");
              }
              setCityLookupStatus("ok");
              setPlaces(
                list.map((x) => ({
                  city: x.city,
                  province: x.province,
                  region: x.region,
                  label: x.label,
                })),
              );
              setMulti(list.length > 1);
            } else if (list.length > 1) {
              setPlaces(
                list.map((x) => ({
                  city: x.city,
                  province: x.province,
                  region: x.region,
                  label: x.label,
                })),
              );
              setMulti(true);
              setCityLookupStatus("ok");
            } else {
              setCityLookupStatus("missing");
            }
          },
        )
        .catch(() => {
          if (!cancelled) setCityLookupStatus("missing");
        });
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, province, zipCode]);

  function pickPlace(label: string) {
    const p = places.find((x) => x.label === label);
    if (!p) return;
    onCityChange(p.city);
    onProvinceChange(normalizeProvinceSigla(p.province));
    onRegionChange(p.region);
    // Se la label contiene CAP (es. "Manfredonia — FG — 71043")
    const zipInLabel = label.match(/\b(\d{5})\b/);
    if (zipInLabel?.[1]) onZipChange(zipInLabel[1]);
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
    if (parsed.zipCode) onZipChange(parsed.zipCode);
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
            placeholder="Via Roma 12, Manfredonia FG (CAP automatico)"
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
      {compact &&
      capStatus === "missing" &&
      zipCode.replace(/\D/g, "").length === 5 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Comune" fillStatus={fs(Boolean(city.trim()))}>
            <Input
              value={city}
              onChange={(e) => onCityChange(e.target.value)}
              placeholder="Manfredonia"
              autoComplete="address-level2"
            />
          </Field>
          <Field label="Provincia" fillStatus={fs(Boolean(province.trim()))}>
            <Input
              value={province}
              onChange={(e) =>
                onProvinceChange(normalizeProvinceSigla(e.target.value))
              }
              placeholder="FG"
              maxLength={2}
            />
          </Field>
          <Field label="Regione" fillStatus={fs(Boolean(region.trim()))}>
            <Input
              value={region}
              onChange={(e) => onRegionChange(e.target.value)}
              placeholder="Puglia"
            />
          </Field>
        </div>
      ) : null}
      {cityLookupStatus === "loading" ? (
        <p className="text-xs text-slate-500">Cerco CAP da comune…</p>
      ) : null}
      {cityLookupStatus === "missing" &&
      city.trim().length >= 3 &&
      zipCode.replace(/\D/g, "").length !== 5 ? (
        <p className="text-xs text-amber-800">
          Comune non riconosciuto automaticamente: inserisci il CAP a mano (5
          cifre), poi Comune e Provincia si compilano.
        </p>
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
          CAP non in elenco automatico
          {province ? ` (provincia ${province}` : ""}
          {region ? `${province ? ", " : " ("}${region}` : ""}
          {province || region ? ")" : ""}. Inserisci il <strong>Comune</strong>
          {province ? "" : " e la Provincia (sigla a 2 lettere, es. FG)"}
          . Per Manfredonia il CAP corretto è <strong>71043</strong>.
        </p>
      ) : null}
    </div>
  );
}
