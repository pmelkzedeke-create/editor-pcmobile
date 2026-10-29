import type { PuppetPin } from '../types/editor';

const scratchDeform = new Map<string, HTMLCanvasElement>();
function getDeformCanvas(key: string, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let c = scratchDeform.get(key);
  if (!c) {
    c = document.createElement('canvas');
    scratchDeform.set(key, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, w, h);
  return { canvas: c, ctx };
}

interface Point2D {
  x: number;
  y: number;
}

/**
 * Draws a textured triangle from source image using affine transform mapping on 2D canvas.
 */
function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  u0: Point2D,
  u1: Point2D,
  u2: Point2D
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();
  ctx.clip();

  // Solve affine matrix that maps texture coordinates (u0, u1, u2) to deformed screen vertices (p0, p1, p2)
  const denom = u0.x * (u1.y - u2.y) - u0.y * (u1.x - u2.x) + (u1.x * u2.y - u2.x * u1.y);
  if (Math.abs(denom) > 1e-6) {
    const a = (p0.x * (u1.y - u2.y) - p0.y * (u1.x - u2.x) + (u1.x * u2.y - u2.x * u1.y)) / denom;
    const b = (p0.x * (u2.x - u1.x) + u0.x * (p1.x - p2.x) + (u1.x * p2.x - u2.x * p1.x)) / denom;
    const c = (p0.y * (u1.y - u2.y) - p0.y * (u1.x - u2.x) + (u1.x * u2.y - u2.x * u1.y)) / denom;
    const d = (p0.y * (u2.x - u1.x) + u0.x * (p1.y - p2.y) + (u1.x * p2.y - u2.x * p1.y)) / denom;
    const e = p0.x - a * u0.x - b * u0.y;
    const f = p0.y - c * u0.x - d * u0.y;

    // Apply affine transform and render triangle slice
    ctx.transform(a, c, b, d, e, f);
    ctx.drawImage(image, 0, 0);
  }
  ctx.restore();
}

/**
 * Deforms a 2D source image using Puppet Pins with Inverse Distance Weighting (IDW).
 * Works on video frames, images, text and graphics.
 */
export function applyPuppetPinDeformation(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  pins: PuppetPin[],
  gridCols = 16,
  gridRows = 16
): CanvasImageSource {
  if (!pins || pins.length === 0) return source;

  // Check if any pin has actually moved from its origin position
  const anyMoved = pins.some(
    (pin) => Math.hypot(pin.currentX - pin.originX, pin.currentY - pin.originY) > 0.05
  );
  if (!anyMoved) return source;

  const { canvas, ctx } = getDeformCanvas('puppet-mesh', sourceW, sourceH);

  // Convert pins from normalized (-50..50%) to source image pixels (0..sourceW, 0..sourceH)
  const pinData = pins.map((p) => {
    const ox = ((p.originX + 50) / 100) * sourceW;
    const oy = ((p.originY + 50) / 100) * sourceH;
    const cx = ((p.currentX + 50) / 100) * sourceW;
    const cy = ((p.currentY + 50) / 100) * sourceH;
    const radiusPx = (Math.max(5, p.radius || 35) / 100) * Math.max(sourceW, sourceH);
    return { ox, oy, cx, cy, dx: cx - ox, dy: cy - oy, radiusPx };
  });

  // Calculate deformed grid vertices
  const vertices: Point2D[][] = [];
  const uvs: Point2D[][] = [];

  for (let r = 0; r <= gridRows; r++) {
    const rowVerts: Point2D[] = [];
    const rowUVs: Point2D[] = [];
    const uY = (r / gridRows) * sourceH;

    for (let c = 0; c <= gridCols; c++) {
      const uX = (c / gridCols) * sourceW;
      rowUVs.push({ x: uX, y: uY });

      // Calculate displacement for vertex (uX, uY) using Inverse Distance Weighting
      let totalWeight = 0;
      let dispX = 0;
      let dispY = 0;

      for (const pin of pinData) {
        const dist = Math.hypot(uX - pin.ox, uY - pin.oy);
        const normDist = dist / pin.radiusPx;
        // Inverse square falloff with smooth rolloff beyond influence radius
        const weight = 1 / (normDist * normDist + 0.04);
        const falloff = Math.max(0, 1 - Math.pow(Math.min(1, normDist * 0.7), 2));
        const effectiveWeight = weight * falloff;

        totalWeight += effectiveWeight;
        dispX += pin.dx * effectiveWeight;
        dispY += pin.dy * effectiveWeight;
      }

      if (totalWeight > 1e-6) {
        rowVerts.push({
          x: uX + dispX / totalWeight,
          y: uY + dispY / totalWeight,
        });
      } else {
        rowVerts.push({ x: uX, y: uY });
      }
    }
    vertices.push(rowVerts);
    uvs.push(rowUVs);
  }

  // Draw triangulated mesh
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const p00 = vertices[r][c];
      const p10 = vertices[r][c + 1];
      const p01 = vertices[r + 1][c];
      const p11 = vertices[r + 1][c + 1];

      const u00 = uvs[r][c];
      const u10 = uvs[r][c + 1];
      const u01 = uvs[r + 1][c];
      const u11 = uvs[r + 1][c + 1];

      // Upper triangle
      drawTexturedTriangle(ctx, source, p00, p10, p01, u00, u10, u01);
      // Lower triangle
      drawTexturedTriangle(ctx, source, p10, p11, p01, u10, u11, u01);
    }
  }

  return canvas;
}
