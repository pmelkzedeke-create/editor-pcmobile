/**
 * Fluxo óptico + interpolação de quadros para conversão de fps
 * (ex.: clipe de 15 fps renderizado a 60/120 fps fica suave, sem travar)
 * e suporte a motion blur por amostragem temporal na exportação.
 */
import { checkAborted } from './previewCache';

export interface GrayFrame {
  width: number;
  height: number;
  data: Float32Array;
}

export interface FlowField {
  blocksX: number;
  blocksY: number;
  blockSize: number;
  dx: Float32Array;
  dy: Float32Array;
}

const grayCache = new WeakMap<HTMLCanvasElement, GrayFrame>();

export function canvasToGray(canvas: HTMLCanvasElement, maxW = 192): GrayFrame {
  const cached = grayCache.get(canvas);
  if (cached) return cached;
  const scale = Math.min(1, maxW / canvas.width);
  const w = Math.max(16, Math.round(canvas.width * scale));
  const h = Math.max(16, Math.round(canvas.height * scale));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  const frame = { width: w, height: h, data: gray };
  grayCache.set(canvas, frame);
  return frame;
}

/**
 * Fluxo óptico por blocos (block matching com janela de busca + predição
 * do fluxo vizinho). Barato o suficiente para rodar por quadro na exportação.
 */
export function computeOpticalFlow(a: GrayFrame, b: GrayFrame, blockSize = 24, search = 10): FlowField {
  const blocksX = Math.max(1, Math.floor(a.width / blockSize));
  const blocksY = Math.max(1, Math.floor(a.height / blockSize));
  const dx = new Float32Array(blocksX * blocksY);
  const dy = new Float32Array(blocksX * blocksY);
  const step = 2; // amostra pixels do patch a cada 2 px
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const idx = by * blocksX + bx;
      const cx = Math.min(a.width - blockSize, bx * blockSize);
      const cy = Math.min(a.height - blockSize, by * blockSize);
      // patch de referência em A
      let mean = 0;
      let count = 0;
      for (let y = 0; y < blockSize; y += step) {
        for (let x = 0; x < blockSize; x += step) {
          mean += a.data[(cy + y) * a.width + cx + x];
          count++;
        }
      }
      mean /= count;
      let variance = 0;
      for (let y = 0; y < blockSize; y += step) {
        for (let x = 0; x < blockSize; x += step) {
          const v = a.data[(cy + y) * a.width + cx + x] - mean;
          variance += v * v;
        }
      }
      if (variance / count < 12) continue; // bloco sem textura: fluxo zero
      // predição: fluxo do bloco à esquerda/acima (suaviza o campo)
      const predX = bx > 0 ? dx[idx - 1] : 0;
      const predY = by > 0 ? dy[idx - blocksX] : 0;
      let best = -2;
      let bestX = predX;
      let bestY = predY;
      const x0 = Math.max(0, Math.round(cx + predX) - search);
      const x1 = Math.min(a.width - blockSize, Math.round(cx + predX) + search);
      const y0 = Math.max(0, Math.round(cy + predY) - search);
      const y1 = Math.min(a.height - blockSize, Math.round(cy + predY) + search);
      for (let oy = y0; oy <= y1; oy++) {
        for (let ox = x0; ox <= x1; ox++) {
          let corr = 0;
          let sumB = 0;
          let sumB2 = 0;
          let k = 0;
          for (let y = 0; y < blockSize; y += step) {
            let rowA = (cy + y) * a.width + cx;
            let rowB = (oy + y) * b.width + ox;
            for (let x = 0; x < blockSize; x += step) {
              const pa = a.data[rowA + x] - mean;
              const pb = b.data[rowB + x];
              corr += pa * pb;
              sumB += pb;
              sumB2 += pb * pb;
              k++;
            }
          }
          const norm = Math.sqrt(variance * Math.max(0, sumB2 - (sumB * sumB) / k));
          const score = norm < 1e-6 ? -1 : corr / norm;
          if (score > best) {
            best = score;
            bestX = ox - cx;
            bestY = oy - cy;
          }
        }
      }
      if (best > 0.55) {
        dx[idx] = bestX;
        dy[idx] = bestY;
      }
    }
  }
  return { blocksX, blocksY, blockSize, dx, dy };
}

