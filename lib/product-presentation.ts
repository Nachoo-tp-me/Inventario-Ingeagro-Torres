// Presentation-only labels for the product catalog and detail. They never change data or contracts.

export function unitsLabel(count: number): string {
  return `${count.toLocaleString("es-CL")} ${count === 1 ? "unidad" : "unidades"}`;
}

/** Number of locations holding stock; a product without stock says so instead of showing "0 ubicaciones". */
export function locationsLabel(count: number): string {
  if (count === 0) return "Sin stock";
  return `${count.toLocaleString("es-CL")} ${count === 1 ? "ubicación" : "ubicaciones"}`;
}
