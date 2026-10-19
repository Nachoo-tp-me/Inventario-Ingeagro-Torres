import Link from "next/link";
import { AlertCircle, ArrowUpRight, Boxes, Layers3 } from "lucide-react";
import type { SectionResult, ShelvesView, TowersView } from "@/lib/home-summary-model";

// Server components: each awaits ONE of the two independent reads (towers / shelves) inside its own
// Suspense boundary. A failed read is rendered as an error, never as zero.

type Kind = "torres" | "estantes";
const CARDS = {
  torres: { title: "Torres", icon: Layers3, unit: ["compartimiento", "compartimientos"], taken: ["ocupado", "ocupados"], free: ["disponible", "disponibles"], empty: "No hay torres registradas" },
  estantes: { title: "Estantes", icon: Boxes, unit: ["caja", "cajas"], taken: ["ocupada", "ocupadas"], free: ["disponible", "disponibles"], empty: "No hay estantes registrados" },
} as const;

const plural = (count: number, [one, many]: readonly [string, string]) => (count === 1 ? one : many);
const number = (value: number) => value.toLocaleString("es-CL");

function CardShell({ kind, state, children }: { kind: Kind; state: string; children: React.ReactNode }) {
  const { title, icon: Icon } = CARDS[kind];
  return <article className={`home-card ${state}`} aria-labelledby={`home-${kind}-title`} data-section={kind} data-state={state}>
    <header><Icon size={20} aria-hidden="true" /><h3 id={`home-${kind}-title`}>{title}</h3></header>
    {children}
  </article>;
}

function Figures({ kind, total, occupied, free }: { kind: Kind; total: number; occupied: number; free: number }) {
  const card = CARDS[kind];
  return <>
    <p className="home-card-total"><strong>{number(total)}</strong> {plural(total, card.unit)}</p>
    <ul className="home-card-split">
      <li><span className="occupancy-dot" aria-hidden="true" /><strong>{number(occupied)}</strong> {plural(occupied, card.taken)}</li>
      <li><span className="availability-dot" aria-hidden="true" /><strong>{number(free)}</strong> {plural(free, card.free)}</li>
    </ul>
  </>;
}

export function SummaryFallback({ kind }: { kind: Kind }) {
  return <CardShell kind={kind} state="loading">
    <p className="home-card-note" role="status" aria-busy="true">Consultando…</p>
  </CardShell>;
}

function SectionError({ kind }: { kind: Kind }) {
  return <CardShell kind={kind} state="error">
    <div className="home-card-error" role="alert">
      <AlertCircle size={20} aria-hidden="true" />
      <p><strong>No se pudo consultar</strong><span>Datos no disponibles por ahora. Recarga la página para reintentar.</span></p>
    </div>
  </CardShell>;
}

export async function TowersCard({ result }: { result: Promise<SectionResult<TowersView>> }) {
  const section = await result;
  if (section.status === "error") return <SectionError kind="torres" />;
  const { compartimientos, ocupados, disponibles } = section.data;
  if (compartimientos === 0) return <CardShell kind="torres" state="empty"><p className="home-card-note">{CARDS.torres.empty}</p><p className="home-card-help">Cuando se registren compartimientos aparecerán aquí.</p></CardShell>;
  return <CardShell kind="torres" state="ready"><Figures kind="torres" total={compartimientos} occupied={ocupados} free={disponibles} /></CardShell>;
}

export async function ShelvesCard({ result }: { result: Promise<SectionResult<ShelvesView>> }) {
  const section = await result;
  if (section.status === "error") return <SectionError kind="estantes" />;
  const { cajas, ocupadas, disponibles } = section.data;
  if (cajas === 0) return <CardShell kind="estantes" state="empty"><p className="home-card-note">{CARDS.estantes.empty}</p><p className="home-card-help">Cuando se registren cajas aparecerán aquí.</p></CardShell>;
  return <CardShell kind="estantes" state="ready"><Figures kind="estantes" total={cajas} occupied={ocupadas} free={disponibles} /></CardShell>;
}

// «Productos» is the global catalog count of the towers read; it is not derived from physical locations.
export function ProductsCountFallback() {
  return <p className="home-products" aria-busy="true">Consultando…</p>;
}

export async function ProductsCount({ result }: { result: Promise<SectionResult<TowersView>> }) {
  const section = await result;
  if (section.status === "error") return <p className="home-products unavailable">Productos: no disponible</p>;
  const { productos } = section.data;
  return <p className="home-products">{number(productos)} {productos === 1 ? "producto" : "productos"} en el catálogo</p>;
}

function ExploreLink({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: typeof Layers3 }) {
  return <Link href={href} className="home-explore-link">
    <Icon size={22} aria-hidden="true" />
    <span><strong>{title}</strong><small>{detail}</small></span>
    <ArrowUpRight size={18} aria-hidden="true" />
  </Link>;
}

export function ExploreFallback({ href, title, detail, icon }: { href: string; title: string; detail: string; icon: typeof Layers3 }) {
  return <ExploreLink href={href} title={title} detail={detail} icon={icon} />;
}

export async function ExploreTowers({ result }: { result: Promise<SectionResult<TowersView>> }) {
  const section = await result;
  const count = section.status === "ready" ? section.data.torres : null;
  return <ExploreLink href="/torres" title="Torres" icon={Layers3}
    detail={count && count > 0 ? `${count} ${count === 1 ? "torre" : "torres"}` : "Ver compartimientos"} />;
}

export async function ExploreShelves({ result }: { result: Promise<SectionResult<ShelvesView>> }) {
  const section = await result;
  const data = section.status === "ready" ? section.data : null;
  const groups = data?.grupos.length ? ` · ${data.grupos.length === 1 ? "grupo" : "grupos"} ${data.grupos.join(" y ")}` : "";
  return <ExploreLink href="/estantes" title="Estantes" icon={Boxes}
    detail={data && data.estantes > 0 ? `${data.estantes} ${data.estantes === 1 ? "estante" : "estantes"}${groups}` : "Ver cajas"} />;
}
