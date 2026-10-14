import { ShelfOverview } from "@/components/shelf-overview";
import { getShelfSummaries } from "@/lib/shelf-data";

export default async function ShelvesPage() {
  return <ShelfOverview shelves={await getShelfSummaries()} />;
}
