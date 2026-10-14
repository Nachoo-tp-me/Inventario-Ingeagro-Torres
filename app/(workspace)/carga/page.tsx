import { PageHeading } from "@/components/dashboard";
import { RapidStart } from "@/components/rapid-start";
import { getPhysicalLocations } from "@/lib/stock-data";

export default async function RapidStartPage() {
  const locations = await getPhysicalLocations();
  return <div className="page-stack"><PageHeading eyebrow="LEVANTAMIENTO FÍSICO" title="Carga rápida" description="Recorre las ubicaciones y registra productos con pocos pasos." /><RapidStart compartments={locations.filter(item => item.tipo === "compartimiento")} boxes={locations.filter(item => item.tipo === "caja")} /></div>;
}
