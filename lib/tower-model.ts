export type TowerRow = { id: number; codigo: string };
export type CompartmentRow = {
  id: number;
  codigo: string;
  piso: number;
  posicion: number;
};
export type StockRow = {
  compartimiento_id: number;
  producto_id: string;
  cantidad: number;
};
export type ProductRow = {
  id: string;
  nombre: string;
  categoria_id: string;
  foto_ruta: string | null;
};
export type CategoryRow = { id: string; nombre: string };

export type CompartmentProduct = {
  id: string;
  nombre: string;
  categoria: string;
  cantidad: number;
  fotoUrl: string | null;
};

export type TowerCompartment = CompartmentRow & {
  ocupado: boolean;
  productos: CompartmentProduct[];
};

export type TowerDetail = TowerRow & {
  total: number;
  ocupados: number;
  disponibles: number;
  pisos: { numero: number; compartimientos: TowerCompartment[] }[];
};

export function buildTowerDetail(
  tower: TowerRow,
  compartments: CompartmentRow[],
  stock: StockRow[],
  products: ProductRow[],
  categories: CategoryRow[],
  imageUrls: Map<string, string>,
): TowerDetail {
  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );
  const categoriesById = new Map(
    categories.map((category) => [category.id, category.nombre]),
  );
  const stockByCompartment = new Map<number, StockRow[]>();

  for (const row of stock) {
    if (row.cantidad <= 0) continue;
    const rows = stockByCompartment.get(row.compartimiento_id) ?? [];
    rows.push(row);
    stockByCompartment.set(row.compartimiento_id, rows);
  }

  const detailedCompartments: TowerCompartment[] = compartments.map((item) => {
    const productos = (stockByCompartment.get(item.id) ?? []).map((row) => {
      const product = productsById.get(row.producto_id);
      if (!product)
        throw new Error("Falta un producto referenciado por el inventario");
      const categoria = categoriesById.get(product.categoria_id);
      if (!categoria)
        throw new Error("Falta la categoría referenciada por un producto");
      return {
        id: product.id,
        nombre: product.nombre,
        categoria,
        cantidad: row.cantidad,
        fotoUrl: product.foto_ruta ? imageUrls.get(product.foto_ruta) ?? null : null,
      };
    });
    productos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return { ...item, ocupado: productos.length > 0, productos };
  });

  const floorNumbers = [
    ...new Set(detailedCompartments.map((item) => item.piso)),
  ].sort((a, b) => b - a);
  const pisos = floorNumbers.map((numero) => ({
    numero,
    compartimientos: detailedCompartments
      .filter((item) => item.piso === numero)
      .sort((a, b) => a.posicion - b.posicion),
  }));
  const ocupados = detailedCompartments.filter((item) => item.ocupado).length;

  return {
    ...tower,
    total: detailedCompartments.length,
    ocupados,
    disponibles: detailedCompartments.length - ocupados,
    pisos,
  };
}
