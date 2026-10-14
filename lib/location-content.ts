import type { ProductOption } from "@/lib/stock-model";

export type LocationProduct = ProductOption & { cantidad: number; fotoUrl: string | null };
export type LocationContent = {
  id: number;
  codigo: string;
  ocupado: boolean;
  productos: LocationProduct[];
};
