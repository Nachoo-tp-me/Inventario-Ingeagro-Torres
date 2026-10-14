import { normalizeBoxCode, validateBoxCode } from "@/lib/box-code-model";
import { normalizeLocationCode } from "@/lib/rapid-model";
import type { PhysicalLocationOption } from "@/lib/stock-model";

// Exact codes never use the accent/separator folding of product search.
export function normalizeSearchLocationCode(value: string): string | null {
  const towerCode = normalizeLocationCode(value);
  if (/^C\d+$/.test(towerCode)) return towerCode;
  const boxCode = normalizeBoxCode(value.trim());
  return validateBoxCode(boxCode) ? null : boxCode;
}

export function searchLocationHref(location: PhysicalLocationOption): string {
  return location.tipo === "caja"
    ? `/estantes/${location.estante_id}?caja=${location.id}`
    : `/torres/C${location.torre_id}?compartimiento=${location.codigo}`;
}
