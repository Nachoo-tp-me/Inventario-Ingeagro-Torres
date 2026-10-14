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

function drawMapLabel(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size: number, maxLines: number) {
  // Ajusta y divide el texto completo, sin truncar ni comprimir horizontalmente.
  for (let fontSize = size; fontSize >= 16; fontSize--) {
    context.font = `bold ${fontSize}px Arial, sans-serif`;
    const lines: string[] = [];
    let line = "";
    for (const character of text) {
      if (line && context.measureText(line + character).width > width) { lines.push(line); line = ""; }
      line += character;
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) {
      lines.forEach((value, index) => context.fillText(value, x, y + index * (size + 4)));
      return;
    }
  }
  throw new Error("Una etiqueta no cabe en el mapa sin perder legibilidad");
}

export function createInventoryMapCanvas(snapshot: ExportSnapshot) {
  const occupiedColor = "#c1434f";
  const availableColor = "#13795b";
  const canvas = document.createElement("canvas");
  const margin = 70;
  const towerWidth = 650;
  const gap = 30;
  const shelfColumns = Math.min(3, snapshot.estantes.length);
  const columns = Math.max(snapshot.torres.length, shelfColumns);
  const shelfHeight = 450;
  const groups = (["A", "B"] as const).map(group => ({ group, shelves: snapshot.estantes.filter(shelf => shelf.grupo === group) }))
    .filter(group => group.shelves.length);
  const shelfStart = snapshot.torres.length ? 1120 : 300;
  const shelfSectionHeight = groups.reduce((height, group) => height + 100 + Math.ceil(group.shelves.length / shelfColumns) * (shelfHeight + gap), 0);
  canvas.width = Math.max(1200, margin * 2 + columns * towerWidth + Math.max(0, columns - 1) * gap);
  canvas.height = groups.length ? Math.max(1120, shelfStart + shelfSectionHeight + 50) : 1120;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas no disponible");

  context.fillStyle = "#f7faf9";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#173738";
  context.font = "bold 46px Arial, sans-serif";
  context.fillText(`Inventario Ingeagro · ${snapshot.estantes.length ? "Torres y estantes" : "Torres"}`, margin, 77);
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
    context.fillText("No hay torres registradas", margin, snapshot.estantes.length ? 230 : 340);
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
        context.fillStyle = !place ? "#536c68" : place.ocupado ? occupiedColor : availableColor;
        context.fillRect(tileX, tileY, 117, 76);
        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        context.font = "bold 25px Arial, sans-serif";
        context.fillText(place?.codigo ?? "—", tileX + 58, tileY + 34);
        context.font = "14px Arial, sans-serif";
        context.fillText(!place ? "Sin registro" : place.ocupado ? "Ocupado" : "Disponible", tileX + 58, tileY + 58);
        context.textAlign = "left";
      }
    }
  }
  let sectionY = shelfStart;
  for (const { group, shelves } of groups) {
    context.fillStyle = "#173738";
    context.font = "bold 34px Arial, sans-serif";
    context.fillText(`Estantes · Grupo ${group}`, margin, sectionY + 40);
    for (const [index, shelf] of shelves.entries()) {
      const x = margin + (index % shelfColumns) * (towerWidth + gap);
      const y = sectionY + 70 + Math.floor(index / shelfColumns) * (shelfHeight + gap);
      context.fillStyle = "#ffffff";
      context.fillRect(x, y, towerWidth, shelfHeight);
      context.strokeStyle = "#d4e2dd";
      context.strokeRect(x, y, towerWidth, shelfHeight);
      context.fillStyle = "#173738";
      drawMapLabel(context, shelf.nombre, x + 25, y + 40, towerWidth - 50, 30, 1);
      context.font = "20px Arial, sans-serif";
      context.fillStyle = "#536c68";
      context.fillText(`${shelf.ocupados} ocupados · ${shelf.disponibles} disponibles`, x + 25, y + 73);
      for (const box of shelf.cajas) {
        const tileX = x + 25 + ((box.posicion - 1) % 2) * 310;
        const tileY = y + 95 + Math.floor((box.posicion - 1) / 2) * 175;
        context.fillStyle = box.ocupado ? occupiedColor : availableColor;
        context.fillRect(tileX, tileY, 290, 155);
        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        drawMapLabel(context, box.codigo, tileX + 145, tileY + 34, 262, 28, 3);
        context.font = "18px Arial, sans-serif";
        context.fillText(box.ocupado ? "Ocupado" : "Disponible", tileX + 145, tileY + 136);
        context.textAlign = "left";
      }
    }
    sectionY += 100 + Math.ceil(shelves.length / shelfColumns) * (shelfHeight + gap);
  }
  context.fillStyle = "#536c68";
  context.font = "18px Arial, sans-serif";
  context.fillText("Rojo = ocupado · Verde = disponible", margin, canvas.height - 30);
  return canvas;
}

// Conserva la entrada de descarga existente; el mapa incluye ambos tipos.
export async function downloadTowerPng(snapshot: ExportSnapshot) {
  const canvas = createInventoryMapCanvas(snapshot);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo generar PNG")), "image/png");
  });
  downloadBlob(blob, filename(snapshot, "png"));
}
