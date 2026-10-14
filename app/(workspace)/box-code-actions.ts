"use server";

import { revalidatePath } from "next/cache";
import { requireAuthorizedUser } from "@/lib/auth";
import { isLocationId } from "@/lib/stock-model";
import { normalizeBoxCode, validateBoxCode } from "@/lib/box-code-model";

export type BoxCodeInput = { ubicacionId: number; codigoEsperado: string; codigoNuevo: string };
export type BoxCodeResult = { ok: boolean; message: string; codigo?: string; noChange?: boolean; stale?: boolean; uncertain?: boolean };

function invalidate(path: string, type?: "page") {
  try { revalidatePath(path, type); }
  catch { console.error("No se pudo invalidar una vista después de confirmar el cambio de código."); }
}

export async function renameBoxCode(input: BoxCodeInput): Promise<BoxCodeResult> {
  const supabase = await requireAuthorizedUser();
  if (!input || typeof input !== "object" || !isLocationId(input.ubicacionId))
    return { ok: false, message: "Selecciona una caja válida." };
  if (validateBoxCode(input.codigoEsperado))
    return { ok: false, message: "Actualiza la caja y vuelve a abrir el formulario." };
  const validation = validateBoxCode(input.codigoNuevo);
  if (validation) return { ok: false, message: validation };

  const expectedCode = normalizeBoxCode(input.codigoEsperado);
  const newCode = normalizeBoxCode(input.codigoNuevo);
  let data: unknown;
  try {
    const result = await supabase.rpc("renombrar_codigo_caja", {
      p_ubicacion_id: input.ubicacionId,
      p_codigo_esperado: expectedCode,
      p_codigo_nuevo: newCode,
    });
    if (result.error) {
      console.error("No se pudo confirmar el cambio de código de caja.");
      const code = result.error.code;
      if (code === "23505") return { ok: false, message: "Ese código pertenece a otra ubicación, aunque ya no sea su código actual." };
      if (code === "40001") return { ok: false, stale: true, message: "El código cambió en otra sesión. Cierra y vuelve a abrir este formulario para usar el código actual." };
      if (code === "23503") return { ok: false, message: "La caja ya no está disponible. Actualiza la página." };
      if (code === "22023") return { ok: false, message: "El código o la ubicación no son válidos. Solo se pueden editar cajas." };
      if (code === "42501") return { ok: false, message: "No tienes autorización para cambiar el código." };
      return { ok: false, message: "No se pudo confirmar el cambio. Actualiza la caja antes de volver a intentarlo." };
    }
    data = result.data;
  } catch {
    console.error("No se pudo confirmar la respuesta del cambio de código.");
    return { ok: false, message: "No se pudo confirmar el cambio. Actualiza la caja antes de volver a intentarlo." };
  }

  // El RPC respondió sin error; puede haber escrito aunque sus datos no sean verificables.
  // Un fallo de invalidación tampoco debe provocar otra escritura.
  invalidate("/estantes");
  invalidate("/productos");
  invalidate("/productos/[id]", "page");
  const row = Array.isArray(data) && data.length === 1 ? data[0] : undefined;
  const validRow = row !== null && typeof row === "object" && !Array.isArray(row) &&
    row.ubicacion_id === input.ubicacionId && Number.isInteger(row.estante_id) &&
    row.estante_id >= 1 && row.estante_id <= 6 && row.codigo === newCode &&
    row.sin_cambios === (newCode === expectedCode);
  if (!validRow) {
    console.error("Respuesta de renombrado no verificable; se invalidan los detalles de estantes.");
    invalidate("/estantes/[id]", "page");
    return { ok: false, uncertain: true,
      message: "El resultado del cambio es incierto. Actualiza la caja y vuelve a abrir el formulario antes de intentar otra operación." };
  }
  invalidate(`/estantes/${row.estante_id}`);
  return { ok: true, noChange: row.sin_cambios, codigo: row.codigo,
    message: row.sin_cambios ? "El código ya coincide. No se registró un cambio." : "Código de caja guardado correctamente." };
}
