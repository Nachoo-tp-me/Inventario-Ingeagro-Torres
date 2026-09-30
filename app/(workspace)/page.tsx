import { Suspense } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  Metrics,
  PageHeading,
  SearchPreview,
  TowerGrid,
} from "@/components/dashboard";
import { getDashboardSummary } from "@/lib/inventory";

async function DashboardData() {
  const data = await getDashboardSummary();
  return (
    <>
      <Metrics data={data} />
      <section className="tower-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">UBICACIONES</p>
            <h2>Torres de almacenamiento</h2>
            <p>Estado actual de los compartimientos físicos.</p>
          </div>
          <Link href="/torres" className="text-link">
            Ver torres <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <TowerGrid towers={data.torres} />
      </section>
    </>
  );
}

export default function HomePage() {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="PANEL GENERAL"
        title="Inventario Ingeagro"
        description="Una vista clara de lo que hay y dónde se encuentra."
      />
      <div className="hero-panel">
        <div className="hero-copy">
          <span className="hero-badge">
            <ShieldCheck size={15} aria-hidden="true" /> CONTROL DE INVENTARIO
          </span>
          <h2>
            Todo el espacio,
            <br />
            de un vistazo.
          </h2>
          <p>
            Consulta el estado de tus torres y compartimientos en tiempo real.
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-ring ring-one" />
          <div className="hero-ring ring-two" />
          <div className="hero-ring ring-three" />
          <div className="hero-core" />
        </div>
      </div>
      <SearchPreview />
      <Suspense
        fallback={
          <div
            className="loading-grid"
            aria-label="Cargando datos de inventario"
          >
            <div />
            <div />
            <div />
            <div />
          </div>
        }
      >
        <DashboardData />
      </Suspense>
    </div>
  );
}
