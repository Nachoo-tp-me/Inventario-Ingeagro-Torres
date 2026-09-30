import { PageHeading, TowerGrid } from "@/components/dashboard";
import { getDashboardSummary } from "@/lib/inventory";

export default async function TowersPage() {
  const data = await getDashboardSummary();
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="UBICACIONES"
        title="Torres"
        description="Consulta la capacidad y disponibilidad de cada torre."
      />
      <TowerGrid towers={data.torres} />
    </div>
  );
}
