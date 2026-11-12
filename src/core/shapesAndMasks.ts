import type {
  LayerMask,
  ShapeLayerData,
  ShapeVertex,
  TrackMatteMode,
  VectorShapeKind,
} from '../types/editor';

export function createDefaultShapeData(kind: VectorShapeKind): ShapeLayerData {
  const defaultVertices: ShapeVertex[] | undefined =
    kind === 'path'
      ? [
          { x: -38, y: 18, outX: 16, outY: -42 },
          { x: 0, y: -28, inX: -16, inY: 0, outX: 16, outY: 0 },
          { x: 38, y: 18, inX: -16, inY: -42 },
        ]
      : undefined;

  return {
    kind,
    width: kind === 'line' ? 56 : 36,
    height: kind === 'line' ? 8 : 36,
    fillMode: kind === 'line' || kind === 'path' ? 'none' : 'linear-gradient',
    fillColor: '#3b82f6',
    gradientColor2: '#a855f7',
    gradientAngle: 45,
    fillOpacity: 100,
    strokeColor: '#38bdf8',
    strokeWidth: kind === 'line' || kind === 'path' ? 6 : 3,
    lineCap: 'round',
    lineJoin: 'round',
    cornerRadius: 16,
    sides: kind === 'star' ? 5 : 6,
    innerRadius: 46,
    trimStart: 0,
    trimEnd: 100,
    trimOffset: 0,
    repeaterCopies: 1,
    repeaterOffsetX: 48,
    repeaterOffsetY: 0,
    repeaterRotation: 0,
    repeaterScale: 100,
    repeaterOpacityEnd: 35,
    closed: kind !== 'line' && kind !== 'path',
    vertices: defaultVertices,
  };
}

export function createDefaultMask(kind: LayerMask['kind'] = 'rect', index = 1): LayerMask {
  return {
    id: `mask-${Math.random().toString(36).slice(2, 9)}`,
    name: `Máscara ${index}`,
    enabled: true,
    kind,
    mode: 'add',
    inverted: false,
    x: 0,
    y: 0,
    width: 68,
    height: 68,
    feather: 0,
    expansion: 0,
    opacity: 100,
    vertices:
      kind === 'path'
        ? [
            { x: -35, y: -30 },
            { x: 35, y: -30 },
            { x: 35, y: 30 },
            { x: -35, y: 30 },
          ]
        : undefined,
  };
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Generates high-density polyline points centered around (0, 0) for box size (boxW, boxH),
 * enabling exact mathematical Trim Paths on ANY vector shape or custom Bézier path!
 */
export function buildShapePolyline(
  shape: ShapeLayerData,
  boxW: number,
  boxH: number
): { points: Pt[]; closed: boolean } {
  const hw = Math.max(2, boxW / 2);
  const hh = Math.max(2, boxH / 2);
  const pts: Pt[] = [];

  if (shape.kind === 'line') {
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      pts.push({ x: -hw + u * boxW, y: 0 });
    }
    return { points: pts, closed: false };
  }

  if (shape.kind === 'ellipse') {
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
      pts.push({ x: Math.cos(a) * hw, y: Math.sin(a) * hh });
    }
    return { points: pts, closed: true };
  }

  if (shape.kind === 'rect') {
    const r = Math.min(hw, hh, Math.max(0, shape.cornerRadius * (Math.min(boxW, boxH) / 260)));
    const corners = [
      { cx: hw - r, cy: -hh + r, a0: -Math.PI / 2, a1: 0 },
      { cx: hw - r, cy: hh - r, a0: 0, a1: Math.PI / 2 },
      { cx: -hw + r, cy: hh - r, a0: Math.PI / 2, a1: Math.PI },
      { cx: -hw + r, cy: -hh + r, a0: Math.PI, a1: Math.PI * 1.5 },
    ];
    for (const c of corners) {
      for (let s = 0; s <= 12; s++) {
        const a = c.a0 + (s / 12) * (c.a1 - c.a0);
        pts.push({ x: c.cx + Math.cos(a) * r, y: c.cy + Math.sin(a) * r });
      }
    }
    pts.push({ ...pts[0] });
    return { points: pts, closed: true };
  }

  if (shape.kind === 'polygon' || shape.kind === 'star') {
    const n = Math.max(3, Math.round(shape.sides || 5));
    const totalVerts = shape.kind === 'star' ? n * 2 : n;
    const innerRatio = Math.max(0.1, Math.min(0.95, (shape.innerRadius || 45) / 100));
    const vertices: Pt[] = [];
    for (let i = 0; i < totalVerts; i++) {
      const a = -Math.PI / 2 + (i / totalVerts) * Math.PI * 2;
      const rad = shape.kind === 'star' && i % 2 === 1 ? innerRatio : 1;
      vertices.push({ x: Math.cos(a) * hw * rad, y: Math.sin(a) * hh * rad });
    }
    vertices.push({ ...vertices[0] });
    // Subdivide segments cleanly for smooth Trim Paths
    for (let i = 0; i < vertices.length - 1; i++) {
      const a = vertices[i];
      const b = vertices[i + 1];
      for (let s = 0; s < 10; s++) {
        const u = s / 10;
        pts.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
      }
    }
    pts.push({ ...vertices[vertices.length - 1] });
    return { points: pts, closed: true };
  }

  // Custom Bezier Path
  const verts = shape.vertices?.length
    ? shape.vertices
    : [
        { x: -35, y: 15, outX: 15, outY: -35 },
        { x: 35, y: -15, inX: -15, inY: 35 },
      ];
  const scaleX = boxW / 100;
  const scaleY = boxH / 100;
  const segCount = shape.closed ? verts.length : Math.max(0, verts.length - 1);
  for (let i = 0; i < segCount; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const p0 = { x: a.x * scaleX, y: a.y * scaleY };
    const p1 = { x: (a.x + (a.outX ?? 0)) * scaleX, y: (a.y + (a.outY ?? 0)) * scaleY };
    const p2 = { x: (b.x + (b.inX ?? 0)) * scaleX, y: (b.y + (b.inY ?? 0)) * scaleY };
    const p3 = { x: b.x * scaleX, y: b.y * scaleY };
    const steps = 20;
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      const r = 1 - u;
      pts.push({
        x: r * r * r * p0.x + 3 * r * r * u * p1.x + 3 * r * u * u * p2.x + u * u * u * p3.x,
        y: r * r * r * p0.y + 3 * r * r * u * p1.y + 3 * r * u * u * p2.y + u * u * u * p3.y,
      });
    }
  }
  if (verts.length > 0) {
    const endV = shape.closed ? verts[0] : verts[verts.length - 1];
    pts.push({ x: endV.x * scaleX, y: endV.y * scaleY });
  }
  return { points: pts, closed: !!shape.closed };
}

