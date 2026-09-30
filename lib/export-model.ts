export type ExportProduct = {
  id: string;
  nombre: string;
  categoria: string;
  descripcion: string | null;
};
export type ExportStock = { producto_id: string; compartimiento_id: number; cantidad: number };
export type ExportCompartment = {
  id: number; codigo: string; torre_id: number; piso: number; posicion: number;
};
export type ExportTower = { id: number; codigo: string };
export type ExportRow = {
  producto: string; categoria: string; descripcion: string;
  cantidad: number; ubicacion: string; torre: string;
  piso: number | null; compartimiento: number | null;
};
export type ExportTowerMap = {
  codigo: string; total: number; ocupados: number; disponibles: number;
  compartimientos: { codigo: string; piso: number; posicion: number; ocupado: boolean }[];
};
export type ExportSnapshot = {
  generadoEn: string;
  rows: ExportRow[];
  resumen: {
    productos: number; unidades: number; compartimientos: number;
    ocupados: number; disponibles: number;
  };
  torres: ExportTowerMap[];
};

export const INVENTORY_HEADERS = [
  "Producto", "Categoría", "Descripción", "Cantidad", "Ubicación",
  "Torre", "Piso", "Compartimiento",
];

export function buildExportSnapshot(
  products: ExportProduct[], stock: ExportStock[],
  compartments: ExportCompartment[], towers: ExportTower[], generatedAt: string,
): ExportSnapshot {
  const productsById = new Map(products.map((item) => [item.id, item]));
  const compartmentsById = new Map(compartments.map((item) => [item.id, item]));
  const towersById = new Map(towers.map((item) => [item.id, item]));
  const occupied = new Set<number>();
  const stockedProducts = new Set<string>();
  const rows: ExportRow[] = [];
  let units = 0;
  for (const item of stock) {
    if (item.cantidad <= 0) continue;
    const product = productsById.get(item.producto_id);
    const compartment = compartmentsById.get(item.compartimiento_id);
    if (!product || !compartment) throw new Error("Referencia de inventario incompleta");
    const tower = towersById.get(compartment.torre_id);
    if (!tower) throw new Error("Torre de inventario incompleta");
    rows.push({ producto: product.nombre, categoria: product.categoria,
      descripcion: product.descripcion ?? "", cantidad: item.cantidad,
      ubicacion: compartment.codigo, torre: tower.codigo,
      piso: compartment.piso, compartimiento: compartment.posicion });
    units += item.cantidad;
    occupied.add(compartment.id);
    stockedProducts.add(product.id);
  }
  rows.sort((a, b) => a.torre.localeCompare(b.torre, "es") ||
    (b.piso ?? 0) - (a.piso ?? 0) ||
    (a.compartimiento ?? 0) - (b.compartimiento ?? 0) ||
    a.producto.localeCompare(b.producto, "es"));
  for (const product of products) if (!stockedProducts.has(product.id)) {
    rows.push({ producto: product.nombre, categoria: product.categoria,
      descripcion: product.descripcion ?? "", cantidad: 0, ubicacion: "",
      torre: "", piso: null, compartimiento: null });
  }
  const maps = towers.map((tower) => {
    const places = compartments.filter((item) => item.torre_id === tower.id)
      .sort((a, b) => b.piso - a.piso || a.posicion - b.posicion)
      .map((item) => ({ codigo: item.codigo, piso: item.piso,
        posicion: item.posicion, ocupado: occupied.has(item.id) }));
    const ocupados = places.filter((item) => item.ocupado).length;
    return { codigo: tower.codigo, total: places.length, ocupados,
      disponibles: places.length - ocupados, compartimientos: places };
  });
  return { generadoEn: generatedAt, rows,
    resumen: { productos: products.length, unidades: units,
      compartimientos: compartments.length, ocupados: occupied.size,
      disponibles: compartments.length - occupied.size }, torres: maps };
}

function safeSpreadsheetText(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : typeof value === "string" ? safeSpreadsheetText(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function inventoryCsv(snapshot: ExportSnapshot): string {
  const records = [INVENTORY_HEADERS, ...snapshot.rows.map((row) => [
    row.producto, row.categoria, row.descripcion, row.cantidad, row.ubicacion,
    row.torre, row.piso, row.compartimiento,
  ])];
  return `\uFEFF${records.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export function inventoryWorkbookData(snapshot: ExportSnapshot) {
  return [
    { sheet: "Inventario", data: [INVENTORY_HEADERS, ...snapshot.rows.map((row) => [
      row.producto, row.categoria, row.descripcion, row.cantidad,
      row.ubicacion, row.torre, row.piso ?? "", row.compartimiento ?? "",
    ])] },
    { sheet: "Resumen", data: [
      ["Indicador", "Valor"],
      ["Productos", snapshot.resumen.productos],
      ["Unidades totales", snapshot.resumen.unidades],
      ["Compartimientos totales", snapshot.resumen.compartimientos],
      ["Ocupados", snapshot.resumen.ocupados],
      ["Disponibles", snapshot.resumen.disponibles],
      [],
      ["Torre", "Total", "Ocupados", "Disponibles"],
      ...snapshot.torres.map((tower) => [tower.codigo, tower.total, tower.ocupados, tower.disponibles]),
    ] },
  ];
}
