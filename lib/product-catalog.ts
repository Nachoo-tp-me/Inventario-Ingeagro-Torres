import { requireAuthorizedUser } from "@/lib/auth";
import { PRODUCT_IMAGE_BUCKET, type Category } from "@/lib/product-validation";
export type { Category } from "@/lib/product-validation";
export type Product = {
  id: string;
  nombre: string;
  categoria_id: string;
  categoria: string;
  descripcion: string | null;
  foto_ruta: string | null;
  fotoUrl: string | null;
  actualizado_en: string;
  stock: number;
  ubicaciones: number;
};
export type ProductLocation = { id: number; codigo: string; cantidad: number };

type ProductRow = {
  id: string;
  nombre: string;
  categoria_id: string;
  descripcion: string | null;
  foto_ruta: string | null;
  actualizado_en: string;
  categorias: { nombre: string } | null;
};

const PRODUCT_SELECT =
  "id,nombre,categoria_id,descripcion,foto_ruta,actualizado_en,categorias(nombre)";
const PAGE_SIZE = 1000;

export async function getCategories(): Promise<Category[]> {
  const supabase = await requireAuthorizedUser();
  const { data, error } = await supabase
    .from("categorias")
    .select("id,nombre")
    .order("nombre");
  if (error) throw error;
  return data ?? [];
}

export async function getSignedProductImages(paths: (string | null)[]) {
  const uniquePaths = [...new Set(paths.filter((path): path is string => !!path))];
  const urls = new Map<string, string>();
  if (uniquePaths.length === 0) return urls;
  const supabase = await requireAuthorizedUser();
  for (let start = 0; start < uniquePaths.length; start += 100) {
    const chunk = uniquePaths.slice(start, start + 100);
    const { data, error } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .createSignedUrls(chunk, 3600);
    if (error) throw error;
    for (let i = 0; i < chunk.length; i++) {
      const signed = data?.[i]?.signedUrl;
      if (signed) urls.set(chunk[i], signed);
    }
  }
  return urls;
}

function productFromRow(row: ProductRow, imageUrls: Map<string, string>): Product {
  return {
    id: row.id,
    nombre: row.nombre,
    categoria_id: row.categoria_id,
    categoria: row.categorias?.nombre ?? "Sin categoría",
    descripcion: row.descripcion,
    foto_ruta: row.foto_ruta,
    fotoUrl: row.foto_ruta ? imageUrls.get(row.foto_ruta) ?? null : null,
    actualizado_en: row.actualizado_en,
    stock: 0,
    ubicaciones: 0,
  };
}

export async function getProducts(): Promise<Product[]> {
  const supabase = await requireAuthorizedUser();
  const rows: ProductRow[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("productos")
      .select(PRODUCT_SELECT)
      .order("nombre")
      .order("id")
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as ProductRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const stock = new Map<string, { total: number; locations: number }>();
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("inventario")
      .select("producto_id,cantidad")
      .gt("cantidad", 0)
      .order("producto_id")
      .order("compartimiento_id")
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const previous = stock.get(row.producto_id) ?? { total: 0, locations: 0 };
      stock.set(row.producto_id, {
        total: previous.total + row.cantidad,
        locations: previous.locations + 1,
      });
    }
    if (!data || data.length < PAGE_SIZE) break;
  }

  const images = await getSignedProductImages(rows.map((row) => row.foto_ruta));
  return rows.map((row) => {
    const product = productFromRow(row, images);
    const summary = stock.get(row.id);
    return summary
      ? { ...product, stock: summary.total, ubicaciones: summary.locations }
      : product;
  });
}

export async function getProduct(id: string) {
  const supabase = await requireAuthorizedUser();
  const { data, error } = await supabase
    .from("productos")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as ProductRow;
  const [images, locationsResult] = await Promise.all([
    getSignedProductImages([row.foto_ruta]),
    supabase
      .from("inventario")
      .select("cantidad,compartimiento_id,compartimientos(codigo)")
      .eq("producto_id", id)
      .gt("cantidad", 0),
  ]);
  if (locationsResult.error) throw locationsResult.error;
  const locations = (locationsResult.data ?? [])
    .map((item) => ({
      id: item.compartimiento_id,
      codigo: (item.compartimientos as unknown as { codigo: string } | null)?.codigo ?? "Ubicación desconocida",
      cantidad: item.cantidad,
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "es"));
  const product = productFromRow(row, images);
  product.stock = locations.reduce((sum, item) => sum + item.cantidad, 0);
  product.ubicaciones = locations.length;
  return { product, locations };
}
