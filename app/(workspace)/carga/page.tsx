import { PageHeading } from "@/components/dashboard";
import { RapidStart } from "@/components/rapid-start";
import { getCompartments } from "@/lib/stock-data";

export default async function RapidStartPage() {
  const compartments = await getCompartments();
  return <div className="page-stack"><PageHeading eyebrow="LEVANTAMIENTO FÍSICO" title="Carga rápida" description="Recorre las ubicaciones y registra productos con pocos pasos." /><RapidStart compartments={compartments} /></div>;
}
