import { notFound } from "next/navigation";
import { getShelfDetail } from "@/lib/shelf-data";
import { parsePhysicalId } from "@/lib/shelf-model";
import { getPhysicalLocations, getProductOptions } from "@/lib/stock-data";
import { ShelfView } from "@/components/shelf-view";

export default async function ShelfPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ caja?: string | string[] }>;
}) {
  const id = parsePhysicalId((await params).id);
  if (id === null) notFound();
  const shelf = await getShelfDetail(id);
  if (!shelf) notFound();
  const rawBox = (await searchParams).caja;
  const boxId = rawBox === undefined ? null : parsePhysicalId(rawBox);
  if (rawBox !== undefined && (boxId === null || !shelf.cajas.some(box => box.id === boxId))) notFound();
  const [locations, products] = await Promise.all([getPhysicalLocations(), getProductOptions()]);
  return <ShelfView shelf={shelf} locations={locations} products={products} selectedId={boxId} />;
}
