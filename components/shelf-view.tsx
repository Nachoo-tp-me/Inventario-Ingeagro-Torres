"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { PageHeading } from "@/components/dashboard";
import { LocationNavigation } from "@/components/location-navigation";
import { LocationDetail } from "@/components/location-detail";
import { ShelfGrid } from "@/components/shelf-grid";
import { physicalLocationContext, type PhysicalLocationOption, type ProductOption } from "@/lib/stock-model";
import type { ShelfDetail } from "@/lib/shelf-model";

export function ShelfView({ shelf, selectedId, locations, products }: {
  shelf: ShelfDetail;
  selectedId: number | null;
  locations: PhysicalLocationOption[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement>(null);
  const lastSelectedId = useRef(selectedId);
  const box = shelf.cajas.find(item => item.id === selectedId) ?? null;
  useEffect(() => {
    const previousId = lastSelectedId.current;
    lastSelectedId.current = selectedId;
    if (selectedId !== null || previousId === null) return;
    // Esperar a que se cierre el diálogo y termine la navegación, también en enlaces directos.
    const frame = requestAnimationFrame(() => gridRef.current?.querySelector<HTMLAnchorElement>(`[data-location-id="${previousId}"]`)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);
  function closeBox() {
    router.replace(`/estantes/${shelf.id}`, { scroll: false });
  }
  return <div className="page-stack">
    <Link href="/estantes" className="back-link">Volver a estantes</Link>
    <LocationNavigation />
    <PageHeading eyebrow={`ESTANTES / GRUPO ${shelf.grupo}`} title={shelf.nombre} description="Vista frontal · posiciones físicas permanentes" />
    <div ref={gridRef} className="shelf-detail-grid"><ShelfGrid shelf={shelf} /></div>
    <LocationDetail key={box?.id ?? "closed"} compartment={box} kind="caja" context={box && <span>{physicalLocationContext(box)}</span>}
      boxLocation={box ?? undefined} compartments={locations} products={products} onClose={closeBox} />
  </div>;
}
