import { notFound } from "next/navigation";
import { TowerView } from "@/components/tower-view";
import { getTowerDetail } from "@/lib/tower-data";
import { getCompartments, getProductOptions } from "@/lib/stock-data";

export default async function TowerDetailPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const [tower, compartments, products] = await Promise.all([
    getTowerDetail(codigo), getCompartments(), getProductOptions(),
  ]);
  if (!tower) notFound();
  return <TowerView tower={tower} compartments={compartments} products={products} />;
}
