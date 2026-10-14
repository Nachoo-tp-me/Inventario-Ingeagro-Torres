"use client";

import type { TowerCompartment } from "@/lib/tower-model";
import type { PhysicalLocationOption, ProductOption } from "@/lib/stock-model";
import { LocationDetail } from "@/components/location-detail";

export function CompartmentDetail({ compartment, towerCode, compartments, products, onClose }: {
  compartment: TowerCompartment | null;
  towerCode: string;
  compartments: PhysicalLocationOption[];
  products: ProductOption[];
  onClose: () => void;
}) {
  return <LocationDetail key={compartment?.id ?? "closed"} compartment={compartment} kind="compartimiento"
    context={compartment && <><span>Torre {towerCode}</span><span className="sheet-separator">·</span>
      <span>Piso {compartment.piso}</span><span className="sheet-separator">·</span><span>Compartimiento {compartment.posicion}</span></>}
    quickLoadHref={compartment ? `/carga/${compartment.codigo}` : undefined}
    compartments={compartments} products={products} onClose={onClose} />;
}
