/**
 * Lightweight native Lottie and Vector SVG player for canvas composition.
 * Evaluates shapes, paths and colors dynamically based on clip local time.
 */

export interface LottieShapeItem {
  ty: string; // 'sh' (shape), 'rc' (rect), 'el' (ellipse), 'fl' (fill), 'st' (stroke), 'tr' (transform)
  c?: { k: number[] }; // color RGBA [r, g, b, a]
  o?: { k: number }; // opacity 0..100
  s?: { k: number[] }; // size [w, h]
  p?: { k: number[] }; // position [x, y]
  r?: { k: number }; // rotation
  w?: { k: number }; // stroke width
}

export interface ParsedLottie {
  v: string;
  fr: number; // framerate
  ip: number; // in-point frame
  op: number; // out-point frame
  w: number; // width
  h: number; // height
  layers: any[];
}

export function parseLottieJson(jsonString: string): ParsedLottie | null {
  try {
    const data = JSON.parse(jsonString);
    if (data && typeof data === 'object' && Array.isArray(data.layers) && typeof data.fr === 'number') {
      return data as ParsedLottie;
    }
    return null;
  } catch {
    return null;
  }
}

const lottieScratch = new Map<string, HTMLCanvasElement>();
function getLottieCanvas(key: string, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let c = lottieScratch.get(key);
  if (!c) {
    c = document.createElement('canvas');
    lottieScratch.set(key, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { canvas: c, ctx };
}

/**
 * Renders a frame of a Lottie animation to a 2D canvas at local time.
 */
export function renderLottieFrame(
  lottie: ParsedLottie,
  localTimeSec: number,
  targetW: number,
  targetH: number
): CanvasImageSource {
  const { canvas, ctx } = getLottieCanvas('lottie-frame', targetW, targetH);
  const fr = lottie.fr || 30;
  const totalFrames = Math.max(1, (lottie.op || 60) - (lottie.ip || 0));
  const currentFrame = (lottie.ip || 0) + ((localTimeSec * fr) % totalFrames);

  const scaleX = targetW / (lottie.w || targetW);
  const scaleY = targetH / (lottie.h || targetH);

  ctx.save();
  ctx.scale(scaleX, scaleY);

  // Render vector layers
  for (const layer of lottie.layers || []) {
    if (currentFrame < (layer.ip || 0) || currentFrame >= (layer.op || Infinity)) continue;

    ctx.save();
    // Layer transform
    const tr = layer.ks || {};
    const px = typeof tr.p?.k?.[0] === 'number' ? tr.p.k[0] : 0;
    const py = typeof tr.p?.k?.[1] === 'number' ? tr.p.k[1] : 0;
    const rot = typeof tr.r?.k === 'number' ? tr.r.k : 0;
    const sx = typeof tr.s?.k?.[0] === 'number' ? tr.s.k[0] / 100 : 1;
    const sy = typeof tr.s?.k?.[1] === 'number' ? tr.s.k[1] / 100 : 1;
    const op = typeof tr.o?.k === 'number' ? tr.o.k / 100 : 1;

    ctx.globalAlpha = Math.max(0, Math.min(1, op));
    ctx.translate(px, py);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(sx, sy);

    // Shapes inside layer
    for (const shapeGroup of layer.shapes || []) {
      for (const item of shapeGroup.it || [shapeGroup]) {
        if (item.ty === 'rc' && item.s?.k) {
          // Rectangle
          const rw = item.s.k[0];
          const rh = item.s.k[1];
          ctx.beginPath();
          ctx.rect(-rw / 2, -rh / 2, rw, rh);
        } else if (item.ty === 'el' && item.s?.k) {
          // Ellipse
          const rw = item.s.k[0] / 2;
          const rh = item.s.k[1] / 2;
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.max(1, rw), Math.max(1, rh), 0, 0, Math.PI * 2);
        } else if (item.ty === 'fl' && item.c?.k) {
          // Fill
          const r = Math.round(item.c.k[0] * 255);
          const g = Math.round(item.c.k[1] * 255);
          const b = Math.round(item.c.k[2] * 255);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fill();
        } else if (item.ty === 'st' && item.c?.k) {
          // Stroke
          const r = Math.round(item.c.k[0] * 255);
          const g = Math.round(item.c.k[1] * 255);
          const b = Math.round(item.c.k[2] * 255);
          ctx.strokeStyle = `rgb(${r},${g},${b})`;
          ctx.lineWidth = item.w?.k || 2;
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  ctx.restore();
  return canvas;
}
