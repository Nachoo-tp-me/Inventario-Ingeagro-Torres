export type CompartmentOption = {
  id: number;
  codigo: string;
  torre_id: number;
  piso: number;
  posicion: number;
};

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
    if (!Number.isInteger(input.origenId) || (input.origenId ?? 0) <= 0)
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
    if (!Number.isInteger(input.destinoId) || (input.destinoId ?? 0) <= 0)
      return "Selecciona una ubicación de destino.";
  } else if (input.tipo === "retiro") {
    if (!Number.isInteger(input.origenId) || (input.origenId ?? 0) <= 0)
      return "Selecciona una ubicación de origen.";
  } else if (input.tipo === "traslado") {
    if (!Number.isInteger(input.origenId) || (input.origenId ?? 0) <= 0 ||
        !Number.isInteger(input.destinoId) || (input.destinoId ?? 0) <= 0)
      return "Selecciona origen y destino válidos.";
    if (input.origenId === input.destinoId)
      return "Selecciona una ubicación diferente para el destino.";
  } else {
    return "Selecciona una operación válida.";
  }
  return null;
}
