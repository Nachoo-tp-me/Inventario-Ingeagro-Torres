"use client";

import { useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, MapPin } from "lucide-react";
import type { BoxLocationOption, CompartmentOption } from "@/lib/stock-model";
import { normalizeLocationCode } from "@/lib/rapid-model";
import { LAST_RAPID_LOCATION, LAST_RAPID_LOCATION_V2, rapidLocationHref, resolveLastRapidLocation } from "@/lib/rapid-navigation-model";
import { resolveRapidCode } from "@/app/(workspace)/rapid-actions";

export { LAST_RAPID_LOCATION } from "@/lib/rapid-navigation-model";
const noSubscribe = () => () => {};
const readLast = () => {
  const read = (key: string) => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } };
  return JSON.stringify([read(LAST_RAPID_LOCATION_V2), read(LAST_RAPID_LOCATION)]);
};

export function RapidStart({ compartments, boxes = [] }: { compartments: CompartmentOption[]; boxes?: BoxLocationOption[] }) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [kind, setKind] = useState<"compartimiento" | "caja">("compartimiento");
  const towers = [...new Set(compartments.map((item) => item.torre_id))];
  const shelves = [...new Set(boxes.map(item => item.estante_id))].sort((a,b) => a-b);
  const [shelf, setShelf] = useState(shelves[0] ?? 1);
  const [tower, setTower] = useState(towers[0] ?? 1);
  const [floor, setFloor] = useState(6);
  const [position, setPosition] = useState(1);
  const [code, setCode] = useState("");
  const saved = useSyncExternalStore(noSubscribe, readLast, () => "");
  const [error, setError] = useState("");
  const selected = useMemo(() => kind === "caja" ? boxes.find(item => item.estante_id === shelf && item.posicion === position)
    : compartments.find((item) => item.torre_id === tower && item.piso === floor && item.posicion === position), [boxes, compartments, kind, shelf, tower, floor, position]);
  let last = null;
  try { const [value, legacy] = JSON.parse(saved); last = resolveLastRapidLocation(value, legacy, [...compartments, ...boxes]); } catch { /* Preferencia opcional. */ }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setError("");
    if (!code.trim()) {
      if (!selected) { setError("No encontramos esa ubicación."); return; }
      router.push(rapidLocationHref(selected)); return;
    }
    const towerLocation = compartments.find(item => item.codigo === normalizeLocationCode(code));
    if (towerLocation) { router.push(rapidLocationHref(towerLocation)); return; }
    busyRef.current = true; setPending(true);
    try {
      const result = await resolveRapidCode(code);
      if (!result.ok || !result.href) { setError(result.message ?? "No encontramos esa ubicación."); return; }
      router.push(result.href);
    } catch { setError("No pudimos consultar la ubicación. Inténtalo nuevamente."); }
    finally { busyRef.current = false; setPending(false); }
  }
  return <div className="rapid-start-layout">
    {last && <Link href={rapidLocationHref(last)} className="rapid-continue"><MapPin size={22} aria-hidden="true" /><span><strong style={{ overflowWrap: "anywhere" }}>Continuar desde {last.codigo}</strong><small>Última ubicación en este dispositivo</small></span><ArrowRight size={19} aria-hidden="true" /></Link>}
    <div className="rapid-neighbors" role="group" aria-label="Tipo de almacenamiento">
      <button type="button" className={`catalog-button${kind === "compartimiento" ? " primary" : ""}`} aria-pressed={kind === "compartimiento"} disabled={pending} onClick={() => { setKind("compartimiento"); setCode(""); setError(""); }}>Torres</button>
      <button type="button" className={`catalog-button${kind === "caja" ? " primary" : ""}`} aria-pressed={kind === "caja"} disabled={pending} onClick={() => { setKind("caja"); setCode(""); setError(""); }}>Estantes</button>
    </div>
    <form className="rapid-start-form" onSubmit={submit}>
      <h2>Elegir punto de inicio</h2>
      <p>Escribe un código actual o histórico, o selecciona una ubicación física.</p>
      <label className="catalog-field">Código de ubicación<input value={code} onChange={(event) => { setCode(event.target.value); setError(""); }} placeholder={kind === "caja" ? "Código de caja" : "C264"} autoCapitalize="characters" autoComplete="off" maxLength={24} disabled={pending} /></label>
      <div className="rapid-choice-divider">o selecciona</div>
      {kind === "caja" ? <div className="rapid-start-selects" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <label className="catalog-field">Estante<select aria-label="Estante" value={shelf} disabled={pending} onChange={event => { setShelf(Number(event.target.value)); setCode(""); setError(""); }}>{shelves.map(id => <option key={id} value={id}>Estante {id} · Grupo {id <= 3 ? "A" : "B"}</option>)}</select></label>
        <label className="catalog-field">Caja<select aria-label="Caja" value={position} disabled={pending} onChange={event => { setPosition(Number(event.target.value)); setCode(""); setError(""); }}>{boxes.filter(item => item.estante_id === shelf).sort((a,b) => a.posicion-b.posicion).map(item => <option key={item.id} value={item.posicion}>{item.codigo} · {['Superior izquierda','Superior derecha','Inferior izquierda','Inferior derecha'][item.posicion-1]}</option>)}</select></label>
      </div> : <div className="rapid-start-selects">
        <label className="catalog-field">Torre<select value={tower} disabled={pending} onChange={(event) => { setTower(Number(event.target.value)); setCode(""); setError(""); }}>{towers.map((id) => <option key={id} value={id}>C{id}</option>)}</select></label>
        <label className="catalog-field">Piso<select value={floor} disabled={pending} onChange={(event) => { setFloor(Number(event.target.value)); setCode(""); setError(""); }}>{[6, 5, 4, 3, 2, 1].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
        <label className="catalog-field">Compartimiento<select value={position} disabled={pending} onChange={(event) => { setPosition(Number(event.target.value)); setCode(""); setError(""); }}>{[1, 2, 3, 4].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
      </div>}
      {!(kind === "caja" ? boxes.length : compartments.length) && <p className="search-empty">No hay {kind === "caja" ? "cajas" : "compartimientos"} disponibles.</p>}
      {error && <p className="catalog-message error" role="alert">{error}</p>}
      <button className="catalog-button primary rapid-primary" type="submit" disabled={pending || (!code.trim() && !selected)}>{pending ? "Consultando…" : kind === "caja" ? "Ir a la caja" : "Ir al compartimiento"} <ArrowRight size={18} aria-hidden="true" /></button>
    </form>
  </div>;
}
