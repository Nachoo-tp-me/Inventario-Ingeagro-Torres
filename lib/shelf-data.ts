import { requireAuthorizedUser } from "@/lib/auth";
import { getSignedProductImages } from "@/lib/product-catalog";
import { toPhysicalLocation } from "@/lib/stock-model";
import { buildShelfSummaries, type ShelfDetail, type ShelfRow, type ShelfStockRow } from "@/lib/shelf-model";
import type { LocationProduct } from "@/lib/location-content";

async function readShelfStock(shelfId?: number) {
  const supabase = await requireAuthorizedUser();
  let query = supabase.from("estantes").select("id,nombre,grupo").order("id");
  if (shelfId !== undefined) query = query.eq("id", shelfId);
  const { data: shelves, error: shelfError } = await query;
  if (shelfError) throw shelfError;
  const shelfRows = (shelves ?? []) as ShelfRow[];
  if (!shelfRows.length) return { supabase, summaries: [], stock: [] as ShelfStockRow[] };
  const { data, error } = await supabase.from("compartimientos")
    .select("id,codigo,tipo,torre_id,piso,estante_id,posicion")
    .eq("tipo", "caja").in("estante_id", shelfRows.map(row => row.id)).order("estante_id").order("posicion");
  if (error) throw error;
  const boxes = (data ?? []).map(row => {
    const location = toPhysicalLocation(row);
    if (location.tipo !== "caja") throw new Error("Se esperaba una caja de estante.");
    return location;
  });
  const stock: ShelfStockRow[] = [];
  // Limitación V1: las páginas no comparten una instantánea transaccional.
  // Cambios concurrentes pueden desplazar filas entre offsets; los resúmenes
  // pueden requerir actualizar la vista. No modifica la atomicidad del motor SQL.
  if (boxes.length) for (let start = 0; ; start += 1000) {
    const result = await supabase.from("inventario").select("compartimiento_id,producto_id,cantidad")
      .in("compartimiento_id", boxes.map(box => box.id)).gt("cantidad", 0)
      .order("compartimiento_id").order("producto_id").range(start, start + 999);
    if (result.error) throw result.error;
    stock.push(...(result.data ?? []));
    if (!result.data || result.data.length < 1000) break;
  }
  return { supabase, summaries: buildShelfSummaries(shelfRows, boxes, stock), stock };
}

export async function getShelfSummaries() {
  return (await readShelfStock()).summaries;
}

export async function getShelfDetail(id: number): Promise<ShelfDetail | null> {
  const { supabase, summaries, stock } = await readShelfStock(id);
  if (!summaries.length) return null;
  const productIds = [...new Set(stock.map(row => row.producto_id))];
  const products: { id: string; nombre: string; categoria_id: string; foto_ruta: string | null }[] = [];
  for (let start = 0; start < productIds.length; start += 100) {
    const { data, error } = await supabase.from("productos").select("id,nombre,categoria_id,foto_ruta").in("id", productIds.slice(start, start + 100));
    if (error) throw error;
    products.push(...(data ?? []));
  }
  const categoryIds = [...new Set(products.map(product => product.categoria_id))];
  const categories = new Map<string, string>();
  for (let start = 0; start < categoryIds.length; start += 100) {
    const { data, error } = await supabase.from("categorias").select("id,nombre").in("id", categoryIds.slice(start, start + 100));
    if (error) throw error;
    for (const row of data ?? []) categories.set(row.id, row.nombre);
  }
  const images = await getSignedProductImages(products.map(product => product.foto_ruta));
  const byId = new Map(products.map(product => [product.id, product]));
  return { ...summaries[0], cajas: summaries[0].cajas.map(box => {
    const contents: LocationProduct[] = stock.filter(row => row.compartimiento_id === box.id).map(row => {
      const product = byId.get(row.producto_id);
      if (!product) throw new Error("No se pudo leer un producto del estante. Actualiza la página.");
      return { id: product.id, nombre: product.nombre, categoria: categories.get(product.categoria_id) ?? "Sin categoría",
        cantidad: row.cantidad, fotoUrl: product.foto_ruta ? images.get(product.foto_ruta) ?? null : null };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return { ...box, productos: contents };
  }) };
}
