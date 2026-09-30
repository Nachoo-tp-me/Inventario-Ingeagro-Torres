"use server";

import { requireAuthorizedUser } from "@/lib/auth";
import {
  buildExportSnapshot,
  type ExportCompartment,
  type ExportProduct,
  type ExportStock,
  type ExportTower,
} from "@/lib/export-model";

export async function getExportSnapshot() {
  const supabase = await requireAuthorizedUser();
  async function products(): Promise<ExportProduct[]> {
    const result: ExportProduct[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from("productos")
        .select("id,nombre,descripcion,categorias(nombre)")
        .order("id").range(start, start + 999);
      if (error) throw error;
      result.push(...(data ?? []).map((item) => ({ id: item.id, nombre: item.nombre,
        categoria: (item.categorias as unknown as { nombre: string } | null)?.nombre ?? "Sin categoría",
        descripcion: item.descripcion })));
      if (!data || data.length < 1000) break;
    }
    return result;
  }
  async function stock(): Promise<ExportStock[]> {
    const result: ExportStock[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from("inventario")
        .select("producto_id,compartimiento_id,cantidad")
        .gt("cantidad", 0).order("producto_id").order("compartimiento_id")
        .range(start, start + 999);
      if (error) throw error;
      result.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return result;
  }
  const [productRows, stockRows, compartments, towers] = await Promise.all([
    products(), stock(),
    supabase.from("compartimientos").select("id,codigo,torre_id,piso,posicion").order("id"),
    supabase.from("torres").select("id,codigo").order("id"),
  ]);
  if (compartments.error) throw compartments.error;
  if (towers.error) throw towers.error;
  return buildExportSnapshot(productRows, stockRows,
    (compartments.data ?? []) as ExportCompartment[],
    (towers.data ?? []) as ExportTower[], new Date().toISOString());
}
