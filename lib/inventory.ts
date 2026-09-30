import { requireAuthorizedUser } from "@/lib/auth";

export type TowerSummary = {
  id: number;
  codigo: string;
  total: number;
  ocupados: number;
  disponibles: number;
};

export type DashboardSummary = {
  torres: TowerSummary[];
  total: number;
  ocupados: number;
  disponibles: number;
  productos: number;
};

async function getOccupiedCompartments(
  supabase: Awaited<ReturnType<typeof requireAuthorizedUser>>,
) {
  const occupied = new Set<number>();
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("inventario")
      .select("compartimiento_id")
      .gt("cantidad", 0)
      .order("compartimiento_id")
      .order("producto_id")
      .range(start, start + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) occupied.add(row.compartimiento_id);
    if (!data || data.length < pageSize) break;
  }
  return occupied;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const supabase = await requireAuthorizedUser();
  const [towersResult, compartmentsResult, productsResult, occupied] =
    await Promise.all([
      supabase.from("torres").select("id,codigo").order("id"),
      supabase.from("compartimientos").select("id,torre_id"),
      supabase.from("productos").select("id", { count: "exact", head: true }),
      getOccupiedCompartments(supabase),
    ]);
  if (towersResult.error) throw towersResult.error;
  if (compartmentsResult.error) throw compartmentsResult.error;
  if (productsResult.error) throw productsResult.error;

  const compartments = compartmentsResult.data ?? [];
  const torres = (towersResult.data ?? []).map((tower) => {
    const inTower = compartments.filter((item) => item.torre_id === tower.id);
    const ocupados = inTower.filter((item) => occupied.has(item.id)).length;
    return {
      id: tower.id,
      codigo: tower.codigo,
      total: inTower.length,
      ocupados,
      disponibles: inTower.length - ocupados,
    };
  });
  const ocupados = compartments.filter((item) => occupied.has(item.id)).length;
  return {
    torres,
    total: compartments.length,
    ocupados,
    disponibles: compartments.length - ocupados,
    productos: productsResult.count ?? 0,
  };
}
