"use server";

import { revalidatePath } from "next/cache";
import { requireAuthorizedUser } from "@/lib/auth";
import {
  validateStockOperation,
  type StockOperationInput,
} from "@/lib/stock-model";

export type StockActionResult = {
  ok: boolean;
  message: string;
  noChange?: boolean;
};

function friendlyStockError(code?: string): string {
  if (code === "23514") return "No hay stock suficiente. El stock pudo haber cambiado; actualiza e inténtalo nuevamente.";
  if (code === "40001") return "El stock cambió. Actualiza e inténtalo nuevamente.";
  if (code === "23503") return "El producto o la ubicación ya no existe. Actualiza la página.";
  if (code === "22023") return "Revisa la cantidad ingresada.";
  return "No fue posible completar el movimiento. Inténtalo nuevamente.";
}

function invalidateStockView(path: string, type?: "page") {
  try {
    revalidatePath(path, type);
  } catch {
    // La escritura ya fue confirmada; un fallo de caché no debe inducir un reintento.
    console.error("No se pudo invalidar una vista después de confirmar el movimiento.");
  }
}

export async function submitStockOperation(input: StockOperationInput): Promise<StockActionResult> {
  const supabase = await requireAuthorizedUser();
  if (!input || typeof input !== "object")
    return { ok: false, message: "Revisa los datos del movimiento." };
  const validationError = validateStockOperation(input);
  if (validationError) return { ok: false, message: validationError };

  let noChange = false;
  try {
    if (input.tipo === "ajuste") {
      const { data, error } = await supabase.rpc("registrar_ajuste_fisico", {
        p_producto_id: input.productoId,
        p_compartimiento_id: input.origenId!,
        p_cantidad_fisica: input.cantidadFisica!,
        p_cantidad_esperada: input.cantidadEsperada!,
      });
      if (error) {
        console.error("No se pudo registrar el ajuste", { code: error.code });
        return { ok: false, message: friendlyStockError(error.code) };
      }
      noChange = data === null;
    } else {
      const { error } = await supabase.from("movimientos").insert({
        producto_id: input.productoId,
        tipo: input.tipo,
        cantidad: input.cantidad!,
        origen_compartimiento_id: input.tipo === "retiro" || input.tipo === "traslado"
          ? input.origenId : null,
        destino_compartimiento_id: input.tipo === "entrada" || input.tipo === "traslado"
          ? input.destinoId : null,
      });
      if (error) {
        console.error("No se pudo registrar el movimiento", { code: error.code });
        return { ok: false, message: friendlyStockError(error.code) };
      }
    }

  } catch {
    console.error("Fallo inesperado al registrar movimiento");
    return { ok: false, message: "No fue posible completar el movimiento. Inténtalo nuevamente." };
  }

  invalidateStockView("/");
  invalidateStockView("/torres");
  invalidateStockView("/productos");
  invalidateStockView("/historial");
  invalidateStockView("/carga");
  invalidateStockView(`/productos/${input.productoId}`);
  try {
    const ids = [...new Set([input.origenId, input.destinoId].filter((id): id is number => !!id))];
    if (ids.length) {
      const { data, error } = await supabase.from("compartimientos").select("tipo,torre_id,estante_id,codigo").in("id", ids);
      if (error) throw error;
      const towerLocations = (data ?? []).filter((row) => row.tipo === "compartimiento" && row.torre_id !== null);
      for (const compartment of towerLocations) invalidateStockView(`/carga/${compartment.codigo}`);
      for (const towerId of new Set(towerLocations.map((row) => row.torre_id))) {
        invalidateStockView(`/torres/C${towerId}`);
      }
      const shelfIds = new Set((data ?? []).filter((row) => row.tipo === "caja" && row.estante_id !== null).map((row) => row.estante_id));
      if (shelfIds.size) invalidateStockView("/estantes");
      for (const shelfId of shelfIds) invalidateStockView(`/estantes/${shelfId}`);
    }
  } catch {
    // No registrar errores crudos, IDs, códigos, credenciales ni datos del producto.
    console.error("No se pudieron consultar las ubicaciones después de confirmar el movimiento. Se aplica invalidación conservadora.");
    invalidateStockView("/estantes");
    invalidateStockView("/torres/[codigo]", "page");
    invalidateStockView("/estantes/[id]", "page");
    invalidateStockView("/carga/[codigo]", "page");
  }
  return {
    ok: true,
    noChange,
    message: noChange ? "El stock ya coincide con el conteo físico. No se registró un movimiento." : "Movimiento registrado correctamente.",
  };
}
