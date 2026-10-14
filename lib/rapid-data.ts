import { requireAuthorizedUser } from "@/lib/auth";
import { getSignedProductImages } from "@/lib/product-catalog";
import { isLocationId, toPhysicalLocation, type CompartmentOption, type PhysicalLocationOption } from "@/lib/stock-model";
import type { RapidLocationContent } from "@/lib/rapid-navigation-model";
import type { LocationContent } from "@/lib/location-content";
import { normalizeSearchLocationCode } from "@/lib/location-search-model";

type StockRow = {
  cantidad: number;
  productos: {
    id: string; nombre: string; foto_ruta: string | null;
    categorias: { nombre: string } | null;
  } | null;
};

export async function getRapidLocationByCode(raw: string): Promise<PhysicalLocationOption | null> {
  const supabase = await requireAuthorizedUser();
  if (typeof raw !== "string" || raw.length > 100) return null;
  const code = normalizeSearchLocationCode(raw);
  if (code === null) return null;
  const registry = await supabase.from("ubicacion_codigos").select("codigo,compartimiento_id").eq("codigo", code).maybeSingle();
  if (registry.error) throw registry.error;
  if (!registry.data) return null;
  if (registry.data.codigo !== code || !isLocationId(registry.data.compartimiento_id)) throw new Error("Registro de ubicación inválido.");
  const location = await supabase.from("compartimientos").select("id,codigo,tipo,torre_id,piso,estante_id,posicion").eq("id", registry.data.compartimiento_id).maybeSingle();
  if (location.error) throw location.error;
  if (!location.data) return null;
  if (location.data.id !== registry.data.compartimiento_id) throw new Error("Ubicación de código inconsistente.");
  return toPhysicalLocation(location.data);
}

export async function getRapidCompartment(option: CompartmentOption): Promise<CompartmentOption & LocationContent> {
  const location = await getRapidLocation(option);
  if (location.tipo !== "compartimiento") throw new Error("Se esperaba un compartimiento de torre.");
  return location;
}

export async function getRapidLocation(option: PhysicalLocationOption): Promise<RapidLocationContent> {
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
  return { ...option,
    ocupado: productos.length > 0, productos };
}
