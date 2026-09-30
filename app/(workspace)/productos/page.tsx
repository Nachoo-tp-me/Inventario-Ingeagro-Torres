import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeading } from "@/components/dashboard";
import { ProductCatalogList } from "@/components/product-catalog-list";
import { getProducts } from "@/lib/product-catalog";

export default async function ProductsPage() {
  const products = await getProducts();
  return (
    <div className="page-stack">
      <div className="catalog-heading-row">
        <PageHeading eyebrow="CATÁLOGO" title="Productos" description="Productos registrados y sus existencias actuales." />
        <Link href="/productos/nuevo" className="catalog-button primary"><Plus size={19} aria-hidden="true" /> Agregar producto</Link>
      </div>
      <ProductCatalogList products={products} />
    </div>
  );
}
