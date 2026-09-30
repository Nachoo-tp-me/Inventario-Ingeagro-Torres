import Link from "next/link";
import { Layers3, ArrowLeft } from "lucide-react";

export default function TowerNotFound() {
  return (
    <div className="tower-not-found">
      <span className="coming-mark">
        <Layers3 size={27} aria-hidden="true" />
      </span>
      <h1>Torre no encontrada</h1>
      <p>Revisa el código o vuelve a la lista de torres disponibles.</p>
      <Link href="/torres" className="back-link">
        <ArrowLeft size={18} aria-hidden="true" /> Ver torres
      </Link>
    </div>
  );
}
