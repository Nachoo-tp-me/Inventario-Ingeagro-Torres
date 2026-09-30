import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ProductForm } from "@/components/product-form";
import { getCategories, getProduct } from "@/lib/product-catalog";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, categories] = await Promise.all([getProduct(id), getCategories()]);
  if (!detail) notFound();
  return (
    <div className="page-stack">
      <Link href={`/productos/${id}`} className="back-link"><ArrowLeft size={17} aria-hidden="true" /> Volver al producto</Link>
      <div className="page-heading"><p className="eyebrow">CATÁLOGO / EDITAR</p><h1>Editar producto</h1><p className="page-description">Actualiza los datos y la fotografía de {detail.product.nombre}.</p></div>
      <ProductForm initial={detail.product} initialCategories={categories} />
    </div>
  );
}
