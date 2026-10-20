import type { Category } from "./product-validation.ts";

// The real validateProduct is passed in (single source of truth, no duplicated import path).
export type ValidateProduct = (nombre: string, categoriaId: string, categories: Category[], descripcion: string) => string | null;

// Associates the (unchanged) validateProduct() message with the field it belongs to. The rules stay in
// validateProduct(): each field is probed ALONE by calling it with the other fields replaced by known-valid
// values, and the probe whose message equals the real one identifies the field. No rule is duplicated here.

export type ProductFieldName = "nombre" | "categoria" | "descripcion";
export type FieldError = { field: ProductFieldName; message: string };

const VALID_CATEGORY: Category = { id: "valid-category", nombre: "valid" };
const VALID_NAME = "Valid name";

export function fieldErrorOfProduct(
  validateProduct: ValidateProduct,
  nombre: string,
  categoriaId: string,
  categories: Category[],
  descripcion: string,
): FieldError | null {
  const message = validateProduct(nombre, categoriaId, categories, descripcion);
  if (message === null) return null;
  const probes: [ProductFieldName, string | null][] = [
    ["nombre", validateProduct(nombre, VALID_CATEGORY.id, [VALID_CATEGORY], "")],
    ["categoria", validateProduct(VALID_NAME, categoriaId, categories, "")],
    ["descripcion", validateProduct(VALID_NAME, VALID_CATEGORY.id, [VALID_CATEGORY], descripcion)],
  ];
  const match = probes.find(([, probeMessage]) => probeMessage === message);
  return match ? { field: match[0], message } : null;
}
