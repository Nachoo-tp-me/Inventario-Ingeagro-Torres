import { notFound } from "next/navigation";
import { RapidLocation } from "@/components/rapid-location";
import { getCategories } from "@/lib/product-catalog";
import { getCompartments, getProductOptions } from "@/lib/stock-data";
import { getRapidCompartment } from "@/lib/rapid-data";
import { adjacentCompartments } from "@/lib/rapid-model";

export default async function RapidLocationPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const [compartments, products, categories] = await Promise.all([getCompartments(), getProductOptions(), getCategories()]);
  const adjacent = adjacentCompartments(compartments, codigo);
  if (!adjacent.current) notFound();
  const current = await getRapidCompartment(adjacent.current);
  return <RapidLocation key={current.codigo} current={current} adjacent={adjacent} products={products} categories={categories} compartments={compartments} />;
}
