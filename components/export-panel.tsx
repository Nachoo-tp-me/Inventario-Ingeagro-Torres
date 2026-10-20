"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileSpreadsheet, FileText, Image as ImageIcon } from "lucide-react";
import { getExportSnapshot } from "@/app/(workspace)/export-actions";
import { INVENTORY_HEADERS } from "@/lib/export-model";
import { downloadCsv, downloadTowerPng, downloadXlsx } from "@/lib/export-files";

type Format = "csv" | "xlsx" | "png";
type Result = { kind: "success" | "error"; message: string };

const SNAPSHOT_NOTE = "Los datos son una instantánea del momento de exportar.";
const options: { format: Format; title: string; ext: string; description: string; icon: typeof FileText; details: ReactNode }[] = [
  { format: "csv", title: "CSV", ext: ".csv", icon: FileText,
    description: "Tabla de productos con su cantidad y ubicación. Se abre en Excel, Google Sheets o cualquier hoja de cálculo.",
    details: <>
      <li>Separador: punto y coma (;).</li>
      <li>Codificación UTF-8 con BOM, para que Excel muestre bien tildes y la ñ. Si ves caracteres extraños, importa el archivo indicando UTF-8.</li>
      <li>Columnas: {INVENTORY_HEADERS.join(", ")}.</li>
      <li>{SNAPSHOT_NOTE}</li>
    </> },
  { format: "xlsx", title: "Excel", ext: ".xlsx", icon: FileSpreadsheet,
    description: "Libro con la hoja Inventario y una hoja Resumen con totales por torre y estante.",
    details: <>
      <li>Hojas «Inventario» y «Resumen».</li>
      <li>Solo valores, sin fórmulas.</li>
      <li>Columnas de «Inventario»: {INVENTORY_HEADERS.join(", ")}.</li>
      <li>{SNAPSHOT_NOTE}</li>
    </> },
  { format: "png", title: "Mapa PNG", ext: ".png", icon: ImageIcon,
    description: "Imagen del mapa de torres y estantes para compartir o imprimir. Rojo = ocupado · Verde = disponible.",
    details: <>
      <li>Imagen estática con la leyenda «Rojo = ocupado · Verde = disponible».</li>
      <li>Ancho mínimo de 1200 px; incluye torres y estantes con sus códigos vigentes.</li>
      <li>{SNAPSHOT_NOTE}</li>
    </> },
];
const TIME_FORMAT = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Santiago" });

export function ExportPanel() {
  const busyRef = useRef(false);
  const buttons = useRef<Partial<Record<Format, HTMLButtonElement | null>>>({});
  const restoreFocus = useRef<Format | null>(null);
  const [pending, setPending] = useState<Format | null>(null);
  const [stage, setStage] = useState("");
  const [results, setResults] = useState<Partial<Record<Format, Result>>>({});

  // Focus goes back to the originating button only when the browser dropped it on <body> (the button was disabled
  // while exporting); it never takes focus from something the user moved to.
  useEffect(() => {
    if (pending === null && restoreFocus.current) {
      buttons.current[restoreFocus.current]?.focus();
      restoreFocus.current = null;
    }
  }, [pending]);

  async function exportFile(format: Format) {
    if (busyRef.current) return;
    busyRef.current = true;
    const label = options.find(option => option.format === format)!.title;
    setPending(format);
    setStage("Consultando inventario…");
    // A new attempt clears every previous error and the previous result of this format; other successes stay.
    setResults(previous => Object.fromEntries(Object.entries(previous).filter(([key, value]) => key !== format && value.kind === "success")));
    let result: Result;
    try {
      const snapshot = await getExportSnapshot();
      setStage("Generando archivo…");
      if (format === "csv") downloadCsv(snapshot);
      else if (format === "xlsx") await downloadXlsx(snapshot);
      else await downloadTowerPng(snapshot);
      result = { kind: "success", message: `Descarga de ${label} iniciada a las ${TIME_FORMAT.format(new Date())}.` };
    } catch {
      result = { kind: "error", message: `No pudimos exportar el ${label}. Comprueba tu conexión e inténtalo de nuevo.` };
    } finally {
      busyRef.current = false;
      const active = document.activeElement;
      if (!active || active === document.body || active === buttons.current[format]) restoreFocus.current = format;
      setPending(null);
      setStage("");
    }
    setResults(previous => ({ ...previous, [format]: result }));
  }

  return <>
    <div className="export-grid">{options.map(({ format, title, ext, description, icon: Icon, details }) => {
      const result = results[format];
      const loading = pending === format;
      const locked = pending !== null && !loading;
      return <article className="export-card" key={format} data-format={format} data-state={loading ? "loading" : result?.kind ?? "idle"} aria-busy={loading}>
        <div className="export-card-head">
          <span className="export-icon"><Icon size={24} aria-hidden="true" /></span>
          <div><h2>{title}</h2><span className="export-ext">{ext}</span></div>
        </div>
        <p className="export-desc">{description}</p>
        <p className="export-filename">Archivo: <code>inventario-ingeagro-AAAA-MM-DD{ext}</code></p>
        <button type="button" ref={node => { buttons.current[format] = node; }} className="catalog-button primary" disabled={pending !== null}
          aria-describedby={locked ? `export-lock-${format}` : undefined} onClick={() => void exportFile(format)}>
          {`Exportar ${title}`}
        </button>
        {locked && <p className="export-lock" id={`export-lock-${format}`}>Disponible cuando termine la exportación en curso.</p>}
        <p className={`export-status${result?.kind === "success" && !loading ? " catalog-message success" : ""}`} role="status" aria-live="polite">
          {loading ? stage : result?.kind === "success" ? result.message : ""}
        </p>
        {result?.kind === "error" && !loading && <p className="catalog-message error" role="alert">{result.message}</p>}
        <details className="export-details">
          <summary>Detalles del archivo</summary>
          <ul>{details}</ul>
        </details>
      </article>;
    })}</div>
    <p className="export-note">Los archivos se descargan directamente en este dispositivo y reflejan el inventario en el momento de exportar.</p>
    <p className="export-note">Los productos sin stock aparecen con cantidad 0 y ubicación vacía. Las cajas usan su código vigente y dejan vacías las columnas de torre.</p>
  </>;
}
