"use server";

import { getRapidLocationByCode } from "@/lib/rapid-data";
import { rapidLocationHref } from "@/lib/rapid-navigation-model";

export async function resolveRapidCode(code: string): Promise<{ ok: boolean; href?: string; message?: string }> {
  // La autorización ocurre en el DAL, antes de consultar incluso entradas inválidas.
  const location = await getRapidLocationByCode(code);
  return location ? { ok: true, href: rapidLocationHref(location) }
    : { ok: false, message: "No encontramos esa ubicación." };
}
