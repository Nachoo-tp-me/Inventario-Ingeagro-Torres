export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_NAME_MAX = 160;
export const PRODUCT_DESCRIPTION_MAX = 2000;
export const CATEGORY_NAME_MAX = 80;

export type Category = { id: string; nombre: string };

export function validateCategoryName(nombre: string): string | null {
  if (!nombre.trim()) return "Escribe un nombre para la categoría.";
  if (nombre.trim().length > CATEGORY_NAME_MAX)
    return `La categoría puede tener hasta ${CATEGORY_NAME_MAX} caracteres.`;
  return null;
}

export function validateImage(file: File): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "Elige una imagen JPG, PNG o WebP.";
  if (file.size > MAX_IMAGE_BYTES)
    return "La fotografía debe pesar 5 MB o menos.";
  if (file.size === 0) return "La fotografía está vacía.";
  return null;
}

export function validateProduct(
  nombre: string,
  categoriaId: string,
  categories: Category[],
  descripcion: string,
): string | null {
  if (!nombre.trim()) return "Escribe un nombre para el producto.";
  if (nombre.length > PRODUCT_NAME_MAX)
    return `El nombre puede tener hasta ${PRODUCT_NAME_MAX} caracteres.`;
  if (!/[\p{L}\p{N}]/u.test(nombre))
    return "El nombre debe incluir al menos una letra o un número.";
  if (!categories.some((category) => category.id === categoriaId))
    return "Selecciona una categoría válida.";
  if (descripcion.length > PRODUCT_DESCRIPTION_MAX)
    return `La descripción puede tener hasta ${PRODUCT_DESCRIPTION_MAX} caracteres.`;
  return null;
}
