import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ProductForm } from "@/components/product-form";
import { getCategories } from "@/lib/product-catalog";

export default async function NewProductPage() {
  const categories = await getCategories();
  return (
    <div className="page-stack">
      <Link href="/productos" className="back-link"><ArrowLeft size={17} aria-hidden="true" /> Volver a productos</Link>
      <div className="page-heading">
        <p className="eyebrow">CATÁLOGO / NUEVO</p>
        <h1>Agregar producto</h1>
        <p className="page-description">Completa los datos básicos para incorporarlo al catálogo.</p>
      </div>
      <ProductForm initialCategories={categories} />
    </div>
  );
}