/**
 * Mistura dois quadros com warp guiado por fluxo óptico:
 * resultado = (1-t)·warp(A, +f·t) ⊕ t·warp(B, −f·(1−t))
 * Blocos sem fluxo usam crossfade direto (fallback suave).
 */
export function warpBlend(
  target: CanvasRenderingContext2D,
  frameA: HTMLCanvasElement,
  frameB: HTMLCanvasElement,
  flow: FlowField,
  t: number,
  width: number,
  height: number
) {
  const clamped = Math.max(0, Math.min(1, t));
  target.clearRect(0, 0, width, height);
  target.drawImage(frameA, 0, 0, width, height);
  const scale = width / frameA.width;
  target.save();
  for (let by = 0; by < flow.blocksY; by++) {
    for (let bx = 0; bx < flow.blocksX; bx++) {
      const idx = by * flow.blocksX + bx;
      const fdx = flow.dx[idx];
      const fdy = flow.dy[idx];
      if (fdx === 0 && fdy === 0) continue;
      const sx = bx * flow.blockSize;
      const sy = by * flow.blockSize;
      const sw = Math.min(flow.blockSize, frameA.width - sx);
      const sh = Math.min(flow.blockSize, frameA.height - sy);
      const dxp = sx * scale;
      const dyp = sy * scale;
      const dw = sw * scale;
      const dh = sh * scale;
      // warp de A na direção de B
      target.drawImage(
        frameA,
        sx - fdx * clamped, sy - fdy * clamped, sw, sh,
        dxp, dyp, dw, dh
      );
    }
  }
  target.globalAlpha = clamped;
  for (let by = 0; by < flow.blocksY; by++) {
    for (let bx = 0; bx < flow.blocksX; bx++) {
      const idx = by * flow.blocksX + bx;
      const fdx = flow.dx[idx];
      const fdy = flow.dy[idx];
      const sx = bx * flow.blockSize;
      const sy = by * flow.blockSize;
      const sw = Math.min(flow.blockSize, frameB.width - sx);
      const sh = Math.min(flow.blockSize, frameB.height - sy);
      if (fdx === 0 && fdy === 0) {
        target.drawImage(frameB, sx, sy, sw, sh, sx * scale, sy * scale, sw * scale, sh * scale);
      } else {
        target.drawImage(
          frameB,
          sx + fdx * (1 - clamped), sy + fdy * (1 - clamped), sw, sh,
          sx * scale, sy * scale, sw * scale, sh * scale
        );
      }
    }
  }
  target.globalAlpha = 1;
  target.restore();
}

/** Crossfade simples (fallback sem fluxo). */
export function blendFrames(
  target: CanvasRenderingContext2D,
  frameA: HTMLCanvasElement,
  frameB: HTMLCanvasElement,
  t: number,
  width: number,
  height: number
) {
  target.clearRect(0, 0, width, height);
  target.drawImage(frameA, 0, 0, width, height);
  target.globalAlpha = Math.max(0, Math.min(1, t));
  target.drawImage(frameB, 0, 0, width, height);
  target.globalAlpha = 1;
}

/** FPS de origem estimado por sondagem de seeks (snapped a valores comuns). */
const COMMON_FPS = [15, 20, 24, 25, 30, 48, 50, 60];

export async function estimateSourceFps(
  video: HTMLVideoElement,
  probe: (time: number) => Promise<string>,
  signal?: AbortSignal
): Promise<number> {
  const duration = Number.isFinite(video.duration) ? video.duration : 1;
  const base = Math.min(0.5, duration / 4);
  await probe(base);
  const baseHash = await probe(base);
  for (const fps of COMMON_FPS) {
    const next = base + 1 / fps;
    if (next >= duration - 0.01) break;
    const hash = await probe(next);
    checkAborted(signal);
    if (hash !== baseHash) return fps;
  }
  return 30;
}

