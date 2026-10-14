import type { BoxLocationOption, PhysicalLocationOption } from "./stock-model.ts";
import type { LocationContent } from "./location-content.ts";

export type RapidLocationContent = PhysicalLocationOption & LocationContent;
export type RapidAdjacent = { current: PhysicalLocationOption | null; previous: PhysicalLocationOption | null; next: PhysicalLocationOption | null };
export const LAST_RAPID_LOCATION = "ingeagro-last-rapid-location";
export const LAST_RAPID_LOCATION_V2 = "ingeagro-last-rapid-location-v2";

export function rapidLocationHref(location: PhysicalLocationOption): string {
  return location.tipo === "caja" ? `/carga/ubicacion/${location.id}` : `/carga/${location.codigo}`;
}

export function orderedRapidBoxes(items: PhysicalLocationOption[]): BoxLocationOption[] {
  return items.filter((item): item is BoxLocationOption => item.tipo === "caja")
    .sort((a, b) => a.estante_id - b.estante_id || a.posicion - b.posicion || a.id - b.id);
}

export function adjacentRapidBoxes(items: PhysicalLocationOption[], id: number): RapidAdjacent {
  const ordered = orderedRapidBoxes(items);
  const index = ordered.findIndex(item => item.id === id);
  return { current: ordered[index] ?? null, previous: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 ? ordered[index + 1] ?? null : null };
}

export function resolveLastRapidLocation(saved: string, legacy: string, locations: PhysicalLocationOption[]): PhysicalLocationOption | null {
  try {
    const value = JSON.parse(saved);
    if (value?.version === 2 && Number.isSafeInteger(value.id) && value.id > 0 &&
        (value.tipo === "caja" || value.tipo === "compartimiento")) {
      const location = locations.find(item => item.tipo === value.tipo && item.id === value.id);
      if (location) return location;
    }
  } catch { /* Datos locales opcionales: conservar la preferencia antigua. */ }
  return locations.find(item => item.tipo === "compartimiento" && item.codigo === legacy) ?? null;
}

export function rememberRapidLocation(storage: Pick<Storage, "setItem">, location: Pick<PhysicalLocationOption, "id" | "tipo" | "codigo">): void {
  const entries = [[LAST_RAPID_LOCATION_V2, JSON.stringify({ version: 2, tipo: location.tipo, id: location.id })]];
  if (location.tipo === "compartimiento") entries.push([LAST_RAPID_LOCATION, location.codigo]);
  for (const [key, value] of entries) {
    try { storage.setItem(key, value); } catch { /* Preferencias locales opcionales. */ }
  }
}
