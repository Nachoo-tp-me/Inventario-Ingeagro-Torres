import { requireAuthorizedUser } from "@/lib/auth";
import { getSignedProductImages } from "@/lib/product-catalog";
import type { CompartmentOption } from "@/lib/stock-model";
import type { TowerCompartment } from "@/lib/tower-model";

type StockRow = {
  cantidad: number;
  productos: {
    id: string; nombre: string; foto_ruta: string | null;
    categorias: { nombre: string } | null;
  } | null;
};

export async function getRapidCompartment(option: CompartmentOption): Promise<TowerCompartment> {
  const supabase = await requireAuthorizedUser();
  const rows: StockRow[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from("inventario")
      .select("cantidad,productos(id,nombre,foto_ruta,categorias(nombre))")
      .eq("compartimiento_id", option.id).gt("cantidad", 0)
      .order("producto_id").range(start, start + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as StockRow[]));
    if (!data || data.length < 1000) break;
  }
  const images = await getSignedProductImages(rows.map((item) => item.productos?.foto_ruta ?? null));
  const productos = rows.map((item) => {
    if (!item.productos) throw new Error("Falta un producto referenciado por el inventario");
    return {
      id: item.productos.id, nombre: item.productos.nombre,
      categoria: item.productos.categorias?.nombre ?? "Sin categoría",
      cantidad: item.cantidad,
      fotoUrl: item.productos.foto_ruta ? images.get(item.productos.foto_ruta) ?? null : null,
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return { id: option.id, codigo: option.codigo, piso: option.piso, posicion: option.posicion,
    ocupado: productos.length > 0, productos };
}
