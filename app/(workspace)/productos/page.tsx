import Link from "next/link";
import { MapPin, Package, Plus } from "lucide-react";
import { PageHeading } from "@/components/dashboard";
import { getProducts } from "@/lib/product-catalog";

export default async function ProductsPage() {
  const products = await getProducts();
  return (
    <div className="page-stack">
      <div className="catalog-heading-row">
        <PageHeading eyebrow="CATÁLOGO" title="Productos" description="Productos registrados y sus existencias actuales." />
        <Link href="/productos/nuevo" className="catalog-button primary"><Plus size={19} aria-hidden="true" /> Agregar producto</Link>
      </div>
      {products.length === 0 ? (
        <div className="catalog-empty">
          <span className="catalog-empty-icon"><Package size={34} aria-hidden="true" /></span>
          <h2>Aún no hay productos registrados</h2>
          <p>Agrega el primero para empezar a organizar el catálogo de Ingeagro.</p>
          <Link href="/productos/nuevo" className="catalog-button primary"><Plus size={19} aria-hidden="true" /> Agregar producto</Link>
        </div>
      ) : (
        <>
          <p className="catalog-count">{products.length.toLocaleString("es-CL")} {products.length === 1 ? "producto registrado" : "productos registrados"}</p>
          <div className="catalog-grid">
            {products.map((product) => (
              <Link href={`/productos/${product.id}`} className="catalog-card" key={product.id}>
                <div className="catalog-card-photo">
                  {product.fotoUrl ? (
                    // URL firmada del bucket privado.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.fotoUrl} alt="" loading="lazy" />
                  ) : <Package size={38} aria-hidden="true" />}
                </div>
                <div className="catalog-card-content">
                  <span className="catalog-category">{product.categoria}</span>
                  <h2>{product.nombre}</h2>
                  <p>{product.descripcion || "Sin descripción"}</p>
                  <div className="catalog-card-foot">
                    <strong>{product.stock.toLocaleString("es-CL")} <small>unid.</small></strong>
                    <span><MapPin size={15} aria-hidden="true" /> {product.ubicaciones} {product.ubicaciones === 1 ? "ubicación" : "ubicaciones"}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
