import { Suspense } from "react";
import Link from "next/link";
import { Boxes, Layers3, Plus, Zap } from "lucide-react";
import { PageHeading } from "@/components/dashboard";
import { GlobalSearch } from "@/components/global-search";
import {
  ExploreFallback,
  ExploreShelves,
  ExploreTowers,
  ProductsCount,
  ProductsCountFallback,
  ShelvesCard,
  SummaryFallback,
  TowersCard,
} from "@/components/home-summary";
import { readShelves, readTowers } from "@/lib/home-data";

export default function HomePage() {
  // Both reads start here, once per load, and settle independently. Each Suspense boundary
  // awaits only its own promise, so a slow or failed section never blocks the other.
  const towers = readTowers();
  const shelves = readShelves();
  return (
    <div className="page-stack home-page">
      <PageHeading eyebrow="INICIO" title="Inventario" description="Busca, localiza y registra existencias." />
      <GlobalSearch />
      <section className="home-overview" aria-labelledby="home-overview-title">
        <div className="home-overview-heading">
          <h2 id="home-overview-title">Estado de ubicaciones</h2>
          <Suspense fallback={<ProductsCountFallback />}>
            <ProductsCount result={towers} />
          </Suspense>
        </div>
        <div className="home-cards">
          <Suspense fallback={<SummaryFallback kind="torres" />}>
            <TowersCard result={towers} />
          </Suspense>
          <Suspense fallback={<SummaryFallback kind="estantes" />}>
            <ShelvesCard result={shelves} />
          </Suspense>
        </div>
        <p className="home-legend">Ocupado: con stock positivo. Disponible: sin stock positivo.</p>
      </section>
      <div className="home-actions">
        <Link href="/carga" className="catalog-button primary"><Zap size={19} aria-hidden="true" /> Carga rápida</Link>
        <Link href="/productos/nuevo" className="catalog-button"><Plus size={19} aria-hidden="true" /> Crear producto</Link>
      </div>
      <section className="home-explore" aria-labelledby="home-explore-title">
        <h2 id="home-explore-title">Explorar ubicaciones</h2>
        <div className="home-explore-grid">
          <Suspense fallback={<ExploreFallback href="/torres" title="Torres" detail="Ver compartimientos" icon={Layers3} />}>
            <ExploreTowers result={towers} />
          </Suspense>
          <Suspense fallback={<ExploreFallback href="/estantes" title="Estantes" detail="Ver cajas" icon={Boxes} />}>
            <ExploreShelves result={shelves} />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
