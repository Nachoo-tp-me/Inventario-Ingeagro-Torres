import { inventoryCsv, inventoryWorkbookData, type ExportSnapshot } from "@/lib/export-model";

function filename(snapshot: ExportSnapshot, extension: string) {
  const date = snapshot.generadoEn.slice(0, 10);
  return `inventario-ingeagro-${date}.${extension}`;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadCsv(snapshot: ExportSnapshot) {
  const blob = new Blob([inventoryCsv(snapshot)], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename(snapshot, "csv"));
}

export async function downloadXlsx(snapshot: ExportSnapshot) {
  // La librería solo se descarga cuando se solicita Excel.
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const sheets = inventoryWorkbookData(snapshot).map((sheet) => ({
    sheet: sheet.sheet,
    data: sheet.data,
  }));
  const blob = await writeExcelFile(sheets).toBlob();
  downloadBlob(blob, filename(snapshot, "xlsx"));
}

export async function downloadTowerPng(snapshot: ExportSnapshot) {
  const occupiedColor = "#c1434f";
  const availableColor = "#13795b";
  const canvas = document.createElement("canvas");
  const margin = 70;
  const towerWidth = 650;
  const gap = 30;
  canvas.width = Math.max(1200, margin * 2 + snapshot.torres.length * towerWidth +
    Math.max(0, snapshot.torres.length - 1) * gap);
  canvas.height = 1120;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas no disponible");

  context.fillStyle = "#f7faf9";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#173738";
  context.font = "bold 46px Arial, sans-serif";
  context.fillText("Inventario Ingeagro · Torres", margin, 77);
  context.font = "24px Arial, sans-serif";
  context.fillStyle = "#536c68";
  const date = new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago",
  }).format(new Date(snapshot.generadoEn));
  context.fillText(`Generado: ${date}`, margin, 119);
  context.fillStyle = occupiedColor;
  context.fillRect(margin, 147, 22, 22);
  context.fillStyle = "#173738";
  context.font = "20px Arial, sans-serif";
  context.fillText("Ocupado", margin + 32, 165);
  context.fillStyle = availableColor;
  context.fillRect(margin + 170, 147, 22, 22);
  context.fillStyle = "#173738";
  context.fillText("Disponible", margin + 202, 165);

  if (!snapshot.torres.length) {
    context.font = "30px Arial, sans-serif";
    context.fillText("No hay torres registradas", margin, 340);
  }
  for (const [index, tower] of snapshot.torres.entries()) {
    const x = margin + index * (towerWidth + gap);
    context.fillStyle = "#ffffff";
    context.fillRect(x, 205, towerWidth, 845);
    context.strokeStyle = "#d4e2dd";
    context.lineWidth = 2;
    context.strokeRect(x, 205, towerWidth, 845);
    context.fillStyle = "#173738";
    context.font = "bold 38px Arial, sans-serif";
    context.fillText(`Torre ${tower.codigo}`, x + 25, 259);
    context.font = "20px Arial, sans-serif";
    context.fillStyle = "#536c68";
    context.fillText(`${tower.ocupados} ocupados · ${tower.disponibles} disponibles`, x + 25, 293);

    for (let floor = 6; floor >= 1; floor--) {
      const y = 322 + (6 - floor) * 119;
      context.fillStyle = floor % 2 ? "#f7faf9" : "#edf4f1";
      context.fillRect(x + 18, y, towerWidth - 36, 109);
      context.fillStyle = "#3d5a55";
      context.font = "bold 17px Arial, sans-serif";
      context.fillText(`Piso ${floor}`, x + 29, y + 57);
      for (let position = 1; position <= 4; position++) {
        const place = tower.compartimientos.find((item) => item.piso === floor && item.posicion === position);
        const tileX = x + 115 + (position - 1) * 127;
        const tileY = y + 17;
        context.fillStyle = place?.ocupado ? occupiedColor : availableColor;
        context.fillRect(tileX, tileY, 117, 76);
        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        context.font = "bold 25px Arial, sans-serif";
        context.fillText(place?.codigo ?? "—", tileX + 58, tileY + 34);
        context.font = "14px Arial, sans-serif";
        context.fillText(place?.ocupado ? "Ocupado" : "Disponible", tileX + 58, tileY + 58);
        context.textAlign = "left";
      }
    }
  }
  context.fillStyle = "#536c68";
  context.font = "18px Arial, sans-serif";
  context.fillText("Rojo = ocupado · Verde = disponible", margin, 1090);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo generar PNG")), "image/png");
  });
  downloadBlob(blob, filename(snapshot, "png"));
}
