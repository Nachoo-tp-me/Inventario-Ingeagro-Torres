import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Package, Pencil } from "lucide-react";
import { getProduct } from "@/lib/product-catalog";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ guardado?: string }>;
}) {
  const { id } = await params;
  const detail = await getProduct(id);
  if (!detail) notFound();
  const { product, locations } = detail;
  const { guardado } = await searchParams;
  return (
    <div className="page-stack">
      <Link href="/productos" className="back-link"><ArrowLeft size={17} aria-hidden="true" /> Volver a productos</Link>
      {guardado === "1" && <p className="catalog-message success" role="status">Producto guardado correctamente.</p>}
      <div className="catalog-heading-row">
        <div className="page-heading">
          <p className="eyebrow">CATÁLOGO / PRODUCTO</p>
          <h1>{product.nombre}</h1>
          <p className="page-description">{product.categoria}</p>
        </div>
        <Link href={`/productos/${product.id}/editar`} className="catalog-button primary"><Pencil size={17} aria-hidden="true" /> Editar</Link>
      </div>
      <div className="catalog-detail-grid">
        <div className="catalog-detail-photo">
          {product.fotoUrl ? (
            // URL firmada del bucket privado.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.fotoUrl} alt={`Fotografía de ${product.nombre}`} />
          ) : <div className="catalog-detail-placeholder"><Package size={62} aria-hidden="true" /><span>Sin fotografía</span></div>}
        </div>
        <div className="catalog-detail-copy">
          <span className="catalog-category">{product.categoria}</span>
          <h2>Descripción</h2>
          <p className="catalog-description">{product.descripcion || "Sin descripción."}</p>
          <div className="catalog-stock-summary">
            <div><span>Stock total</span><strong>{product.stock.toLocaleString("es-CL")}</strong><small>unidades</small></div>
            <div><span>Ubicaciones</span><strong>{product.ubicaciones.toLocaleString("es-CL")}</strong><small>con stock</small></div>
          </div>
        </div>
      </div>
      <section className="catalog-locations" aria-labelledby="catalog-locations-title">
        <div className="catalog-section-heading">
          <div><p className="eyebrow">INVENTARIO</p><h2 id="catalog-locations-title">Ubicaciones actuales</h2></div>
          <span>Solo lectura</span>
        </div>
        {locations.length === 0 ? (
          <div className="catalog-no-stock"><MapPin size={24} aria-hidden="true" /><p>Sin stock asignado</p></div>
        ) : (
          <ul className="catalog-location-list">
            {locations.map((location) => (
              <li key={location.codigo}><span><MapPin size={18} aria-hidden="true" /> {location.codigo}</span><strong>{location.cantidad.toLocaleString("es-CL")} unidades</strong></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
