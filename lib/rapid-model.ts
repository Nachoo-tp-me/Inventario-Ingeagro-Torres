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
  if (!query.trim()) return true;
  const term = normalizeCatalogSearch(query);
  return matchesNormalizedCatalogQuery(normalizeCatalogSearch(name), normalizeCatalogSearch(category), term);
}

export function matchesNormalizedCatalogQuery(name: string, category: string, term: string): boolean {
  return !!term && (name.includes(term) || category.includes(term));
}

// Search rules are separate from duplicate warnings and exact location codes.
// NFC preserves non-Latin marks and symbols used in technical product names.
export function normalizeCatalogSearch(value: string): string {
  return value.normalize("NFD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC").toLocaleLowerCase("es")
    // Preserve signs, numeric ranges and fractions used in technical names.
    .replace(/(^|[\s(=:+]|\d)[\p{Dash_Punctuation}\u2212]\s*(?=\d)/gu, "$1\u2212")
    .replace(/(\d)\s*[/\u2044]\s*(?=\d)/gu, "$1\u2044")
    .replace(/[\s\p{Dash_Punctuation}_/\\]+/gu, "");
}
