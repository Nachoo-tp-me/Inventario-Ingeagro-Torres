type Rect = { left: number; right: number; top: number; bottom: number };

// Coordinates are relative to the layout viewport, as with getBoundingClientRect.
export function getStockMenuPosition(anchor: Rect, menu: { width: number; height: number }, viewport: Rect) {
  const margin = 8;
  const gap = 4;
  const top = viewport.top + margin;
  const bottom = Math.max(top, viewport.bottom - margin);
  const below = Math.max(0, bottom - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - top);
  const opensBelow = menu.height <= below || below >= above;
  const maxHeight = Math.min(bottom - top, opensBelow ? below : above);
  const height = Math.min(menu.height, maxHeight);
  const left = Math.max(viewport.left + margin, Math.min(anchor.right - menu.width, viewport.right - margin - menu.width));

  return {
    left,
    top: Math.max(top, Math.min(opensBelow ? anchor.bottom + gap : anchor.top - gap - height, bottom - height)),
    maxHeight,
  };
}
