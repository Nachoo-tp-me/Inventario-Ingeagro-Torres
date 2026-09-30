import type { TowerCompartment } from "@/lib/tower-model";
import { COMPARTMENT_SLOTS } from "@/lib/tower-orientation";

function CompartmentButton({
  compartment,
  selected,
  onSelect,
}: {
  compartment: TowerCompartment;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  const slot = COMPARTMENT_SLOTS[compartment.posicion];
  const count = compartment.productos.length;
  const status = compartment.ocupado
    ? `ocupado, ${count} ${count === 1 ? "producto" : "productos"}`
    : "disponible";

  return (
    <button
      type="button"
      className={`compartment-button ${compartment.ocupado ? "occupied" : "available"}${selected ? " selected" : ""}`}
      style={{ gridRow: slot.row, gridColumn: slot.column }}
      onClick={() => onSelect(compartment.id)}
      aria-label={`${compartment.codigo}, ${status}`}
      aria-pressed={selected}
    >
      <span className="compartment-code">{compartment.codigo}</span>
      <span className="compartment-state">
        <span className="compartment-dot" aria-hidden="true" />
        {compartment.ocupado ? "Ocupado" : "Disponible"}
      </span>
    </button>
  );
}

export function TowerFloor({
  number,
  compartments,
  selectedId,
  onSelect,
}: {
  number: number;
  compartments: TowerCompartment[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <section className="tower-floor" aria-label={`Piso ${number}`}>
      <div className="floor-label">
        <span className="floor-label-small">NIVEL</span>
        <strong>{String(number).padStart(2, "0")}</strong>
        <span>Piso {number}</span>
      </div>
      <div className="floor-grid">
        {compartments.map((compartment) => (
          <CompartmentButton
            key={compartment.id}
            compartment={compartment}
            selected={selectedId === compartment.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
