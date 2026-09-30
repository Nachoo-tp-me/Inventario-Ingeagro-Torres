"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Layers3 } from "lucide-react";
import { CompartmentDetail } from "@/components/compartment-detail";
import { TowerFloor } from "@/components/tower-floor";
import { TowerTopView } from "@/components/tower-top-view";
import type { TowerDetail, TowerCompartment } from "@/lib/tower-model";

export function TowerView({ tower }: { tower: TowerDetail }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [floorNumber, setFloorNumber] = useState(tower.pisos[0]?.numero ?? null);
  const activeFloor =
    tower.pisos.find((floor) => floor.numero === floorNumber) ?? tower.pisos[0];
  const selected: TowerCompartment | null =
    tower.pisos
      .flatMap((floor) => floor.compartimientos)
      .find((compartment) => compartment.id === selectedId) ?? null;

  return (
    <div className="tower-detail-page">
      <Link className="back-link" href="/torres">
        <ArrowLeft size={18} aria-hidden="true" /> Todas las torres
      </Link>

      <header className="tower-detail-header">
        <div>
          <p className="eyebrow">EXPLORACIÓN DE UBICACIONES</p>
          <h1>Torre {tower.codigo}</h1>
          <p>Selecciona un compartimiento para ver su contenido.</p>
        </div>
        <span className="tower-header-emblem">
          <Layers3 size={30} strokeWidth={1.6} aria-hidden="true" />
        </span>
      </header>

      <div className="tower-summary" aria-label="Estado de la torre">
        <div className="tower-summary-item">
          <span>Total de compartimientos</span>
          <strong>{tower.total}</strong>
        </div>
        <div className="tower-summary-item occupied">
          <span>
            <i aria-hidden="true" /> Ocupados
          </span>
          <strong>{tower.ocupados}</strong>
        </div>
        <div className="tower-summary-item available">
          <span>
            <i aria-hidden="true" /> Disponibles
          </span>
          <strong>{tower.disponibles}</strong>
        </div>
      </div>

      <div className="tower-workspace">
        <section
          className="tower-model-panel"
          aria-label={`Modelo de la torre ${tower.codigo}`}
        >
          <div className="model-heading">
            <div>
              <p className="eyebrow">MODELO FÍSICO</p>
              <h2>Vista de la torre</h2>
            </div>
            <div className="model-legend" aria-label="Estados">
              <span>
                <i className="available" /> Disponible
              </span>
              <span>
                <i className="occupied" /> Ocupado
              </span>
            </div>
          </div>

          {tower.pisos.length > 0 ? (
            <div className="tower-model">
              <div className="tower-cap" aria-hidden="true" />
              <div className="tower-bands">
                {tower.pisos.map((floor) => (
                  <TowerFloor
                    key={floor.numero}
                    number={floor.numero}
                    compartments={floor.compartimientos}
                    selectedId={selectedId}
                    active={activeFloor.numero === floor.numero}
                    onSelectFloor={setFloorNumber}
                    onSelect={(id) => {
                      setFloorNumber(floor.numero);
                      setSelectedId(id);
                    }}
                  />
                ))}
              </div>
              <div className="tower-base" aria-hidden="true" />
            </div>
          ) : (
            <div className="empty-state">
              <Layers3 size={30} aria-hidden="true" />
              <h3>Sin compartimientos</h3>
              <p>Esta torre aún no tiene ubicaciones para mostrar.</p>
            </div>
          )}
        </section>

        {activeFloor && (
          <TowerTopView
            floors={tower.pisos}
            activeFloor={activeFloor}
            selectedId={selectedId}
            onSelectFloor={setFloorNumber}
            onSelect={setSelectedId}
          />
        )}
      </div>

      <CompartmentDetail
        compartment={selected}
        towerCode={tower.codigo}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