/** Snapshot de um vídeo em um tempo dado, desenhado num canvas reutilizável. */
export class FrameGrabber {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(2, Math.round(width));
    this.canvas.height = Math.max(2, Math.round(height));
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }
  get element() {
    return this.canvas;
  }
  grab(source: CanvasImageSource, w: number, h: number) {
    this.ctx.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
    void w;
    void h;
  }
}

/**
 * Interpolador por clipe: mantém cache dos quadros-fonte vizinhos e devolve
 * um canvas suave para qualquer tempo de origem (com fluxo óptico ou blend).
 */
export class ClipFrameInterpolator {
  private grabA: FrameGrabber;
  private grabB: FrameGrabber;
  private out: FrameGrabber;
  private cacheIndex = -1;
  private flow: FlowField | null = null;
  sourceFps = 30;

  constructor(
    private video: HTMLVideoElement,
    private seek: (time: number, signal?: AbortSignal) => Promise<void>,
    width: number,
    height: number,
    private useFlow: boolean
  ) {
    this.grabA = new FrameGrabber(width, height);
    this.grabB = new FrameGrabber(width, height);
    this.out = new FrameGrabber(width, height);
  }

  async hashAt(time: number, signal?: AbortSignal): Promise<string> {
    await this.seek(time, signal);
    this.out.grab(this.video, 0, 0);
    const gray = canvasToGray(this.out.element, 64);
    // hash barato: amostra espaçada da luminância
    let hash = '';
    for (let i = 0; i < gray.data.length; i += Math.max(1, Math.floor(gray.data.length / 32))) {
      hash += gray.data[i] > 128 ? '1' : '0';
    }
    return hash;
  }

  async estimateSourceFps(signal?: AbortSignal) {
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : 1;
    const base = Math.min(0.5, duration / 4);
    const baseHash = await this.hashAt(base, signal);
    for (const fps of COMMON_FPS) {
      const next = base + 1 / fps;
      if (next >= duration - 0.01) break;
      const hash = await this.hashAt(next, signal);
      checkAborted(signal);
      if (hash !== baseHash) {
        this.sourceFps = fps;
        return fps;
      }
    }
    this.sourceFps = 30;
    return 30;
  }

  /** Devolve canvas com o quadro suave para o tempo de origem `time`. */
  async frameAt(time: number, signal?: AbortSignal): Promise<HTMLCanvasElement> {
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : 1;
    const maxIndex = Math.max(0, Math.floor(duration * this.sourceFps - 0.01));
    const index = Math.max(0, Math.min(maxIndex, Math.floor(time * this.sourceFps + 1e-4)));
    const fraction = Math.max(0, Math.min(1, time * this.sourceFps - index));
    const tA = index / this.sourceFps;
    const tB = Math.min(duration - 0.001, (index + 1) / this.sourceFps);
    if (fraction < 0.02 || tB - tA < 1e-4) {
      await this.seek(tA, signal);
      this.out.grab(this.video, 0, 0);
      return this.out.element;
    }
    await this.seek(tA, signal);
    this.grabA.grab(this.video, 0, 0);
    await this.seek(tB, signal);
    this.grabB.grab(this.video, 0, 0);
    if (this.useFlow && this.cacheIndex !== index) {
      this.flow = computeOpticalFlow(
        canvasToGray(this.grabA.element),
        canvasToGray(this.grabB.element)
      );
      this.cacheIndex = index;
    }
    const ctx = this.out.element.getContext('2d')!;
    if (this.useFlow && this.flow) {
      warpBlend(ctx, this.grabA.element, this.grabB.element, this.flow, fraction, this.out.element.width, this.out.element.height);
    } else {
      blendFrames(ctx, this.grabA.element, this.grabB.element, fraction, this.out.element.width, this.out.element.height);
    }
    return this.out.element;
  }
}
