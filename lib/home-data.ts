import { unstable_rethrow } from "next/navigation";
import { getDashboardSummary } from "@/lib/inventory";
import { getShelfSummaries } from "@/lib/shelf-data";
import { settleSection, summarizeShelves, summarizeTowers, type SectionResult, type ShelvesView, type TowersView } from "@/lib/home-summary-model";

function read<T>(label: string, run: () => Promise<T>): Promise<SectionResult<T>> {
  const result = settleSection(run, {
    rethrow: unstable_rethrow,
    report: code => console.error(`Inicio: no se pudo consultar ${label}`, { code }),
  });
  // Awaited by several Suspense children; this side branch only avoids an unhandled-rejection
  // warning if the page unmounts first. Each consumer still receives the original rejection.
  result.catch(() => {});
  return result;
}

// Each helper runs once per page load; the two reads start together and settle independently.
export const readTowers = (): Promise<SectionResult<TowersView>> =>
  read("Torres", async () => summarizeTowers(await getDashboardSummary()));
export const readShelves = (): Promise<SectionResult<ShelvesView>> =>
  read("Estantes", async () => summarizeShelves(await getShelfSummaries()));
