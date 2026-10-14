import type { PhysicalLocationOption, CompartmentOption } from "./stock-model.ts";
import type { ShelfRow } from "./shelf-model.ts";

export type ExportProduct = {
  id: string;
  nombre: string;
  categoria: string;
  descripcion: string | null;
};
export type ExportStock = { producto_id: string; compartimiento_id: number; cantidad: number };
export type ExportCompartment = CompartmentOption;
export type ExportTower = { id: number; codigo: string };
export type ExportRow = {
  producto: string; categoria: string; descripcion: string;
  cantidad: number; ubicacion: string; torre: string;
  piso: number | null; compartimiento: number | null;
  tipoUbicacion: "Compartimiento" | "Caja" | "";
  estante: string; posicionCaja: string;
};
export type ExportShelfMap = ShelfRow & {
  total: number; ocupados: number; disponibles: number;
  cajas: { codigo: string; posicion: number; ocupado: boolean }[];
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
    cajas: number; ubicaciones: number;
  };
  torres: ExportTowerMap[];
  estantes: ExportShelfMap[];
};

export const INVENTORY_HEADERS = [
  "Producto", "Categoría", "Descripción", "Cantidad", "Ubicación",
  "Torre", "Piso", "Compartimiento",
  // V2: las ocho columnas anteriores mantienen su orden y significado.
  "Tipo de ubicación", "Estante", "Posición de caja",
];
const BOX_POSITIONS = ["Superior izquierda", "Superior derecha", "Inferior izquierda", "Inferior derecha"];

