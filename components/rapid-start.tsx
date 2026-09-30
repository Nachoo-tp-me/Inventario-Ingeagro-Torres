"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, MapPin } from "lucide-react";
import type { CompartmentOption } from "@/lib/stock-model";
import { normalizeLocationCode } from "@/lib/rapid-model";

export const LAST_RAPID_LOCATION = "ingeagro-last-rapid-location";
const noSubscribe = () => () => {};
const readLast = () => {
  try { return localStorage.getItem(LAST_RAPID_LOCATION) ?? ""; } catch { return ""; }
};

export function RapidStart({ compartments }: { compartments: CompartmentOption[] }) {
  const router = useRouter();
  const towers = [...new Set(compartments.map((item) => item.torre_id))];
  const [tower, setTower] = useState(towers[0] ?? 1);
  const [floor, setFloor] = useState(6);
  const [position, setPosition] = useState(1);
  const [code, setCode] = useState("");
  const last = useSyncExternalStore(noSubscribe, readLast, () => "");
  const [error, setError] = useState("");
  const selected = useMemo(() => compartments.find((item) => item.torre_id === tower && item.piso === floor && item.posicion === position), [compartments, tower, floor, position]);
  const lastExists = compartments.some((item) => item.codigo === last);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = code.trim() ? compartments.find((item) => item.codigo === normalizeLocationCode(code)) : selected;
    if (!target) { setError("No encontramos esa ubicación."); return; }
    setError("");
    router.push(`/carga/${target.codigo}`);
  }
  return <div className="rapid-start-layout">
    {lastExists && <Link href={`/carga/${last}`} className="rapid-continue"><MapPin size={22} aria-hidden="true" /><span><strong>Continuar desde {last}</strong><small>Última ubicación en este dispositivo</small></span><ArrowRight size={19} aria-hidden="true" /></Link>}
    <form className="rapid-start-form" onSubmit={submit}>
      <h2>Elegir punto de inicio</h2>
      <p>Escribe el código físico o elige torre, piso y compartimiento.</p>
      <label className="catalog-field">Código de compartimiento<input value={code} onChange={(event) => { setCode(event.target.value); setError(""); }} placeholder="C264" autoCapitalize="characters" autoComplete="off" maxLength={8} /></label>
      <div className="rapid-choice-divider">o selecciona</div>
      <div className="rapid-start-selects">
        <label className="catalog-field">Torre<select value={tower} onChange={(event) => { setTower(Number(event.target.value)); setCode(""); setError(""); }}>{towers.map((id) => <option key={id} value={id}>C{id}</option>)}</select></label>
        <label className="catalog-field">Piso<select value={floor} onChange={(event) => { setFloor(Number(event.target.value)); setCode(""); setError(""); }}>{[6, 5, 4, 3, 2, 1].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
        <label className="catalog-field">Compartimiento<select value={position} onChange={(event) => { setPosition(Number(event.target.value)); setCode(""); setError(""); }}>{[1, 2, 3, 4].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
      </div>
      {error && <p className="catalog-message error" role="alert">{error}</p>}
      <button className="catalog-button primary rapid-primary" type="submit" disabled={!compartments.length}>Ir al compartimiento <ArrowRight size={18} aria-hidden="true" /></button>
    </form>
  </div>;
}