function slicePolylineByArcLength(points: Pt[], startFrac: number, endFrac: number): Pt[] {
  if (points.length < 2) return points;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];
  if (total < 1e-4) return points;

  const s0 = Math.max(0, Math.min(1, Math.min(startFrac, endFrac))) * total;
  const s1 = Math.max(0, Math.min(1, Math.max(startFrac, endFrac))) * total;
  if (s1 - s0 < 1e-4) return [];

  const interpAt = (dist: number): Pt => {
    let idx = 0;
    while (idx < cum.length - 2 && cum[idx + 1] < dist) idx++;
    const segLen = Math.max(1e-6, cum[idx + 1] - cum[idx]);
    const u = (dist - cum[idx]) / segLen;
    return {
      x: points[idx].x + (points[idx + 1].x - points[idx].x) * u,
      y: points[idx].y + (points[idx + 1].y - points[idx].y) * u,
    };
  };

  const out: Pt[] = [interpAt(s0)];
  for (let i = 1; i < points.length - 1; i++) {
    if (cum[i] > s0 && cum[i] < s1) out.push(points[i]);
  }
  out.push(interpAt(s1));
  return out;
}

export function renderVectorShapeLayer(
  ctx: CanvasRenderingContext2D,
  shape: ShapeLayerData,
  canvasW: number,
  canvasH: number,
  overrides?: { trimStart?: number; trimEnd?: number; strokeWidth?: number; strokeDashOffset?: number }
): { width: number; height: number } {
  const scaleRatio = canvasH / 720;
  const boxW = Math.max(8, (shape.width / 100) * canvasW);
  const boxH = Math.max(8, (shape.height / 100) * canvasH);
  const copies = Math.max(1, Math.min(24, Math.round(shape.repeaterCopies || 1)));

  const trimStart = (overrides?.trimStart ?? shape.trimStart ?? 0) / 100;
  const trimEnd = (overrides?.trimEnd ?? shape.trimEnd ?? 100) / 100;
  const strokeW = (overrides?.strokeWidth ?? shape.strokeWidth ?? 0) * scaleRatio;

  const { points, closed } = buildShapePolyline(shape, boxW, boxH);
  const offsetShift = (((shape.trimOffset || 0) % 360) + 360) % 360 / 360;

  let workingPts = points;
  if (closed && offsetShift > 0.001 && points.length > 3) {
    const idx = Math.floor(offsetShift * (points.length - 1));
    workingPts = [...points.slice(idx), ...points.slice(1, idx + 1)];
  }

  const isTrimmed = Math.abs(trimEnd - trimStart) < 0.999;
  const drawnPts = isTrimmed ? slicePolylineByArcLength(workingPts, trimStart, trimEnd) : workingPts;

  for (let c = 0; c < copies; c++) {
    const copyFrac = copies > 1 ? c / (copies - 1) : 0;
    const copyAlpha =
      1 * (1 - copyFrac) + ((shape.repeaterOpacityEnd ?? 100) / 100) * copyFrac;
    const copyScale = Math.pow((shape.repeaterScale || 100) / 100, c);

    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, copyAlpha));
    ctx.translate(
      c * (shape.repeaterOffsetX || 0) * scaleRatio,
      c * (shape.repeaterOffsetY || 0) * scaleRatio
    );
    ctx.rotate(((c * (shape.repeaterRotation || 0)) * Math.PI) / 180);
    ctx.scale(copyScale, copyScale);

    if (drawnPts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(drawnPts[0].x, drawnPts[0].y);
      for (let i = 1; i < drawnPts.length; i++) {
        ctx.lineTo(drawnPts[i].x, drawnPts[i].y);
      }
      if (closed && !isTrimmed) ctx.closePath();

      if (shape.fillMode !== 'none' && (shape.fillOpacity ?? 100) > 0) {
        ctx.save();
        ctx.globalAlpha *= (shape.fillOpacity ?? 100) / 100;
        if (shape.fillMode === 'linear-gradient') {
          const rad = ((shape.gradientAngle || 45) * Math.PI) / 180;
          const gx = Math.cos(rad) * (boxW / 2);
          const gy = Math.sin(rad) * (boxH / 2);
          const grad = ctx.createLinearGradient(-gx, -gy, gx, gy);
          grad.addColorStop(0, shape.fillColor);
          grad.addColorStop(1, shape.gradientColor2 || '#ffffff');
          ctx.fillStyle = grad;
        } else if (shape.fillMode === 'radial-gradient') {
          const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, Math.max(boxW, boxH) * 0.55);
          grad.addColorStop(0, shape.fillColor);
          grad.addColorStop(1, shape.gradientColor2 || '#000000');
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = shape.fillColor;
        }
        ctx.fill();
        ctx.restore();
      }

      if (strokeW > 0.05) {
        ctx.strokeStyle = shape.strokeColor;
        ctx.lineWidth = strokeW;
        ctx.lineCap = shape.lineCap || 'round';
        ctx.lineJoin = shape.lineJoin || 'round';

        // Suporte a contornos vetoriais tracejados profissionais e animados
        if (shape.strokeDashArray && shape.strokeDashArray.length > 0) {
          ctx.setLineDash(shape.strokeDashArray.map((v) => v * scaleRatio));
          ctx.lineDashOffset =
            (overrides?.strokeDashOffset ?? shape.strokeDashOffset ?? 0) * scaleRatio;
        } else {
          ctx.setLineDash([]);
        }

        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  return { width: boxW, height: boxH };
}

