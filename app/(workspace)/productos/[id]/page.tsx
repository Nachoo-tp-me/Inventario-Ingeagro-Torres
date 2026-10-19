import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { getProduct } from "@/lib/product-catalog";
import { getPhysicalLocations } from "@/lib/stock-data";
import { locationsLabel, unitsLabel } from "@/lib/product-presentation";
import { ProductStockControls } from "@/components/product-stock-controls";
import { ProductPhoto } from "@/components/product-photo";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ guardado?: string }>;
}) {
  const { id } = await params;
  const [detail, compartments] = await Promise.all([getProduct(id), getPhysicalLocations()]);
  if (!detail) notFound();
  const { product, locations } = detail;
  const { guardado } = await searchParams;
  return (
    <div className="page-stack product-page">
      <Link href="/productos" className="back-link"><ArrowLeft size={17} aria-hidden="true" /> Volver a productos</Link>
      {guardado === "1" && <p className="catalog-message success" role="status">Producto guardado correctamente.</p>}
      <div className="catalog-heading-row">
        <div className="page-heading">
          <p className="eyebrow">CATÁLOGO / PRODUCTO</p>
          <h1>{product.nombre}</h1>
          <p className="page-description">{product.categoria}</p>
        </div>
        <Link href={`/productos/${product.id}/editar`} className="catalog-button"><Pencil size={17} aria-hidden="true" /> Editar</Link>
      </div>
      <div className="catalog-stock-summary">
        <div><span>Stock total</span><strong>{unitsLabel(product.stock)}</strong></div>
        <div><span>Ubicaciones</span><strong>{locationsLabel(product.ubicaciones)}</strong></div>
      </div>
      <ProductStockControls
        product={{ id: product.id, nombre: product.nombre, categoria: product.categoria }}
        locations={locations}
        physicalLocations={compartments}
      />
      <details className="catalog-secondary">
        <summary>Descripción y fotografía</summary>
        <div className="catalog-secondary-body">
          <ProductPhoto url={product.fotoUrl} name={product.nombre} />
          <h2>Descripción</h2>
          <p className="catalog-description">{product.descripcion || "Sin descripción."}</p>
        </div>
      </details>
    </div>
  );
}
