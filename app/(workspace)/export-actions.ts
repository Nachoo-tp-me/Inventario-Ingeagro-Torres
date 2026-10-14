"use server";

import { requireAuthorizedUser } from "@/lib/auth";
import { buildExportSnapshot, type ExportStock, type ExportTower } from "@/lib/export-model";
import { toPhysicalLocation, type PhysicalLocationRow } from "@/lib/stock-model";
import type { ShelfRow } from "@/lib/shelf-model";

type ExportProductRow = { id: string; nombre: string; descripcion: string | null; categorias: unknown };

export async function getExportSnapshot() {
  const supabase = await requireAuthorizedUser();
  // Avanza por las filas recibidas, también si PostgREST aplica un límite
  // inferior a 1000. Una página vacía confirma el final de cada lectura.
  async function pages<T>(read: (start: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
    const result: T[] = [];
    for (let start = 0; ;) {
      const { data, error } = await read(start);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("No se pudo verificar una lectura de exportación");
      if (!data.length) return result;
      result.push(...data);
      start += data.length;
    }
  }
  // Limitación V1: lecturas y páginas no comparten una instantánea
  // transaccional ante escrituras o renombrados concurrentes.
  const [products, stock, locations, towers, shelves] = await Promise.all([
    pages<ExportProductRow>(start => supabase.from("productos")
      .select("id,nombre,descripcion,categorias(nombre)").order("id").range(start, start + 999)),
    pages<ExportStock>(start => supabase.from("inventario")
      .select("producto_id,compartimiento_id,cantidad").gt("cantidad", 0)
      .order("producto_id").order("compartimiento_id").range(start, start + 999)),
    pages<PhysicalLocationRow>(start => supabase.from("compartimientos")
      .select("id,codigo,tipo,torre_id,piso,estante_id,posicion").order("id").range(start, start + 999)),
    pages<ExportTower>(start => supabase.from("torres").select("id,codigo").order("id").range(start, start + 999)),
    pages<ShelfRow>(start => supabase.from("estantes").select("id,nombre,grupo").order("id").range(start, start + 999)),
  ]);
  return buildExportSnapshot(products.map(item => ({ id: item.id, nombre: item.nombre,
    categoria: (item.categorias as { nombre: string } | null)?.nombre ?? "Sin categoría",
    descripcion: item.descripcion })), stock, locations.map(toPhysicalLocation), towers, new Date().toISOString(), shelves);
}
