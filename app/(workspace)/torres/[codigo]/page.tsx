import { notFound } from "next/navigation";
import { TowerView } from "@/components/tower-view";
import { getTowerDetail } from "@/lib/tower-data";
import { getCompartments, getProductOptions } from "@/lib/stock-data";

export default async function TowerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ codigo: string }>;
  searchParams: Promise<{ compartimiento?: string }>;
}) {
  const { codigo } = await params;
  const { compartimiento } = await searchParams;
  const [tower, compartments, products] = await Promise.all([
    getTowerDetail(codigo), getCompartments(), getProductOptions(),
  ]);
  if (!tower) notFound();
  return <TowerView key={`${codigo}-${compartimiento ?? ""}`} tower={tower} compartments={compartments} products={products} initialCode={compartimiento} />;
}
