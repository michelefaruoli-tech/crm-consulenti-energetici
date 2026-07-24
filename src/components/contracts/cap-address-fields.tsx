"use client";

import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui/form";

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
}) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [multi, setMulti] = useState(false);

  useEffect(() => {
    const clean = zipCode.replace(/\D/g, "");
    if (clean.length !== 5) {
      setPlaces([]);
      setMulti(false);
      return;
    }
    let cancelled = false;
    void fetch(`/api/cap/${clean}`)
      .then((r) => r.json())
      .then((d: CapResult) => {
        if (cancelled) return;
        const list = d.places ?? [];
        setPlaces(list);
        setMulti(Boolean(d.multi && list.length > 1));
        if (list.length === 1) {
          const p = list[0]!;
          onCityChange(p.city);
          onProvinceChange(p.province);
          onRegionChange(p.region);
        } else if (list.length > 1) {
          // Non auto-selezionare (es. Leonessa vs Melfi)
          onCityChange("");
          onProvinceChange("");
          onRegionChange("");
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambio CAP
  }, [zipCode]);

  function pickPlace(label: string) {
    const p = places.find((x) => x.label === label);
    if (!p) return;
    onCityChange(p.city);
    onProvinceChange(p.province);
    onRegionChange(p.region);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-6">
        <Field label={`${zipLabel}`}>
          <Input
            value={zipCode}
            onChange={(e) => onZipChange(e.target.value)}
            placeholder="85025"
            inputMode="numeric"
          />
        </Field>
        {multi ? (
          <div className="md:col-span-5">
            <Field label="Comune (scegli dalla lista) *">
              <Select
                value={city ? places.find((p) => p.city === city)?.label ?? "" : ""}
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
          <>
            <Field label="Comune">
              <Input value={city} onChange={(e) => onCityChange(e.target.value)} />
            </Field>
            <Field label="Provincia">
              <Input value={province} onChange={(e) => onProvinceChange(e.target.value)} />
            </Field>
            <Field label="Regione">
              <Input value={region} onChange={(e) => onRegionChange(e.target.value)} />
            </Field>
          </>
        )}
        {multi ? (
          <>
            <Field label="Provincia">
              <Input value={province} readOnly className="bg-slate-50" />
            </Field>
            <Field label="Regione">
              <Input value={region} readOnly className="bg-slate-50" />
            </Field>
          </>
        ) : null}
        <Field label="Via/Piazza">
          <Input value={street} onChange={(e) => onStreetChange(e.target.value)} />
        </Field>
        <Field label="Civico">
          <Input value={streetNumber} onChange={(e) => onStreetNumberChange(e.target.value)} />
        </Field>
      </div>
      {multi ? (
        <p className="text-xs text-amber-800">
          Questo CAP corrisponde a più località: scegli il comune corretto (es. Melfi — PZ).
        </p>
      ) : null}
    </div>
  );
}
