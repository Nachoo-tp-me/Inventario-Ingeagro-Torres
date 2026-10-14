import { notFound } from "next/navigation";
import { RapidLocation } from "@/components/rapid-location";
import { getCategories } from "@/lib/product-catalog";
import { getPhysicalLocations, getProductOptions } from "@/lib/stock-data";
import { getRapidLocation } from "@/lib/rapid-data";
import { adjacentRapidBoxes } from "@/lib/rapid-navigation-model";
import { parsePhysicalId } from "@/lib/shelf-model";

export default async function RapidBoxPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parsePhysicalId((await params).id);
  if (id === null) notFound();
  const locations = await getPhysicalLocations();
  const adjacent = adjacentRapidBoxes(locations, id);
  if (!adjacent.current || adjacent.current.tipo !== "caja") notFound();
  const [current, products, categories] = await Promise.all([getRapidLocation(adjacent.current), getProductOptions(), getCategories()]);
  return <RapidLocation key={current.id} current={current} adjacent={adjacent} products={products} categories={categories} compartments={locations} />;
}
