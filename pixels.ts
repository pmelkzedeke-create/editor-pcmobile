import type { ClipVfx, NormalizedRect } from '../../types/editor';

export function medianBorderColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const channels: number[][] = [[], [], []];
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) return;
    for (let c = 0; c < 3; c++) channels[c].push(data[i + c]);
  };
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 48))) { add(x, 0); add(x, height - 1); }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 48))) { add(0, y); add(width - 1, y); }
  return channels.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0) as [number, number, number];
}

/** Border-connected color segmentation; no external model, no fabricated AI. */
export function removeBackgroundPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  settings: NonNullable<ClipVfx['background']>
): void {
  if (!settings.enabled) return;
  const key: [number, number, number] = settings.color && /^#[\da-f]{6}$/i.test(settings.color)
    ? [parseInt(settings.color.slice(1, 3), 16), parseInt(settings.color.slice(3, 5), 16), parseInt(settings.color.slice(5, 7), 16)]
    : medianBorderColor(data, width, height);
  const count = width * height;
  const mask = new Float32Array(count);
  const tolerance = Math.max(0, settings.tolerance);
  const softness = Math.max(1, settings.softness);
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    const distance = Math.sqrt(((data[i] - key[0]) ** 2 + (data[i + 1] - key[1]) ** 2 + (data[i + 2] - key[2]) ** 2) / 3);
    mask[p] = Math.max(0, Math.min(1, (tolerance + softness - distance) / softness));
  }
  const visited = new Uint8Array(count);
  if (settings.connected) {
    const queue = new Int32Array(count);
    let head = 0;
    let tail = 0;
    const enqueue = (p: number) => {
      if (!visited[p] && mask[p] > 0) { visited[p] = 1; queue[tail++] = p; }
    };
    for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      if (x > 0) enqueue(p - 1);
      if (x < width - 1) enqueue(p + 1);
      if (p >= width) enqueue(p - width);
      if (p + width < count) enqueue(p + width);
    }
  } else visited.fill(1);
  for (let p = 0; p < count; p++) {
    if (visited[p]) data[p * 4 + 3] = Math.round(data[p * 4 + 3] * (1 - mask[p]));
  }
}

/** Feathered clone from an explicitly chosen offset in the same source frame. */
export function clonePatchPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rect: NormalizedRect,
  offsetX: number,
  offsetY: number,
  feather: number
): void {
  const original = data.slice();
  const x0 = Math.max(0, Math.floor(rect.x * width));
  const y0 = Math.max(0, Math.floor(rect.y * height));
  const x1 = Math.min(width, Math.ceil((rect.x + rect.width) * width));
  const y1 = Math.min(height, Math.ceil((rect.y + rect.height) * height));
  const dx = Math.round(offsetX * width);
  const dy = Math.round(offsetY * height);
  const edge = Math.max(0.5, feather / 100 * Math.min(x1 - x0, y1 - y0) * 0.5);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const a = Math.min(1, Math.min(x - x0 + 1, x1 - x, y - y0 + 1, y1 - y) / edge);
      const dst = (y * width + x) * 4;
      const src = (sy * width + sx) * 4;
      for (let c = 0; c < 4; c++) data[dst + c] = Math.round(original[dst + c] * (1 - a) + original[src + c] * a);
    }
  }
}