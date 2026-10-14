import { notFound, redirect } from "next/navigation";
import { RapidLocation } from "@/components/rapid-location";
import { getCategories } from "@/lib/product-catalog";
import { getCompartments, getProductOptions } from "@/lib/stock-data";
import { getRapidCompartment, getRapidLocationByCode } from "@/lib/rapid-data";
import { adjacentCompartments } from "@/lib/rapid-model";
import { rapidLocationHref } from "@/lib/rapid-navigation-model";

export default async function RapidLocationPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const compartments = await getCompartments();
  const adjacent = adjacentCompartments(compartments, codigo);
  if (!adjacent.current) {
    const location = await getRapidLocationByCode(codigo);
    if (location?.tipo === "caja") redirect(rapidLocationHref(location));
    notFound();
  }
  const [current, products, categories] = await Promise.all([getRapidCompartment(adjacent.current), getProductOptions(), getCategories()]);
  return <RapidLocation key={current.codigo} current={current} adjacent={adjacent} products={products} categories={categories} compartments={compartments} />;
}
