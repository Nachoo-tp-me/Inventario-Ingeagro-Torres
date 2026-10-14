export type CompartmentOption = {
  tipo: "compartimiento";
  id: number;
  codigo: string;
  torre_id: number;
  piso: number;
  posicion: number;
};

export type BoxLocationOption = {
  tipo: "caja";
  id: number;
  codigo: string;
  estante_id: number;
  posicion: number;
};

export type PhysicalLocationOption = CompartmentOption | BoxLocationOption;

export type PhysicalLocationRow = {
  tipo: string;
  id: number;
  codigo: string;
  torre_id: number | null;
  piso: number | null;
  estante_id: number | null;
  posicion: number;
};

export function isLocationId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function toPhysicalLocation(row: PhysicalLocationRow): PhysicalLocationOption {
  if (!isLocationId(row.id) || !row.codigo ||
      !Number.isInteger(row.posicion) || row.posicion < 1 || row.posicion > 4) {
    throw new Error("Ubicación física inválida.");
  }
  const common = { id: row.id, codigo: row.codigo, posicion: row.posicion };
  if (row.tipo === "compartimiento" && isLocationId(row.torre_id) &&
      Number.isInteger(row.piso) && row.piso !== null && row.piso >= 1 && row.piso <= 6 &&
      row.estante_id === null) {
    return { ...common, tipo: "compartimiento", torre_id: row.torre_id, piso: row.piso };
  }
  if (row.tipo === "caja" && isLocationId(row.estante_id) &&
      row.torre_id === null && row.piso === null) {
    return { ...common, tipo: "caja", estante_id: row.estante_id };
  }
  throw new Error("Ubicación física inválida.");
}

const BOX_POSITIONS = ["Superior izquierda", "Superior derecha", "Inferior izquierda", "Inferior derecha"];

export function physicalLocationContext(location: PhysicalLocationOption): string {
  return location.tipo === "caja"
    ? `Estante ${location.estante_id} · ${BOX_POSITIONS[location.posicion - 1]}`
    : `Torre C${location.torre_id} · Piso ${location.piso} · Compartimiento ${location.posicion}`;
}

export type ProductOption = {
  id: string;
  nombre: string;
  categoria: string;
};

export type StockOperationType = "entrada" | "retiro" | "traslado" | "ajuste";

export type StockOperationInput = {
  tipo: StockOperationType;
  productoId: string;
  origenId?: number;
  destinoId?: number;
  cantidad?: number;
  cantidadFisica?: number;
  cantidadEsperada?: number;
};

export const MAX_STOCK_QUANTITY = 2147483647;

export function parseQuantity(value: string, allowZero = false): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isSafeInteger(number) &&
    number <= MAX_STOCK_QUANTITY &&
    (allowZero ? number >= 0 : number > 0)
    ? number
    : null;
}

export function validateStockOperation(input: StockOperationInput): string | null {
  if (!input.productoId) return "Selecciona un producto.";
  if (input.tipo === "ajuste") {
    if (!isLocationId(input.origenId))
      return "Selecciona una ubicación válida.";
    if (!Number.isInteger(input.cantidadFisica) ||
        (input.cantidadFisica ?? -1) < 0 ||
        (input.cantidadFisica ?? 0) > MAX_STOCK_QUANTITY)
      return "La cantidad física debe ser un entero igual o mayor que cero.";
    if (!Number.isInteger(input.cantidadEsperada) ||
        (input.cantidadEsperada ?? -1) < 0 ||
        (input.cantidadEsperada ?? 0) > MAX_STOCK_QUANTITY)
      return "Actualiza el stock registrado e inténtalo de nuevo.";
    return null;
  }
  if (!Number.isInteger(input.cantidad) ||
      (input.cantidad ?? 0) <= 0 ||
      (input.cantidad ?? 0) > MAX_STOCK_QUANTITY)
    return "La cantidad debe ser un entero mayor que cero.";
  if (input.tipo === "entrada") {
    if (!isLocationId(input.destinoId))
      return "Selecciona una ubicación de destino.";
  } else if (input.tipo === "retiro") {
    if (!isLocationId(input.origenId))
      return "Selecciona una ubicación de origen.";
  } else if (input.tipo === "traslado") {
    if (!isLocationId(input.origenId) || !isLocationId(input.destinoId))
      return "Selecciona origen y destino válidos.";
    if (input.origenId === input.destinoId)
      return "Selecciona una ubicación diferente para el destino.";
  } else {
    return "Selecciona una operación válida.";
  }
  return null;
}