export function buildExportSnapshot(
  products: ExportProduct[], stock: ExportStock[],
  locations: PhysicalLocationOption[], towers: ExportTower[], generatedAt: string,
  shelves: ShelfRow[] = [],
): ExportSnapshot {
  const productsById = new Map(products.map((item) => [item.id, item]));
  const locationsById = new Map(locations.map((item) => [item.id, item]));
  const towersById = new Map(towers.map((item) => [item.id, item]));
  const shelvesById = new Map(shelves.map((item) => [item.id, item]));
  if (productsById.size !== products.length || locationsById.size !== locations.length ||
      towersById.size !== towers.length || shelvesById.size !== shelves.length) {
    throw new Error("Registros duplicados en la exportación");
  }
  const compartments = locations.filter((item): item is CompartmentOption => item.tipo === "compartimiento");
  for (const location of locations) {
    if (location.tipo === "compartimiento" && !towersById.has(location.torre_id))
      throw new Error("Referencia de torre incompleta");
    if (location.tipo === "caja" && !shelvesById.has(location.estante_id))
      throw new Error("Referencia de estante incompleta");
  }
  const occupied = new Set<number>();
  const stockedProducts = new Set<string>();
  const rows: ExportRow[] = [];
  const stockPairs = new Set<string>();
  let units = 0;
  for (const item of stock) {
    if (item.cantidad <= 0) continue;
    const product = productsById.get(item.producto_id);
    const location = locationsById.get(item.compartimiento_id);
    if (!product || !location) throw new Error("Referencia de inventario incompleta");
    const pair = `${item.producto_id}:${item.compartimiento_id}`;
    if (stockPairs.has(pair) || !Number.isSafeInteger(item.cantidad)) throw new Error("Inventario duplicado o cantidad inválida");
    stockPairs.add(pair);
    let towerCode = "", shelfName = "";
    if (location.tipo === "compartimiento") {
      const tower = towersById.get(location.torre_id);
      if (!tower) throw new Error("Referencia de torre incompleta");
      towerCode = tower.codigo;
    } else {
      const shelf = shelvesById.get(location.estante_id);
      if (!shelf) throw new Error("Referencia de estante incompleta");
      shelfName = shelf.nombre;
    }
    rows.push({ producto: product.nombre, categoria: product.categoria,
      descripcion: product.descripcion ?? "", cantidad: item.cantidad,
      ubicacion: location.codigo, torre: towerCode,
      piso: location.tipo === "compartimiento" ? location.piso : null,
      compartimiento: location.tipo === "compartimiento" ? location.posicion : null,
      tipoUbicacion: location.tipo === "caja" ? "Caja" : "Compartimiento",
      estante: shelfName,
      posicionCaja: location.tipo === "caja" ? `${location.posicion} · ${BOX_POSITIONS[location.posicion - 1]}` : "" });
    units += item.cantidad;
    occupied.add(location.id);
    stockedProducts.add(product.id);
  }
  rows.sort((a, b) => (a.tipoUbicacion === "Caja" ? 1 : 0) - (b.tipoUbicacion === "Caja" ? 1 : 0) ||
    a.torre.localeCompare(b.torre, "es") ||
    (b.piso ?? 0) - (a.piso ?? 0) ||
    (a.compartimiento ?? 0) - (b.compartimiento ?? 0) ||
    a.estante.localeCompare(b.estante, "es", { numeric: true }) || a.posicionCaja.localeCompare(b.posicionCaja, "es") ||
    a.producto.localeCompare(b.producto, "es"));
  for (const product of products) if (!stockedProducts.has(product.id)) {
    rows.push({ producto: product.nombre, categoria: product.categoria,
      descripcion: product.descripcion ?? "", cantidad: 0, ubicacion: "",
      torre: "", piso: null, compartimiento: null, tipoUbicacion: "", estante: "", posicionCaja: "" });
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
  const shelfMaps = [...shelves].sort((a, b) => a.id - b.id).map(shelf => {
    const boxes = locations.filter(item => item.tipo === "caja" && item.estante_id === shelf.id)
      .sort((a, b) => a.posicion - b.posicion);
    if (boxes.length !== 4 || boxes.some((box, index) => box.posicion !== index + 1) || !["A", "B"].includes(shelf.grupo))
      throw new Error("El estante no tiene sus cuatro posiciones físicas disponibles");
    const cajas = boxes.map(box => ({ codigo: box.codigo, posicion: box.posicion, ocupado: occupied.has(box.id) }));
    const ocupados = cajas.filter(box => box.ocupado).length;
    return { ...shelf, total: cajas.length, ocupados, disponibles: cajas.length - ocupados, cajas };
  });
  return { generadoEn: generatedAt, rows,
    resumen: { productos: products.length, unidades: units,
      compartimientos: compartments.length, ocupados: occupied.size,
      disponibles: locations.length - occupied.size, cajas: locations.length - compartments.length,
      ubicaciones: locations.length }, torres: maps, estantes: shelfMaps };
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
    row.tipoUbicacion, row.estante, row.posicionCaja,
  ])];
  return `\uFEFF${records.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export function inventoryWorkbookData(snapshot: ExportSnapshot) {
  return [
    { sheet: "Inventario", data: [INVENTORY_HEADERS, ...snapshot.rows.map((row) => [
      row.producto, row.categoria, row.descripcion, row.cantidad,
      row.ubicacion, row.torre, row.piso ?? "", row.compartimiento ?? "",
      row.tipoUbicacion, row.estante, row.posicionCaja,
    ])] },
    { sheet: "Resumen", data: [
      ["Indicador", "Valor"],
      ["Productos", snapshot.resumen.productos],
      ["Unidades totales", snapshot.resumen.unidades],
      ["Compartimientos totales", snapshot.resumen.compartimientos],
      ["Ocupados", snapshot.resumen.ocupados],
      ["Disponibles", snapshot.resumen.disponibles],
      ["Ubicaciones totales", snapshot.resumen.ubicaciones],
      ["Cajas totales", snapshot.resumen.cajas],
      [],
      ["Torre", "Total", "Ocupados", "Disponibles"],
      ...snapshot.torres.map((tower) => [tower.codigo, tower.total, tower.ocupados, tower.disponibles]),
      [],
      ["Estante", "Grupo", "Total", "Ocupados", "Disponibles"],
      ...snapshot.estantes.map((shelf) => [shelf.nombre, shelf.grupo, shelf.total, shelf.ocupados, shelf.disponibles]),
    ] },
  ];
}
