export interface MarkerRect { x: number; y: number; width: number; height: number }
export interface MarkerAnchor { id: string; x: number; y: number; visible: boolean }
export interface PlacedMarker extends MarkerAnchor { rect?: MarkerRect }

const valid = (rect: MarkerRect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
export function markerRectsOverlap(a: MarkerRect, b: MarkerRect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Anchors are pixels relative to the visual. Keep pins distinct and out of UI
 * overlays. When the viewport cannot fit a pin, its story remains in the list. */
export function packGiftMarkers(anchors: readonly MarkerAnchor[], width: number, height: number, obstacles: readonly MarkerRect[] = [], size = 44): PlacedMarker[] {
  if (!Number.isFinite(width + height) || width < size + 20 || height < size + 20) return anchors.map(anchor => ({ ...anchor, visible: false }));
  const blocked = obstacles.filter(valid), occupied: MarkerRect[] = [], margin = 10;
  // Give each stop breathing room without inflating the dock or reader's bounds.
  const pinGap = Math.min(72, Math.max(32, Math.min(width, height) * .14)), step = size + pinGap;
  const clamp = (value: number, maximum: number) => Math.min(maximum - margin - size / 2, Math.max(margin + size / 2, value));
  return anchors.map(anchor => {
    if (!anchor.visible || !Number.isFinite(anchor.x + anchor.y)) return { ...anchor, visible: false };
    const x = clamp(anchor.x, width), y = clamp(anchor.y, height);
    const candidates = [{ x, y }];
    // Deterministic, nearest-first rings avoid jitter when nearby points project
    // to the same screen position. Search locally rather than suggesting false
    // geographic placement on the opposite side of the world.
    for (const distance of [step, step * 1.5, step * 2, step * 3]) {
      for (let index = 0; index < 8; index++) { const angle = index * Math.PI / 4; candidates.push({ x: clamp(x + Math.cos(angle) * distance, width), y: clamp(y + Math.sin(angle) * distance, height) }); }
    }
    for (const point of candidates) {
      const rect = { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size };
      if (blocked.some(other => markerRectsOverlap(rect, other, 8)) || occupied.some(other => markerRectsOverlap(rect, other, pinGap))) continue;
      occupied.push(rect); return { id: anchor.id, x: point.x, y: point.y, visible: true, rect };
    }
    return { ...anchor, visible: false };
  });
}

/** A hover/focus title gets its own collision-free rectangle. If there is no
 * room, the accessible name and the story list still expose the full title. */
export function placeGiftMarkerLabel(pin: MarkerRect, labelWidth: number, labelHeight: number, width: number, height: number, occupied: readonly MarkerRect[]): MarkerRect | undefined {
  if (!valid(pin) || !Number.isFinite(labelWidth + labelHeight + width + height) || labelWidth <= 0 || labelHeight <= 0) return;
  const gap = 10, candidates = [
    { x: pin.x + pin.width + gap, y: pin.y + (pin.height - labelHeight) / 2 },
    { x: pin.x - gap - labelWidth, y: pin.y + (pin.height - labelHeight) / 2 },
    { x: pin.x + (pin.width - labelWidth) / 2, y: pin.y - gap - labelHeight },
    { x: pin.x + (pin.width - labelWidth) / 2, y: pin.y + pin.height + gap },
  ];
  for (const candidate of candidates) {
    const rect = { ...candidate, width: labelWidth, height: labelHeight };
    if (rect.x < 10 || rect.y < 10 || rect.x + rect.width > width - 10 || rect.y + rect.height > height - 10) continue;
    if (!occupied.filter(valid).some(other => markerRectsOverlap(rect, other, 6))) return rect;
  }
}
