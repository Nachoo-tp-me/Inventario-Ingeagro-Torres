"use server";

import { revalidatePath } from "next/cache";
import { requireAuthorizedUser } from "@/lib/auth";
import {
  validateStockOperation,
  type StockOperationInput,
} from "@/lib/stock-model";
import { classifyWriteError } from "@/lib/product-save-model";
import {
  ALREADY_REGISTERED_MESSAGE,
  INVALID_REQUEST_MESSAGE,
  REUSED_REQUEST_MESSAGE,
  SCHEMA_MISMATCH_MESSAGE,
  UNCERTAIN_RETRY_MESSAGE,
  formatMovementDate,
  normalizeSolicitudId,
} from "@/lib/movement-request";

export type StockActionResult = {
  ok: boolean;
  message: string;
  noChange?: boolean;
  /** The movement may or may not have been recorded: the caller keeps the request id and may retry it. */
  uncertain?: boolean;
  /** The same request had already been recorded (deduplicated); nothing was applied twice. */
  duplicate?: boolean;
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

type Supabase = Awaited<ReturnType<typeof requireAuthorizedUser>>;
const UNCERTAIN: StockActionResult = { ok: false, uncertain: true, message: UNCERTAIN_RETRY_MESSAGE };

// Compares the stored movement of a repeated request with what this request asks for, field by field.
async function resolveDuplicate(supabase: Supabase, solicitudId: string, input: StockOperationInput): Promise<StockActionResult | { same: true; when: string | null }> {
  const { data, error } = await supabase.from("movimientos")
    .select("producto_id,tipo,cantidad,origen_compartimiento_id,destino_compartimiento_id,fecha")
    .eq("solicitud_id", solicitudId).maybeSingle();
  if (error || !data) {
    console.error("No se pudo comprobar un movimiento repetido", { code: error?.code ?? "sin-fila" });
    return UNCERTAIN; // never success without proof
  }
  const origen = input.tipo === "retiro" || input.tipo === "traslado" ? input.origenId ?? null : null;
  const destino = input.tipo === "entrada" || input.tipo === "traslado" ? input.destinoId ?? null : null;
  const same = data.producto_id === input.productoId && data.tipo === input.tipo && data.cantidad === input.cantidad &&
    (data.origen_compartimiento_id ?? null) === origen && (data.destino_compartimiento_id ?? null) === destino;
  if (!same) return { ok: false, message: REUSED_REQUEST_MESSAGE };
  const when = typeof data.fecha === "string" ? formatMovementDate(data.fecha) : null;
  return { same: true, when };
}

export async function submitStockOperation(input: StockOperationInput): Promise<StockActionResult> {
  const supabase = await requireAuthorizedUser();
  if (!input || typeof input !== "object")
    return { ok: false, message: "Revisa los datos del movimiento." };
  const validationError = validateStockOperation(input);
  if (validationError) return { ok: false, message: validationError };
  // V2 entrada/retiro/traslado always carry a request id: the database refuses a second movement with the same id.
  const solicitudId = input.tipo === "ajuste" ? null : normalizeSolicitudId(input.solicitudId);
  if (input.tipo !== "ajuste" && !solicitudId) return { ok: false, message: INVALID_REQUEST_MESSAGE };

  let noChange = false;
  let duplicate = false;
  let registeredWhen: string | null = null;
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
        solicitud_id: solicitudId,
        producto_id: input.productoId,
        tipo: input.tipo,
        cantidad: input.cantidad!,
        origen_compartimiento_id: input.tipo === "retiro" || input.tipo === "traslado"
          ? input.origenId : null,
        destino_compartimiento_id: input.tipo === "entrada" || input.tipo === "traslado"
          ? input.destinoId : null,
      });
      if (error) {
        const code = typeof error.code === "string" ? error.code : "";
        console.error("No se pudo registrar el movimiento", { code: code || "sin-codigo" });
        if (code === "23505") {
          // Only the request-id constraint may mean "already recorded", and only after reading the stored movement back.
          const text = `${error.message ?? ""} ${error.details ?? ""}`;
          if (text.trim() && !/solicitud_id/.test(text)) return { ok: false, message: friendlyStockError(code) };
          const resolved = await resolveDuplicate(supabase, solicitudId!, input);
          if (!("same" in resolved)) return resolved;
          duplicate = true;
          registeredWhen = resolved.when;
        } else if (code === "PGRST204" || (code === "42703" && /solicitud_id/.test(`${error.message ?? ""}`))) {
          // The database has not been migrated yet: a schema incompatibility, never a reason to retry or to drop idempotency.
          return { ok: false, message: SCHEMA_MISMATCH_MESSAGE };
        } else if (classifyWriteError(error) === "definitive") {
          return { ok: false, message: friendlyStockError(code) };
        } else {
          return UNCERTAIN; // no code / transport / unknown: it may have been recorded
        }
      }
    }
  } catch {
    console.error("Fallo inesperado al registrar movimiento");
    return input.tipo === "ajuste"
      ? { ok: false, message: "No fue posible completar el movimiento. Inténtalo nuevamente." }
      : UNCERTAIN;
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
      const { data, error } = await supabase.from("compartimientos").select("id,tipo,torre_id,estante_id,codigo").in("id", ids);
      if (error) throw error;
      const towerLocations = (data ?? []).filter((row) => row.tipo === "compartimiento" && row.torre_id !== null);
      for (const compartment of towerLocations) invalidateStockView(`/carga/${compartment.codigo}`);
      for (const towerId of new Set(towerLocations.map((row) => row.torre_id))) {
        invalidateStockView(`/torres/C${towerId}`);
      }
      const shelfIds = new Set((data ?? []).filter((row) => row.tipo === "caja" && row.estante_id !== null).map((row) => row.estante_id));
      for (const box of (data ?? []).filter(row => row.tipo === "caja" && row.estante_id !== null && ids.includes(row.id))) invalidateStockView(`/carga/ubicacion/${box.id}`);
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
    invalidateStockView("/carga/ubicacion/[id]", "page");
  }
  return {
    ok: true,
    noChange,
    ...(duplicate ? { duplicate: true } : {}),
    message: duplicate
      ? (registeredWhen ? `${ALREADY_REGISTERED_MESSAGE} Registrado el ${registeredWhen}.` : ALREADY_REGISTERED_MESSAGE)
      : noChange ? "El stock ya coincide con el conteo físico. No se registró un movimiento." : "Movimiento registrado correctamente.",
  };
}
