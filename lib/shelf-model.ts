import type { BoxLocationOption } from "./stock-model.ts";
import type { LocationContent } from "./location-content.ts";

export type ShelfRow = { id: number; nombre: string; grupo: "A" | "B" };
export type ShelfStockRow = { compartimiento_id: number; producto_id: string; cantidad: number };
export type ShelfBox = BoxLocationOption & { ocupado: boolean; referencias: number; unidades: number };
export type ShelfSummary = ShelfRow & { cajas: ShelfBox[] };
export type ShelfDetail = Omit<ShelfSummary, "cajas"> & { cajas: (ShelfBox & LocationContent)[] };

export function parsePhysicalId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function buildShelfSummaries(shelves: ShelfRow[], boxes: BoxLocationOption[], stock: ShelfStockRow[]): ShelfSummary[] {
  const totals = new Map<number, { references: Set<string>; units: number }>();
  for (const row of stock) {
    if (row.cantidad <= 0) continue;
    const total = totals.get(row.compartimiento_id) ?? { references: new Set<string>(), units: 0 };
    total.references.add(row.producto_id);
    total.units += row.cantidad;
    totals.set(row.compartimiento_id, total);
  }
  return [...shelves].sort((a, b) => a.id - b.id).map(shelf => {
    const locations = boxes.filter(box => box.estante_id === shelf.id).sort((a, b) => a.posicion - b.posicion);
    if (locations.length !== 4 || locations.some((box, index) => box.posicion !== index + 1)) {
      throw new Error("El estante no tiene sus cuatro posiciones físicas disponibles.");
    }
    return { ...shelf, cajas: locations.map(box => {
      const total = totals.get(box.id);
      return { ...box, ocupado: !!total?.references.size, referencias: total?.references.size ?? 0, unidades: total?.units ?? 0 };
    }) };
  });
}
