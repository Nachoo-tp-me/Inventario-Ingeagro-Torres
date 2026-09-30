import { Clock3 } from "lucide-react";
import { PageHeading } from "@/components/dashboard";

export default function HistoryPage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="ACTIVIDAD"
        title="Historial"
        description="El registro de movimientos estará disponible en un próximo bloque."
      />
      <div className="coming-panel">
        <span className="coming-mark">
          <Clock3 size={27} aria-hidden="true" />
        </span>
        <h2>Historial próximamente</h2>
        <p>Aquí se mostrarán las entradas, retiros, traslados y ajustes.</p>
      </div>
    </div>
  );
}
