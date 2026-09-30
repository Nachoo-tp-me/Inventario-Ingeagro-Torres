import type { TowerCompartment, TowerDetail } from "@/lib/tower-model";
import { COMPARTMENT_SLOTS } from "@/lib/tower-orientation";

type Floor = TowerDetail["pisos"][number];

function TopSector({
  compartment,
  selected,
  onSelect,
}: {
  compartment: TowerCompartment;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  const slot = COMPARTMENT_SLOTS[compartment.posicion];
  return (
    <button
      type="button"
      className={`top-view-sector ${compartment.ocupado ? "occupied" : "available"}${selected ? " selected" : ""}`}
      style={{ gridRow: slot.row, gridColumn: slot.column }}
      onClick={() => onSelect(compartment.id)}
      aria-label={`${compartment.codigo}, ${compartment.ocupado ? "ocupado" : "disponible"}`}
      aria-pressed={selected}
    >
      <strong>{compartment.codigo}</strong>
      <span>{compartment.ocupado ? "Ocupado" : "Disponible"}</span>
    </button>
  );
}

export function TowerTopView({
  floors,
  activeFloor,
  selectedId,
  onSelectFloor,
  onSelect,
}: {
  floors: Floor[];
  activeFloor: Floor;
  selectedId: number | null;
  onSelectFloor: (number: number) => void;
  onSelect: (id: number) => void;
}) {
  return (
    <section className="tower-top-panel" aria-label="Vista superior de la torre">
      <p className="eyebrow">VISTA SUPERIOR</p>
      <h2>Piso {activeFloor.numero}</h2>
      <p className="top-view-intro">Cuatro compartimientos vistos desde arriba.</p>
      <label className="top-view-selector">
        <span>Cambiar piso</span>
        <select
          value={activeFloor.numero}
          onChange={(event) => onSelectFloor(Number(event.target.value))}
          aria-label="Seleccionar piso de la vista superior"
        >
          {floors.map((floor) => (
            <option key={floor.numero} value={floor.numero}>
              Piso {floor.numero}
            </option>
          ))}
        </select>
      </label>
      <div
        className="top-view-rim"
        role="group"
        aria-label={`Compartimientos del piso ${activeFloor.numero}`}
      >
        <div className="top-view-grid">
          {activeFloor.compartimientos.map((compartment) => (
            <TopSector
              key={compartment.id}
              compartment={compartment}
              selected={selectedId === compartment.id}
              onSelect={onSelect}
            />
          ))}
        </div>
        <span className="top-view-hub" aria-hidden="true" />
      </div>
      <p className="top-view-caption">Orden horario · 1 → 2 → 3 → 4</p>
      <p className="top-view-instruction">
        Toca un sector para ver sus productos y cantidades. También puedes elegir
        el piso en la vista de la torre.
      </p>
    </section>
  );
}
