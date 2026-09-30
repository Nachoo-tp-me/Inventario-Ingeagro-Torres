"use server";

import { requireAuthorizedUser } from "@/lib/auth";
import { getSignedProductImages } from "@/lib/product-catalog";
import { comparableProductName, normalizeLocationCode } from "@/lib/rapid-model";

export type SearchProduct = {
  id: string; nombre: string; categoria: string; fotoUrl: string | null;
  stock: number; ubicaciones: number; principales: { codigo: string; cantidad: number }[];
};
export type SearchLocation = {
  codigo: string; torre: string; piso: number; posicion: number;
  productos: { nombre: string; cantidad: number }[];
};
export type SearchResult = {
  products: SearchProduct[]; location: SearchLocation | null; locationAttempt: boolean;
};

const empty: SearchResult = { products: [], location: null, locationAttempt: false };
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

export async function searchInventory(rawQuery: string): Promise<SearchResult> {
  const supabase = await requireAuthorizedUser();
  const query = typeof rawQuery === "string" ? rawQuery.trim().slice(0, 100) : "";
  if (!query) return empty;
  const code = normalizeLocationCode(query);
  const locationAttempt = /^C\d+$/i.test(code);
  const folded = comparableProductName(query);
  const pattern = `%${escapeLike(query)}%`;

  const [names, normalized, categories, compartment] = await Promise.all([
    supabase.from("productos").select("id,nombre,categoria_id,foto_ruta,categorias(nombre)")
      .ilike("nombre", pattern).order("nombre").limit(25),
    folded ? supabase.from("productos").select("id,nombre,categoria_id,foto_ruta,categorias(nombre)")
      .ilike("nombre_normalizado", `%${escapeLike(folded)}%`).order("nombre").limit(25)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("categorias").select("id").ilike("nombre", pattern).limit(20),
    locationAttempt ? supabase.from("compartimientos")
      .select("id,codigo,torre_id,piso,posicion").eq("codigo", code).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [names, normalized, categories, compartment]) if (result.error) throw result.error;
  const categoryIds = (categories.data ?? []).map((item) => item.id);
  const byCategory = categoryIds.length ? await supabase.from("productos")
    .select("id,nombre,categoria_id,foto_ruta,categorias(nombre)")
    .in("categoria_id", categoryIds).order("nombre").limit(25)
    : { data: [], error: null };
  if (byCategory.error) throw byCategory.error;

  type Row = NonNullable<typeof names.data>[number];
  const matches = new Map<string, Row>();
  for (const row of [...(names.data ?? []), ...(normalized.data ?? []), ...(byCategory.data ?? [])])
    matches.set(row.id, row);
  const rows = [...matches.values()]
    .sort((a, b) => Number(comparableProductName(b.nombre) === folded) -
      Number(comparableProductName(a.nombre) === folded) || a.nombre.localeCompare(b.nombre, "es"))
    .slice(0, 25);
  const ids = rows.map((row) => row.id);
  async function matchingStock() {
    if (!ids.length) return [] as { producto_id: string; cantidad: number; compartimientos: unknown }[];
    const all = [] as { producto_id: string; cantidad: number; compartimientos: unknown }[];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from("inventario")
        .select("producto_id,cantidad,compartimientos(codigo)").in("producto_id", ids)
        .gt("cantidad", 0).order("producto_id").order("compartimiento_id")
        .range(start, start + 999);
      if (error) throw error;
      all.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return all;
  }
  const [stock, locationStock, images] = await Promise.all([
    matchingStock(),
    compartment.data ? supabase.from("inventario")
      .select("cantidad,productos(nombre)").eq("compartimiento_id", compartment.data.id)
      .gt("cantidad", 0).limit(100) : Promise.resolve({ data: [], error: null }),
    getSignedProductImages(rows.map((row) => row.foto_ruta)),
  ]);
  if (locationStock.error) throw locationStock.error;
  const stockById = new Map<string, { codigo: string; cantidad: number }[]>();
  for (const item of stock) {
    const list = stockById.get(item.producto_id) ?? [];
    list.push({ codigo: (item.compartimientos as unknown as { codigo: string } | null)?.codigo ?? "?", cantidad: item.cantidad });
    stockById.set(item.producto_id, list);
  }
  const products = rows.map((row) => {
    const locations = stockById.get(row.id) ?? [];
    return {
      id: row.id, nombre: row.nombre,
      categoria: (row.categorias as unknown as { nombre: string } | null)?.nombre ?? "Sin categoría",
      fotoUrl: row.foto_ruta ? images.get(row.foto_ruta) ?? null : null,
      stock: locations.reduce((sum, item) => sum + item.cantidad, 0),
      ubicaciones: locations.length,
      principales: locations.sort((a, b) => b.cantidad - a.cantidad).slice(0, 3),
    };
  });
  const place = compartment.data;
  return {
    products,
    locationAttempt,
    location: place ? {
      codigo: place.codigo, torre: `C${place.torre_id}`, piso: place.piso,
      posicion: place.posicion,
      productos: (locationStock.data ?? []).map((item) => ({
        nombre: (item.productos as unknown as { nombre: string } | null)?.nombre ?? "Producto",
        cantidad: item.cantidad,
      })),
    } : null,
  };
}
