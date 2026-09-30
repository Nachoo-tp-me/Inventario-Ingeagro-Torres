import { PackageSearch } from "lucide-react";
import { PageHeading } from "@/components/dashboard";

export default function ProductsPage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="CATÁLOGO"
        title="Productos"
        description="El catálogo de productos estará disponible en un próximo bloque."
      />
      <div className="coming-panel">
        <span className="coming-mark">
          <PackageSearch size={27} aria-hidden="true" />
        </span>
        <h2>Catálogo próximamente</h2>
        <p>Aquí podrás consultar y gestionar los productos del inventario.</p>
      </div>
    </div>
  );
}
