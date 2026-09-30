import { requireAuthorizedUser } from "@/lib/auth";
import { getSignedProductImages } from "@/lib/product-catalog";
import {
  buildTowerDetail,
  type CategoryRow,
  type CompartmentRow,
  type ProductRow,
  type StockRow,
  type TowerDetail,
  type TowerRow,
} from "@/lib/tower-model";

const STOCK_PAGE_SIZE = 1000;
const ID_BATCH_SIZE = 100;

export async function getTowerDetail(
  codigo: string,
): Promise<TowerDetail | null> {
  const supabase = await requireAuthorizedUser();
  const { data: tower, error: towerError } = await supabase
    .from("torres")
    .select("id,codigo")
    .eq("codigo", codigo.toUpperCase())
    .maybeSingle();
  if (towerError) throw towerError;
  if (!tower) return null;

  const { data: compartments, error: compartmentsError } = await supabase
    .from("compartimientos")
    .select("id,codigo,piso,posicion")
    .eq("torre_id", tower.id)
    .order("piso", { ascending: false })
    .order("posicion");
  if (compartmentsError) throw compartmentsError;

  const compartmentRows = (compartments ?? []) as CompartmentRow[];
  const compartmentIds = compartmentRows.map((item) => item.id);
  const stockRows: StockRow[] = [];

  if (compartmentIds.length > 0) {
    for (let start = 0; ; start += STOCK_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("inventario")
        .select("compartimiento_id,producto_id,cantidad")
        .in("compartimiento_id", compartmentIds)
        .gt("cantidad", 0)
        .order("compartimiento_id")
        .order("producto_id")
        .range(start, start + STOCK_PAGE_SIZE - 1);
      if (error) throw error;
      stockRows.push(...((data ?? []) as StockRow[]));
      if (!data || data.length < STOCK_PAGE_SIZE) break;
    }
  }

  const productIds = [...new Set(stockRows.map((item) => item.producto_id))];
  const productRows: ProductRow[] = [];
  for (let start = 0; start < productIds.length; start += ID_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("productos")
      .select("id,nombre,categoria_id,foto_ruta")
      .in("id", productIds.slice(start, start + ID_BATCH_SIZE));
    if (error) throw error;
    productRows.push(...((data ?? []) as ProductRow[]));
  }

  const categoryIds = [
    ...new Set(productRows.map((item) => item.categoria_id)),
  ];
  const categoryRows: CategoryRow[] = [];
  for (let start = 0; start < categoryIds.length; start += ID_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("categorias")
      .select("id,nombre")
      .in("id", categoryIds.slice(start, start + ID_BATCH_SIZE));
    if (error) throw error;
    categoryRows.push(...((data ?? []) as CategoryRow[]));
  }

  const imageUrls = await getSignedProductImages(productRows.map((row) => row.foto_ruta));

  return buildTowerDetail(
    tower as TowerRow,
    compartmentRows,
    stockRows,
    productRows,
    categoryRows,
    imageUrls,
  );
}
