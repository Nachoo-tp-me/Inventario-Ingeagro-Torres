import type { CompartmentOption } from "@/lib/stock-model";

export function normalizeLocationCode(value: string): string {
  return value.trim().toUpperCase();
}

export function orderedCompartments(items: CompartmentOption[]): CompartmentOption[] {
  return [...items].sort((a, b) =>
    a.torre_id - b.torre_id || b.piso - a.piso || a.posicion - b.posicion);
}

export function adjacentCompartments(items: CompartmentOption[], code: string) {
  const ordered = orderedCompartments(items);
  const index = ordered.findIndex((item) => item.codigo === normalizeLocationCode(code));
  return {
    current: index < 0 ? null : ordered[index],
    previous: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 ? ordered[index + 1] ?? null : null,
  };
}

// El campo nombre_normalizado de PostgreSQL elimina puntuación. El plegado de
// tildes aquí añade solo una advertencia; nunca altera el nombre guardado.
export function comparableProductName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]/gu, "");
}

export function similarProducts<T extends { id: string; nombre: string; nombre_normalizado?: string }>(
  name: string, products: T[], excludeId?: string,
): T[] {
  const key = comparableProductName(name);
  if (!key) return [];
  return products.filter((product) => product.id !== excludeId &&
    (product.nombre_normalizado === key || comparableProductName(product.nombre) === key)).slice(0, 5);
}

export function matchesCatalogQuery(name: string, category: string, query: string): boolean {
  const term = query.trim();
  if (!term) return true;
  const folded = comparableProductName(term);
  return name.toLocaleLowerCase("es").includes(term.toLocaleLowerCase("es")) ||
    category.toLocaleLowerCase("es").includes(term.toLocaleLowerCase("es")) ||
    (!!folded && comparableProductName(name).includes(folded));
}
