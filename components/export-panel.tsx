"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, FileText, Image as ImageIcon } from "lucide-react";
import { getExportSnapshot } from "@/app/(workspace)/export-actions";
import { downloadCsv, downloadTowerPng, downloadXlsx } from "@/lib/export-files";

type Format = "csv" | "xlsx" | "png";
const options = [
  { format: "csv", title: "CSV", description: "Inventario por producto y ubicación, listo para abrir en Excel.", icon: FileText },
  { format: "xlsx", title: "Excel", description: "Libro con hojas Inventario y Resumen.", icon: FileSpreadsheet },
  { format: "png", title: "Mapa PNG", description: "Estado físico de todas las torres para compartir o imprimir.", icon: ImageIcon },
] as const;

export function ExportPanel() {
  const busyRef = useRef(false);
  const [pending, setPending] = useState<Format | null>(null);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function exportFile(format: Format) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(format);
    setStage("Consultando inventario…");
    setError("");
    setSuccess("");
    try {
      const snapshot = await getExportSnapshot();
      setStage("Generando archivo…");
      if (format === "csv") downloadCsv(snapshot);
      else if (format === "xlsx") await downloadXlsx(snapshot);
      else await downloadTowerPng(snapshot);
      setSuccess(`${format === "csv" ? "CSV" : format === "xlsx" ? "Excel" : "PNG"} preparado para descargar.`);
    } catch {
      setError("No pudimos exportar el inventario. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      busyRef.current = false;
      setPending(null);
      setStage("");
    }
  }

  return <>
    <div className="export-grid">{options.map(({ format, title, description, icon: Icon }) => <article className="export-card" key={format}>
      <span className="export-icon"><Icon size={27} aria-hidden="true" /></span>
      <h2>{title}</h2><p>{description}</p>
      <button type="button" className="catalog-button primary" disabled={!!pending} onClick={() => void exportFile(format)}>
        {pending === format ? stage : `Exportar ${title}`}
      </button>
    </article>)}</div>
    {error && <p className="catalog-message error" role="alert">{error}</p>}
    {success && <p className="catalog-message success" role="status">{success}</p>}
    <p className="export-note">Los archivos se descargan directamente en este dispositivo. Los productos sin stock aparecen con cantidad 0 y ubicación vacía.</p>
  </>;
}
