import Link from "next/link";
import { PackageSearch } from "lucide-react";

export default function ProductNotFound() {
  return (
    <div className="catalog-empty"><PackageSearch size={36} aria-hidden="true" /><h2>Producto no encontrado</h2><p>Puede que el enlace ya no sea válido.</p><Link href="/productos" className="catalog-button primary">Volver a productos</Link></div>
  );
}
