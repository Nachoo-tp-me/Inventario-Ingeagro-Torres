"use server";

import { requireAuthorizedUser } from "@/lib/auth";
import { getSignedProductImages } from "@/lib/product-catalog";
import { matchesCatalogQuery, matchesNormalizedCatalogQuery, normalizeCatalogSearch } from "@/lib/rapid-model";
import { createSearchMetadataCache } from "@/lib/search-metadata-cache";
import { normalizeSearchLocationCode, searchLocationHref } from "@/lib/location-search-model";
import { isLocationId, physicalLocationContext, toPhysicalLocation, type PhysicalLocationOption } from "@/lib/stock-model";

export type SearchProduct = {
  id: string; nombre: string; categoria: string; fotoUrl: string | null;
  stock: number; ubicaciones: number; principales: { codigo: string; cantidad: number }[];
};
export type SearchLocation = PhysicalLocationOption & {
  matchedCode: string; historical: boolean; href: string; context: string;
  productos: { nombre: string; cantidad: number }[];
};
export type SearchResult = {
  products: SearchProduct[]; location: SearchLocation | null; locationAttempt: boolean;
};

const empty: SearchResult = { products: [], location: null, locationAttempt: false };
type SearchMetadata = { id: string; nombre: string; normalizedName: string; normalizedCategory: string };
// This app authorizes a single fixed account. The cache stays in the server
// process and is accessed only AFTER requireAuthorizedUser, on every request.
// Limitaciones conocidas de V1 (B3):
// - Cada proceso/instancia mantiene su propia caché; no hay coordinación entre ellos.
// - Su alcance es la cuenta autorizada única; no distingue usuarios, roles ni permisos.
// - Nuevos productos o nuevas coincidencias pueden esperar los 15 segundos de vigencia
//   y la siguiente recarga bajo demanda; no hay invalidación inmediata por cambios.
// - La revalidación descarta candidatos eliminados o que dejaron de coincidir, sin
//   rellenar sus puestos: puede devolver menos de 25 resultados hasta la recarga.
// - No hay límite explícito de filas/bytes; el TTL no libera automáticamente la memoria.
const readSearchMetadata = createSearchMetadataCache<SearchMetadata[]>();
const RESULT_LIMIT = 25;

export async function searchInventory(rawQuery: string): Promise<SearchResult> {
  const supabase = await requireAuthorizedUser();
  const query = typeof rawQuery === "string" ? rawQuery.trim().slice(0, 100) : "";
  if (!query) return empty;
  const code = normalizeSearchLocationCode(query);
  const locationAttempt = code !== null;
  const folded = normalizeCatalogSearch(query);
  if (!folded && !locationAttempt) return empty;

  async function matchingLocation() {
    if (code === null) return null;
    // Registry ownership is permanent. Both reads use the authorized client,
    // equality filters and at most one row; no physical codes enter the B3 cache.
    const registry = await supabase.from("ubicacion_codigos")
      .select("codigo,compartimiento_id").eq("codigo", code).maybeSingle();
    if (registry.error) throw registry.error;
    if (!registry.data) return null;
    if (registry.data.codigo !== code || !isLocationId(registry.data.compartimiento_id))
      throw new Error("Registro de ubicación inválido.");
    const location = await supabase.from("compartimientos")
      .select("id,codigo,tipo,torre_id,piso,estante_id,posicion")
      .eq("id", registry.data.compartimiento_id).maybeSingle();
    if (location.error) throw location.error;
    // A missing/RLS-hidden location must never yield a fabricated link.
    if (!location.data) return null;
    if (location.data.id !== registry.data.compartimiento_id)
      throw new Error("Ubicación de código inconsistente.");
    return toPhysicalLocation(location.data);
  }

  const [metadata, place] = await Promise.all([
    readSearchMetadata(async () => {
      const all: SearchMetadata[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await supabase.from("productos")
          .select("id,nombre,categorias(nombre)").order("id").range(start, start + 999);
        if (error) throw error;
        for (const row of data ?? []) {
          all.push({
            id: row.id, nombre: row.nombre,
            normalizedName: normalizeCatalogSearch(row.nombre),
            normalizedCategory: normalizeCatalogSearch((row.categorias as unknown as { nombre: string } | null)?.nombre ?? "Sin categoría"),
          });
        }
        if (!data || data.length < 1000) break;
      }
      return all;
    }),
    matchingLocation(),
  ]);
  const matchingIds = metadata
    .filter((row) => matchesNormalizedCatalogQuery(row.normalizedName, row.normalizedCategory, folded))
    .sort((a, b) => Number(b.normalizedName === folded) -
      Number(a.normalizedName === folded) || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id))
    .slice(0, RESULT_LIMIT).map((row) => row.id);
  // Refresh the selected metadata as well as stock/photos: removed or renamed
  // products must not be returned just because they were in the snapshot.
  const selected = matchingIds.length ? await supabase.from("productos")
    .select("id,nombre,foto_ruta,categorias(nombre)").in("id", matchingIds)
    : { data: [], error: null };
  if (selected.error) throw selected.error;
  const rows = (selected.data ?? [])
    .filter((row) => matchesCatalogQuery(row.nombre,
      (row.categorias as unknown as { nombre: string } | null)?.nombre ?? "Sin categoría", query))
    .sort((a, b) => Number(normalizeCatalogSearch(b.nombre) === folded) -
      Number(normalizeCatalogSearch(a.nombre) === folded) || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id));
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
    place ? supabase.from("inventario")
      .select("cantidad,productos(nombre)").eq("compartimiento_id", place.id)
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
  return {
    products,
    locationAttempt,
    location: place ? {
      ...place, matchedCode: code!, historical: place.codigo !== code,
      href: searchLocationHref(place), context: physicalLocationContext(place),
      productos: (locationStock.data ?? []).map((item) => ({
        nombre: (item.productos as unknown as { nombre: string } | null)?.nombre ?? "Producto",
        cantidad: item.cantidad,
      })),
    } : null,
  };
}