// ---------------- Offscreen Mask & Track Matte Compositing Engine ----------------
const maskScratch = new Map<string, HTMLCanvasElement>();
function getMaskCanvas(key: string, w: number, h: number): CanvasRenderingContext2D {
  let c = maskScratch.get(key);
  if (!c) {
    c = document.createElement('canvas');
    maskScratch.set(key, c);
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
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

function drawSingleMaskSilhouette(
  mctx: CanvasRenderingContext2D,
  mask: LayerMask,
  w: number,
  h: number,
  featherPx: number,
  expansionPx: number
) {
  const cx = w / 2 + (mask.x / 100) * w;
  const cy = h / 2 + (mask.y / 100) * h;
  const mw = Math.max(2, (mask.width / 100) * w + expansionPx * 2);
  const mh = Math.max(2, (mask.height / 100) * h + expansionPx * 2);

  mctx.save();
  if (featherPx > 0.3) {
    mctx.filter = `blur(${featherPx.toFixed(1)}px)`;
  }

  if (mask.inverted) {
    mctx.fillStyle = '#ffffff';
    mctx.fillRect(0, 0, w, h);
    mctx.globalCompositeOperation = 'destination-out';
  }

  mctx.fillStyle = '#ffffff';
  mctx.translate(cx, cy);
  mctx.beginPath();
  if (mask.kind === 'ellipse') {
    mctx.ellipse(0, 0, mw / 2, mh / 2, 0, 0, Math.PI * 2);
  } else if (mask.kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const r = i % 2 === 1 ? 0.45 : 1;
      const px = Math.cos(a) * (mw / 2) * r;
      const py = Math.sin(a) * (mh / 2) * r;
      if (i === 0) mctx.moveTo(px, py);
      else mctx.lineTo(px, py);
    }
    mctx.closePath();
  } else if (mask.kind === 'path' && mask.vertices?.length) {
    mask.vertices.forEach((v, idx) => {
      const px = (v.x / 100) * mw;
      const py = (v.y / 100) * mh;
      if (idx === 0) mctx.moveTo(px, py);
      else mctx.lineTo(px, py);
    });
    mctx.closePath();
  } else {
    mctx.rect(-mw / 2, -mh / 2, mw, mh);
  }
  mctx.fill();
  mctx.restore();
}

/**
 * Applies multi-mask Boolean alpha composition (add, subtract, intersect, feather, expansion, invert)
 * directly onto `layerCtx`'s rendered pixels.
 */
export function applyLayerMasksToCanvas(
  layerCtx: CanvasRenderingContext2D,
  w: number,
  h: number,
  masks: LayerMask[],
  animFeather?: number,
  animExpansion?: number
) {
  const active = masks.filter((m) => m.enabled);
  if (active.length === 0) return;

  const combined = getMaskCanvas('mask-combined', w, h);
  const scaleRatio = h / 720;

  active.forEach((mask, idx) => {
    const single = getMaskCanvas('mask-single', w, h);
    const feather = ((idx === 0 && animFeather !== undefined ? animFeather : mask.feather) || 0) * scaleRatio;
    const expansion = ((idx === 0 && animExpansion !== undefined ? animExpansion : mask.expansion) || 0) * scaleRatio;
    drawSingleMaskSilhouette(single, mask, w, h, feather, expansion);

    combined.save();
    combined.globalAlpha = Math.max(0, Math.min(1, (mask.opacity ?? 100) / 100));
    if (idx === 0 || mask.mode === 'add') {
      combined.globalCompositeOperation = 'source-over';
    } else if (mask.mode === 'subtract') {
      combined.globalCompositeOperation = 'destination-out';
    } else if (mask.mode === 'intersect') {
      combined.globalCompositeOperation = 'destination-in';
    }
    combined.drawImage(single.canvas, 0, 0);
    combined.restore();
  });

  layerCtx.save();
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.drawImage(combined.canvas, 0, 0);
  layerCtx.restore();
}

/**
 * Applies Alpha / Alpha-Inverted / Luma / Luma-Inverted Track Matte using `matteCanvas`.
 */
export function applyTrackMatteToCanvas(
  layerCtx: CanvasRenderingContext2D,
  matteCanvas: HTMLCanvasElement,
  w: number,
  h: number,
  mode: TrackMatteMode
) {
  if (mode === 'none') return;

  if (mode === 'alpha' || mode === 'alpha-inverted') {
    layerCtx.save();
    layerCtx.globalCompositeOperation = mode === 'alpha' ? 'destination-in' : 'destination-out';
    layerCtx.drawImage(matteCanvas, 0, 0, w, h);
    layerCtx.restore();
    return;
  }

  // Luma or Luma-Inverted matte: convert RGB luminance of matteCanvas into alpha
  const lumaCtx = getMaskCanvas('matte-luma', w, h);
  lumaCtx.drawImage(matteCanvas, 0, 0, w, h);
  const img = lumaCtx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * (d[i + 3] / 255);
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = mode === 'luma' ? Math.round(lum) : Math.round(255 - lum);
  }
  lumaCtx.putImageData(img, 0, 0);

  layerCtx.save();
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.drawImage(lumaCtx.canvas, 0, 0, w, h);
  layerCtx.restore();
}
