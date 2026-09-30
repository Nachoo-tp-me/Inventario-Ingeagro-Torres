import { notFound } from "next/navigation";
import { TowerView } from "@/components/tower-view";
import { getTowerDetail } from "@/lib/tower-data";

export default async function TowerDetailPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const tower = await getTowerDetail(codigo);
  if (!tower) notFound();
  return <TowerView tower={tower} />;
}
