import type { PhysicalLocationOption } from "./stock-model.ts";

export type HistoryLocation = {
  id: number;
  codigoMovimiento: string | null;
  ubicacionActual: PhysicalLocationOption | null;
};

export type HistoryEntry = {
  id: number;
  fecha: string;
  tipo: "entrada" | "retiro" | "traslado" | "ajuste";
  cantidad: number;
  producto: string;
  origen: HistoryLocation | null;
  destino: HistoryLocation | null;
};

export function resolveHistoryLocation(id: number | null, snapshot: string | null, locations: ReadonlyMap<number, PhysicalLocationOption>): HistoryLocation | null {
  if (id === null) return null;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ID de ubicación histórica inválido.");
  const current = locations.get(id) ?? null;
  if (current && current.id !== id) throw new Error("Ubicación histórica inconsistente.");
  return { id, codigoMovimiento: snapshot, ubicacionActual: current };
}

export function historyLocationLabel(location: HistoryLocation): string {
  const current = location.ubicacionActual?.codigo;
  if (location.codigoMovimiento === null) return current
    ? `${current} (código actual; sin instantánea histórica)` : "Ubicación no disponible (sin instantánea histórica)";
  if (!current) return `${location.codigoMovimiento} (ubicación actual no disponible)`;
  return location.codigoMovimiento === current ? location.codigoMovimiento
    : `${location.codigoMovimiento} (actualmente ${current})`;
}
