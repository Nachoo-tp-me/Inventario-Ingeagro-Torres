import { requireAuthorizedUser } from "@/lib/auth";
import type { CompartmentOption, ProductOption } from "@/lib/stock-model";

export async function getCompartments(): Promise<CompartmentOption[]> {
  const supabase = await requireAuthorizedUser();
  const { data, error } = await supabase
    .from("compartimientos")
    .select("id,codigo,torre_id,piso,posicion")
    .order("torre_id")
    .order("piso")
    .order("posicion");
  if (error) throw error;
  return data ?? [];
}

export async function getProductOptions(): Promise<ProductOption[]> {
  const supabase = await requireAuthorizedUser();
  const options: ProductOption[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from("productos")
      .select("id,nombre,categorias(nombre)")
      .order("nombre")
      .order("id")
      .range(start, start + 999);
    if (error) throw error;
    options.push(...(data ?? []).map((row) => ({
      id: row.id,
      nombre: row.nombre,
      categoria: (row.categorias as unknown as { nombre: string } | null)?.nombre ?? "Sin categoría",
    })));
    if (!data || data.length < 1000) break;
  }
  return options;
}

export type HistoryEntry = {
  id: number;
  fecha: string;
  tipo: "entrada" | "retiro" | "traslado" | "ajuste";
  cantidad: number;
  producto: string;
  origen: string | null;
  destino: string | null;
};

const HISTORY_PAGE_SIZE = 50;

export async function getHistory(page: number) {
  const supabase = await requireAuthorizedUser();
  const start = (page - 1) * HISTORY_PAGE_SIZE;
  const { data, error } = await supabase
    .from("movimientos")
    .select("id,fecha,tipo,cantidad,producto_id,origen_compartimiento_id,destino_compartimiento_id")
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + HISTORY_PAGE_SIZE);
  if (error) throw error;
  const rows = data ?? [];
  const visible = rows.slice(0, HISTORY_PAGE_SIZE);
  const productIds = [...new Set(visible.map((row) => row.producto_id))];
  const compartmentIds = [...new Set(visible.flatMap((row) =>
    [row.origen_compartimiento_id, row.destino_compartimiento_id]
      .filter((id): id is number => id !== null)))];
  const [productsResult, compartmentsResult] = await Promise.all([
    productIds.length
      ? supabase.from("productos").select("id,nombre").in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
    compartmentIds.length
      ? supabase.from("compartimientos").select("id,codigo").in("id", compartmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (compartmentsResult.error) throw compartmentsResult.error;
  const products = new Map((productsResult.data ?? []).map((item) => [item.id, item.nombre]));
  const compartments = new Map((compartmentsResult.data ?? []).map((item) => [item.id, item.codigo]));
  const entries: HistoryEntry[] = visible.map((row) => ({
    id: row.id,
    fecha: row.fecha,
    tipo: row.tipo as HistoryEntry["tipo"],
    cantidad: row.cantidad,
    producto: products.get(row.producto_id) ?? "Producto no disponible",
    origen: row.origen_compartimiento_id !== null
      ? compartments.get(row.origen_compartimiento_id) ?? null : null,
    destino: row.destino_compartimiento_id !== null
      ? compartments.get(row.destino_compartimiento_id) ?? null : null,
  }));
  return { entries, hasNext: rows.length > HISTORY_PAGE_SIZE };
}
