import { PageHeading } from "@/components/dashboard";
import { ExportPanel } from "@/components/export-panel";

export default function ExportsPage() {
  return <div className="page-stack">
    <PageHeading eyebrow="ARCHIVOS" title="Exportar inventario" description="Descarga una copia actual del inventario o un mapa visual de las torres." />
    <ExportPanel />
  </div>;
}
