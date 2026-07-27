"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/form";
import { normalizeProvinceSigla } from "@/lib/italy-cap-province";

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

  return (
    <div className="space-y-3">
      <input type="hidden" name="province" value={province} readOnly />
      <input type="hidden" name="city" value={city} readOnly />
      <input type="hidden" name="region" value={region} readOnly />
      <input type="hidden" name="zipCode" value={zipCode} readOnly />

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-6">
        <Field label={`${zipLabel}`}>
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
            <Field label="Comune (scegli dalla lista) *">
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
            <Field label="Comune">
              <Input
                value={city}
                onChange={(e) => onCityChange(e.target.value)}
                autoComplete="address-level2"
              />
            </Field>
          </div>
        )}
        <Field label="Provincia (sigla)">
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
          <Field label="Regione">
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
        <div className="md:col-span-4">
          <Field label="Via/Piazza">
            <Input
              value={street}
              onChange={(e) => onStreetChange(e.target.value)}
            />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Civico">
            <Input
              value={streetNumber}
              onChange={(e) => onStreetNumberChange(e.target.value)}
            />
          </Field>
        </div>
      </div>
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
