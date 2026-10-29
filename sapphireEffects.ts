import type { ClipEffect } from '../types/editor';
import { evaluatePropertyTrack } from '../core/keyframes';
import { evaluateSafeExpression } from '../core/expressions';
import { renderTimeSliceEffect, type TimeSliceParams } from './timeSlice';

export interface EffectParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
}

export interface EffectRenderContext {
  sampleSourceFrame?: (relTime: number) => CanvasImageSource | null;
  originalSource?: CanvasImageSource;
  currentTime?: number;
  fps?: number;
  duration?: number;
  audioLevel?: number;
}

export interface EffectDefinition {
  type: string;
  label: string;
  category:
    | 'Luz'
    | 'Desfoque'
    | 'Film'
    | 'Danos'
    | 'Distorção'
    | 'Estilizar'
    | 'Cor'
    | 'Keying'
    | 'Tempo / Slice';
  description: string;
  gradient: string;
  params: EffectParam[];
  render: (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    p: Record<string, number>,
    time: number,
    seed: number,
    extra?: EffectRenderContext
  ) => void;
}

const scratches = new Map<string, HTMLCanvasElement>();
function scratch(key: string, w: number, h: number) {
  let canvas = scratches.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    scratches.set(key, canvas);
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const context = canvas.getContext('2d')!;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
  context.imageSmoothingEnabled = true;
  context.clearRect(0, 0, w, h);
  return { canvas, context };
}

// Deterministic noise keeps preview and export frames byte-identical.
function random(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

const base = (w: number, h: number) => Math.max(w, h) / 1280;

function highlightPass(source: CanvasImageSource, w: number, h: number, threshold: number, blur: number) {
  const scale = Math.max(0.25, Math.min(1, 520 / Math.max(w, h)));
  const lw = Math.max(2, Math.round(w * scale));
  const lh = Math.max(2, Math.round(h * scale));
  const pass = scratch('highlights', lw, lh);
  const cut = Math.max(0.25, 1 - threshold / 130);
  pass.context.filter = `brightness(${(1 / cut).toFixed(2)}) contrast(${160 + threshold}%) saturate(118%)`;
  pass.context.drawImage(source, 0, 0, lw, lh);
  if (blur > 0) {
    const blurred = scratch('highlights-blur', lw, lh);
    blurred.context.filter = `blur(${Math.max(0.4, blur * scale).toFixed(2)}px)`;
    blurred.context.drawImage(pass.canvas, 0, 0);
    return blurred.canvas;
  }
  return pass.canvas;
}

function copyOf(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const copy = scratch('layer-copy', w, h);
  copy.context.drawImage(ctx.canvas, 0, 0);
  return copy.canvas;
}

/** Keeps generated overlays inside the layer silhouette so effects never leak onto other layers. */
function clipToLayer(ctx: CanvasRenderingContext2D, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const mask = scratch('fx-mask', w, h);
  draw(mask.context);
  mask.context.globalCompositeOperation = 'destination-in';
  mask.context.filter = 'none';
  mask.context.globalAlpha = 1;
  mask.context.drawImage(ctx.canvas, 0, 0);
  return mask.canvas;
}

function grainOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, size: number, time: number, seed: number) {
  const cell = Math.max(1, Math.round(size * base(w, h) * 1.4));
  const tileW = Math.max(8, Math.round(w / cell));
  const tileH = Math.max(8, Math.round(h / cell));
  const tile = scratch('grain', tileW, tileH);
  const image = tile.context.createImageData(tileW, tileH);
  const frame = Math.floor(time * 24);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = random(frame * 1.7 + seed + i * 0.37) * 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  tile.context.putImageData(image, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(0.85, amount / 100);
  ctx.imageSmoothingEnabled = cell > 1;
  ctx.drawImage(tile.canvas, 0, 0, w, h);
  ctx.restore();
}

function channelSplit(ctx: CanvasRenderingContext2D, w: number, h: number, distance: number, angle: number) {
  if (distance < 0.2) return;
  const copy = copyOf(ctx, w, h);
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians) * distance;
  const dy = Math.sin(radians) * distance;
  const red = scratch('split-red', w, h);
  red.context.drawImage(copy, dx, dy);
  red.context.globalCompositeOperation = 'multiply';
  red.context.fillStyle = '#ff0000';
  red.context.fillRect(0, 0, w, h);
  const blue = scratch('split-blue', w, h);
  blue.context.drawImage(copy, -dx, -dy);
  blue.context.globalCompositeOperation = 'multiply';
  blue.context.fillStyle = '#00ffff';
  blue.context.fillRect(0, 0, w, h);
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(copy, 0, 0);
  ctx.globalCompositeOperation = 'lighten';
  ctx.drawImage(red.canvas, 0, 0);
  ctx.drawImage(blue.canvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(copy, 0, 0);
  ctx.restore();
}

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  {
    type: 'S_ForceMotionBlur',
    label: 'CC Force Motion Blur',
    category: 'Desfoque',
    gradient: 'from-sky-300 via-blue-500 to-indigo-700',
    description:
      'Motion blur real por amostragem temporal (estilo After Effects). Amostra o próprio clipe em tempos vizinhos dentro do ângulo do obturador e acumula com pesos — funciona em movimento de camada e de vídeo.',
    params: [
      { key: 'shutterAngle', label: 'Shutter Angle', min: 0, max: 720, step: 1, def: 180, unit: '°' },
      { key: 'samples', label: 'Motion Samples', min: 2, max: 32, step: 1, def: 12 },
      { key: 'exposure', label: 'Exposure (peso central)', min: 10, max: 300, step: 1, def: 100, unit: '%' },
      { key: 'direction', label: 'Direção (0=Ambos, 1=Centro)', min: 0, max: 1, step: 1, def: 0 },
    ],
    render: (ctx, w, h, p, _time, _seed, extra) => {
      const samples = Math.max(2, Math.round(p.samples));
      const fps = extra?.fps || 30;
      const shutterSec = (p.shutterAngle / 360) / Math.max(1, fps);
      const sampleFrame = extra?.sampleSourceFrame;
      if (!sampleFrame) return;
      const copy = copyOf(ctx, w, h);
      ctx.clearRect(0, 0, w, h);
      // Acumula amostras temporais do clipe/camada (composição aditiva ponderada)
      let totalWeight = 0;
      const weights: number[] = [];
      for (let s = 0; s < samples; s++) {
        const u = samples === 1 ? 0 : s / (samples - 1) - 0.5; // -0.5..0.5
        const weight = Math.cos(u * Math.PI * 0.9);
        weights.push(Math.max(0.02, weight));
        totalWeight += Math.max(0.02, weight);
      }
      const exposureScale = p.exposure / 100;
      for (let s = 0; s < samples; s++) {
        const u = samples === 1 ? 0 : s / (samples - 1) - 0.5;
        const offset = u * shutterSec * (p.direction >= 0.5 ? 0.5 : 1);
        const frame = sampleFrame(offset);
        const weight = (weights[s] / totalWeight) * exposureScale;
        if (!frame) continue;
        ctx.globalAlpha = Math.min(1, weight);
        ctx.drawImage(frame, 0, 0, w, h);
      }
      ctx.globalAlpha = 1;
      void copy;
    },
  },
  {
    type: 'S_Glow',
    label: 'S_Glow',
    category: 'Luz',
    gradient: 'from-amber-300 via-orange-400 to-rose-500',
    description: 'Brilho difuso a partir das altas luzes.',
    params: [
      { key: 'brightness', label: 'Intensidade', min: 0, max: 200, step: 1, def: 85, unit: '%' },
      { key: 'size', label: 'Raio', min: 1, max: 120, step: 1, def: 38, unit: 'px' },
      { key: 'threshold', label: 'Limiar', min: 0, max: 100, step: 1, def: 52, unit: '%' },
      { key: 'warmth', label: 'Calor', min: -100, max: 100, step: 1, def: 18 },
    ],
    render: (ctx, w, h, p) => {
      const glow = highlightPass(ctx.canvas, w, h, p.threshold, p.size * base(w, h));
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, p.brightness / 100);
      if (p.warmth) ctx.filter = `hue-rotate(${-p.warmth * 0.18}deg) saturate(${100 + Math.abs(p.warmth) * 0.5}%)`;
      ctx.drawImage(glow, 0, 0, w, h);
    },
  },
  {
    type: 'S_Rays',
    label: 'S_Rays',
    category: 'Luz',
    gradient: 'from-yellow-200 via-amber-400 to-amber-700',
    description: 'Raios volumétricos irradiando das áreas claras.',
    params: [
      { key: 'brightness', label: 'Intensidade', min: 0, max: 200, step: 1, def: 90, unit: '%' },
      { key: 'length', label: 'Comprimento', min: 5, max: 100, step: 1, def: 48, unit: '%' },
      { key: 'centerX', label: 'Centro X', min: 0, max: 100, step: 1, def: 50, unit: '%' },
      { key: 'centerY', label: 'Centro Y', min: 0, max: 100, step: 1, def: 32, unit: '%' },
      { key: 'threshold', label: 'Limiar', min: 0, max: 100, step: 1, def: 62, unit: '%' },
    ],
    render: (ctx, w, h, p) => {
      const source = highlightPass(ctx.canvas, w, h, p.threshold, 2 * base(w, h));
      const cx = (p.centerX / 100) * w;
      const cy = (p.centerY / 100) * h;
      const rays = scratch('rays', w, h);
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const scale = 1 + (p.length / 100) * (i / steps);
        rays.context.globalAlpha = (1 - i / steps) / 5;
        rays.context.drawImage(source, cx - cx * scale, cy - cy * scale, w * scale, h * scale);
      }
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, p.brightness / 100);
      ctx.drawImage(rays.canvas, 0, 0);
    },
  },
  {
    type: 'S_LensFlare',
    label: 'S_LensFlare',
    category: 'Luz',
    gradient: 'from-sky-300 via-indigo-400 to-fuchsia-500',
    description: 'Flare anamórfico com núcleo, halos e estrias.',
    params: [
      { key: 'brightness', label: 'Intensidade', min: 0, max: 200, step: 1, def: 100, unit: '%' },
      { key: 'posX', label: 'Posição X', min: 0, max: 100, step: 1, def: 72, unit: '%' },
      { key: 'posY', label: 'Posição Y', min: 0, max: 100, step: 1, def: 28, unit: '%' },
      { key: 'size', label: 'Tamanho', min: 10, max: 200, step: 1, def: 90, unit: '%' },
      { key: 'hue', label: 'Matiz', min: 0, max: 360, step: 1, def: 205 },
      { key: 'streak', label: 'Estria', min: 0, max: 200, step: 1, def: 120, unit: '%' },
    ],
    render: (ctx, w, h, p, time) => {
      const x = (p.posX / 100) * w;
      const y = (p.posY / 100) * h;
      const radius = (p.size / 100) * Math.max(w, h) * 0.22;
      const pulse = 0.88 + 0.12 * Math.sin(time * 3.1);
      const flare = scratch('flare', w, h);
      const c = flare.context;
      const core = c.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
      core.addColorStop(0, `hsla(${p.hue}, 100%, 96%, ${0.95 * pulse})`);
      core.addColorStop(0.25, `hsla(${p.hue}, 95%, 72%, ${0.42 * pulse})`);
      core.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      c.fillStyle = core;
      c.fillRect(0, 0, w, h);
      if (p.streak > 0) {
        const half = (p.streak / 100) * w * 0.55;
        const streak = c.createLinearGradient(x - half, y, x + half, y);
        streak.addColorStop(0, 'hsla(0,0%,0%,0)');
        streak.addColorStop(0.5, `hsla(${p.hue}, 100%, 78%, ${0.55 * pulse})`);
        streak.addColorStop(1, 'hsla(0,0%,0%,0)');
        c.fillStyle = streak;
        c.fillRect(x - half, y - radius * 0.06, half * 2, Math.max(2, radius * 0.12));
      }
      for (let i = 1; i <= 5; i++) {
        const t = i / 5;
        const gx = x + (w / 2 - x) * t * 2;
        const gy = y + (h / 2 - y) * t * 2;
        const gr = Math.max(2, radius * (0.12 + 0.2 * random(i + p.hue)));
        const ghost = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
        ghost.addColorStop(0, `hsla(${(p.hue + i * 42) % 360}, 90%, 70%, ${0.2 * pulse})`);
        ghost.addColorStop(1, 'hsla(0,0%,0%,0)');
        c.fillStyle = ghost;
        c.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      }
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, p.brightness / 100);
      ctx.drawImage(flare.canvas, 0, 0);
    },
  },
  {
    type: 'S_Glint',
    label: 'S_Glint',
    category: 'Luz',
    gradient: 'from-white via-sky-200 to-indigo-400',
    description: 'Estrelas de difração nos pontos de luz.',
    params: [
      { key: 'brightness', label: 'Intensidade', min: 0, max: 200, step: 1, def: 80, unit: '%' },
      { key: 'length', label: 'Comprimento', min: 2, max: 60, step: 1, def: 22, unit: '%' },
      { key: 'points', label: 'Pontas', min: 2, max: 8, step: 1, def: 4 },
      { key: 'threshold', label: 'Limiar', min: 0, max: 100, step: 1, def: 72, unit: '%' },
      { key: 'rotation', label: 'Rotação', min: 0, max: 180, step: 1, def: 0, unit: '°' },
    ],
    render: (ctx, w, h, p) => {
      const source = highlightPass(ctx.canvas, w, h, p.threshold, 1);
      const star = scratch('glint', w, h);
      const reach = (p.length / 100) * Math.max(w, h) * 0.5;
      const points = Math.max(2, Math.round(p.points));
      for (let i = 0; i < points; i++) {
        const angle = (Math.PI / points) * i + (p.rotation * Math.PI) / 180;
        for (let step = 1; step <= 10; step++) {
          const distance = (reach * step) / 10;
          star.context.globalAlpha = (1 - step / 11) / 6;
          star.context.drawImage(source, Math.cos(angle) * distance, Math.sin(angle) * distance, w, h);
          star.context.drawImage(source, -Math.cos(angle) * distance, -Math.sin(angle) * distance, w, h);
        }
      }
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, p.brightness / 100);
      ctx.drawImage(star.canvas, 0, 0);
    },
  },
  {
    type: 'S_LightLeak',
    label: 'S_LightLeak',
    category: 'Luz',
    gradient: 'from-orange-400 via-rose-500 to-purple-600',
    description: 'Vazamentos de luz orgânicos em movimento.',
    params: [
      { key: 'brightness', label: 'Intensidade', min: 0, max: 150, step: 1, def: 55, unit: '%' },
      { key: 'hue', label: 'Matiz', min: 0, max: 360, step: 1, def: 24 },
      { key: 'speed', label: 'Velocidade', min: 0, max: 200, step: 1, def: 60, unit: '%' },
      { key: 'softness', label: 'Suavidade', min: 0, max: 100, step: 1, def: 70, unit: '%' },
    ],
    render: (ctx, w, h, p, time, seed) => {
      const phase = time * (p.speed / 100);
      const leak = clipToLayer(ctx, w, h, (c) => {
        for (let i = 0; i < 3; i++) {
          const offset = random(seed + i * 17);
          const x = w * (0.1 + 0.8 * (0.5 + 0.5 * Math.sin(phase * (0.5 + offset) + i * 2)));
          const y = h * (0.2 + 0.6 * offset);
          const radius = Math.max(w, h) * (0.25 + 0.2 * offset);
          const gradient = c.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, `hsla(${(p.hue + i * 28) % 360}, 95%, 65%, 0.75)`);
          gradient.addColorStop(1, 'hsla(0,0%,0%,0)');
          c.fillStyle = gradient;
          c.fillRect(0, 0, w, h);
        }
        c.filter = `blur(${(p.softness / 100) * 40 * base(w, h)}px)`;
        c.drawImage(c.canvas, 0, 0);
        c.filter = 'none';
      });
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, p.brightness / 100);
      ctx.drawImage(leak, 0, 0);
    },
  },
  {
    type: 'S_Blur',
    label: 'S_Blur',
    category: 'Desfoque',
    gradient: 'from-slate-300 via-slate-500 to-slate-700',
    description: 'Desfoque gaussiano de alta qualidade.',
    params: [{ key: 'amount', label: 'Quantidade', min: 0, max: 60, step: 0.5, def: 8, unit: 'px' }],
    render: (ctx, w, h, p) => {
      const copy = copyOf(ctx, w, h);
      ctx.clearRect(0, 0, w, h);
      ctx.filter = `blur(${p.amount * base(w, h)}px)`;
      ctx.drawImage(copy, 0, 0);
    },
  },
  {
    type: 'S_BlurMotion',
    label: 'S_BlurMotion',
    category: 'Desfoque',
    gradient: 'from-cyan-200 via-sky-500 to-blue-700',
    description: 'Desfoque direcional de movimento.',
    params: [
      { key: 'amount', label: 'Quantidade', min: 0, max: 80, step: 1, def: 24, unit: 'px' },
      { key: 'angle', label: 'Ângulo', min: 0, max: 360, step: 1, def: 0, unit: '°' },
    ],
    render: (ctx, w, h, p) => {
      const copy = copyOf(ctx, w, h);
      const radians = (p.angle * Math.PI) / 180;
      const distance = p.amount * base(w, h);
      ctx.clearRect(0, 0, w, h);
      for (let i = -6; i <= 6; i++) {
        ctx.globalAlpha = 1 / 13;
        ctx.drawImage(copy, (Math.cos(radians) * distance * i) / 6, (Math.sin(radians) * distance * i) / 6);
      }
    },
  },
  {
    type: 'S_ZDefocus',
    label: 'S_ZDefocus',
    category: 'Desfoque',
    gradient: 'from-emerald-200 via-teal-500 to-slate-800',
    description: 'Desfoque de lente com realce de bokeh.',
    params: [
      { key: 'amount', label: 'Desfoque', min: 0, max: 50, step: 0.5, def: 14, unit: 'px' },
      { key: 'bokeh', label: 'Bokeh', min: 0, max: 150, step: 1, def: 70, unit: '%' },
      { key: 'threshold', label: 'Limiar', min: 0, max: 100, step: 1, def: 65, unit: '%' },
    ],
    render: (ctx, w, h, p) => {
      const copy = copyOf(ctx, w, h);
      const highlights = highlightPass(copy, w, h, p.threshold, p.amount * 1.6 * base(w, h));
      ctx.clearRect(0, 0, w, h);
      ctx.filter = `blur(${p.amount * base(w, h)}px)`;
      ctx.drawImage(copy, 0, 0);
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, p.bokeh / 100);
      ctx.drawImage(highlights, 0, 0, w, h);
    },
  },
  {
    type: 'S_FilmEffect',
    label: 'S_FilmEffect',
    category: 'Film',
    gradient: 'from-amber-700 via-orange-500 to-yellow-200',
    description: 'Emulação de filme com halação, grão e curva quente.',
    params: [
      { key: 'halation', label: 'Halação', min: 0, max: 150, step: 1, def: 55, unit: '%' },
      { key: 'grain', label: 'Grão', min: 0, max: 100, step: 1, def: 26, unit: '%' },
      { key: 'warmth', label: 'Calor', min: -100, max: 100, step: 1, def: 32 },
      { key: 'softness', label: 'Suavidade', min: 0, max: 100, step: 1, def: 18, unit: '%' },
    ],
    render: (ctx, w, h, p, time, seed) => {
      if (p.softness > 0) {
        const copy = copyOf(ctx, w, h);
        ctx.save();
        ctx.globalAlpha = p.softness / 160;
        ctx.filter = `blur(${(p.softness / 100) * 9 * base(w, h)}px)`;
        ctx.drawImage(copy, 0, 0);
        ctx.restore();
      }
      if (p.halation > 0) {
        const glow = highlightPass(ctx.canvas, w, h, 58, 26 * base(w, h));
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = Math.min(1, p.halation / 150);
        ctx.filter = 'hue-rotate(-12deg) saturate(150%)';
        ctx.drawImage(glow, 0, 0, w, h);
        ctx.restore();
      }
      if (p.warmth) {
        const tint = clipToLayer(ctx, w, h, (c) => {
          c.fillStyle = p.warmth > 0 ? '#ff9a3c' : '#49b8ff';
          c.fillRect(0, 0, w, h);
        });
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        ctx.globalAlpha = Math.min(0.6, Math.abs(p.warmth) / 150);
        ctx.drawImage(tint, 0, 0);
        ctx.restore();
      }
      if (p.grain > 0) grainOverlay(ctx, w, h, p.grain, 1, time, seed);
    },
  },
  {
    type: 'S_Grain',
    label: 'S_Grain',
    category: 'Film',
    gradient: 'from-zinc-400 via-zinc-600 to-zinc-900',
    description: 'Grão de película animado.',
    params: [
      { key: 'amount', label: 'Quantidade', min: 0, max: 100, step: 1, def: 35, unit: '%' },
      { key: 'size', label: 'Tamanho', min: 1, max: 6, step: 0.5, def: 1.5, unit: 'px' },
    ],
    render: (ctx, w, h, p, time, seed) => grainOverlay(ctx, w, h, p.amount, p.size, time, seed),
  },
  {
    type: 'S_Vignette',
    label: 'S_Vignette',
    category: 'Film',
    gradient: 'from-zinc-900 via-zinc-700 to-zinc-500',
    description: 'Vinheta óptica com bordas suaves.',
    params: [
      { key: 'amount', label: 'Intensidade', min: 0, max: 100, step: 1, def: 45, unit: '%' },
      { key: 'size', label: 'Abertura', min: 10, max: 100, step: 1, def: 62, unit: '%' },
      { key: 'softness', label: 'Suavidade', min: 0, max: 100, step: 1, def: 65, unit: '%' },
    ],
    render: (ctx, w, h, p) => {
      const outer = Math.max(w, h) * 0.78;
      const vignette = clipToLayer(ctx, w, h, (c) => {
        const gradient = c.createRadialGradient(
          w / 2,
          h / 2,
          outer * (p.size / 100) * (p.softness / 100),
          w / 2,
          h / 2,
          outer
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${p.amount / 100})`);
        c.fillStyle = gradient;
        c.fillRect(0, 0, w, h);
      });
      ctx.drawImage(vignette, 0, 0);
    },
  },
  {
    type: 'S_FilmDamage',
    label: 'S_FilmDamage',
    category: 'Danos',
    gradient: 'from-stone-200 via-stone-500 to-stone-800',
    description: 'Riscos, poeira, tremor e cintilação de projetor.',
    params: [
      { key: 'scratches', label: 'Riscos', min: 0, max: 100, step: 1, def: 45, unit: '%' },
      { key: 'dust', label: 'Poeira', min: 0, max: 100, step: 1, def: 40, unit: '%' },
      { key: 'flicker', label: 'Cintilação', min: 0, max: 100, step: 1, def: 30, unit: '%' },
      { key: 'jitter', label: 'Tremor', min: 0, max: 100, step: 1, def: 22, unit: '%' },
    ],
    render: (ctx, w, h, p, time, seed) => {
      const frame = Math.floor(time * 24);
      if (p.jitter > 0) {
        const copy = copyOf(ctx, w, h);
        const dx = (random(frame + seed) - 0.5) * (p.jitter / 100) * 14 * base(w, h);
        const dy = (random(frame + seed + 9) - 0.5) * (p.jitter / 100) * 10 * base(w, h);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(copy, dx, dy);
      }
      const overlay = clipToLayer(ctx, w, h, (c) => {
        for (let i = 0; i < Math.round(p.scratches / 12); i++) {
          const r = random(frame * 3 + i + seed);
          if (r < 0.35) continue;
          c.strokeStyle = `rgba(255,255,255,${0.1 + r * 0.25})`;
          c.lineWidth = Math.max(1, base(w, h) * (0.5 + r));
          c.beginPath();
          c.moveTo(r * w, 0);
          c.lineTo(r * w + (random(frame + i) - 0.5) * 30, h);
          c.stroke();
        }
        for (let i = 0; i < Math.round(p.dust / 3); i++) {
          const r = random(frame * 7 + i * 13 + seed);
          const size = (0.4 + r * 2.2) * base(w, h) * 1.6;
          c.fillStyle = r > 0.5 ? 'rgba(20,16,12,0.5)' : 'rgba(255,255,250,0.42)';
          c.beginPath();
          c.arc(random(frame + i * 3) * w, r * h, size, 0, Math.PI * 2);
          c.fill();
        }
      });
      ctx.drawImage(overlay, 0, 0);
      if (p.flicker > 0) {
        const amount = (random(frame + seed + 31) - 0.5) * (p.flicker / 100) * 0.3;
        const flash = clipToLayer(ctx, w, h, (c) => {
          c.fillStyle = amount > 0 ? '#fff6e5' : '#1a1410';
          c.fillRect(0, 0, w, h);
        });
        ctx.save();
        ctx.globalCompositeOperation = amount > 0 ? 'screen' : 'multiply';
        ctx.globalAlpha = Math.min(0.5, Math.abs(amount));
        ctx.drawImage(flash, 0, 0);
        ctx.restore();
      }
    },
  },
  {
    type: 'S_TVDamage',
    label: 'S_TVDamage',
    category: 'Danos',
    gradient: 'from-teal-300 via-cyan-600 to-slate-900',
    description: 'Scanlines, barra rolante e chuvisco de VHS.',
    params: [
      { key: 'scanlines', label: 'Scanlines', min: 0, max: 100, step: 1, def: 48, unit: '%' },
      { key: 'rollbar', label: 'Barra rolante', min: 0, max: 100, step: 1, def: 38, unit: '%' },
      { key: 'static', label: 'Chuvisco', min: 0, max: 100, step: 1, def: 26, unit: '%' },
      { key: 'warp', label: 'Deslocamento', min: 0, max: 100, step: 1, def: 30, unit: '%' },
    ],
    render: (ctx, w, h, p, time, seed) => {
      if (p.warp > 0) {
        const copy = copyOf(ctx, w, h);
        const bands = 22;
        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < bands; i++) {
          const y = (h / bands) * i;
          const jitter = (random(Math.floor(time * 12) + i + seed) - 0.5) * (p.warp / 100) * 26 * base(w, h);
          ctx.drawImage(copy, 0, y, w, h / bands + 1, jitter, y, w, h / bands + 1);
        }
      }
      const overlay = clipToLayer(ctx, w, h, (c) => {
        if (p.scanlines > 0) {
          c.fillStyle = `rgba(0,0,0,${(p.scanlines / 100) * 0.5})`;
          const line = Math.max(2, Math.round(3 * base(w, h)));
          for (let y = 0; y < h; y += line * 2) c.fillRect(0, y, w, line);
        }
        if (p.rollbar > 0) {
          const y = (((time * 0.35) % 1.4) - 0.2) * h;
          const height = h * 0.18;
          const gradient = c.createLinearGradient(0, y, 0, y + height);
          gradient.addColorStop(0, 'rgba(255,255,255,0)');
          gradient.addColorStop(0.5, `rgba(235,255,255,${(p.rollbar / 100) * 0.3})`);
          gradient.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = gradient;
          c.fillRect(0, y, w, height);
        }
      });
      ctx.drawImage(overlay, 0, 0);
      if (p.static > 0) grainOverlay(ctx, w, h, p.static, 2, time, seed + 5);
    },
  },
  {
    type: 'S_DigitalDamage',
    label: 'S_DigitalDamage',
    category: 'Danos',
    gradient: 'from-fuchsia-400 via-purple-600 to-slate-900',
    description: 'Glitch digital com blocos deslocados e separação RGB.',
    params: [
      { key: 'amount', label: 'Quantidade', min: 0, max: 100, step: 1, def: 45, unit: '%' },
      { key: 'blocks', label: 'Blocos', min: 1, max: 40, step: 1, def: 12 },
      { key: 'shift', label: 'Deslocamento', min: 0, max: 100, step: 1, def: 40, unit: '%' },
      { key: 'rgb', label: 'Separação RGB', min: 0, max: 60, step: 1, def: 14, unit: 'px' },
    ],
    render: (ctx, w, h, p, time, seed) => {
      const frame = Math.floor(time * 14);
      const copy = copyOf(ctx, w, h);
      for (let i = 0; i < Math.round(p.blocks); i++) {
        const chance = random(frame * 5 + i * 3 + seed);
        if (chance > p.amount / 100) continue;
        const bandHeight = (0.02 + random(frame + i) * 0.1) * h;
        const y = random(frame * 2 + i * 7 + seed) * h;
        const dx = (random(frame + i * 11) - 0.5) * (p.shift / 100) * w * 0.4;
        ctx.clearRect(0, y, w, bandHeight);
        ctx.drawImage(copy, 0, y, w, bandHeight, dx, y, w, bandHeight);
      }
      if (p.rgb > 0) channelSplit(ctx, w, h, p.rgb * base(w, h), 0);
    },
  },
  {
    type: 'S_WarpChroma',
    label: 'S_WarpChroma',
    category: 'Distorção',
    gradient: 'from-red-400 via-emerald-400 to-blue-500',
    description: 'Aberração cromática de lente.',
    params: [
      { key: 'amount', label: 'Quantidade', min: 0, max: 40, step: 0.5, def: 6, unit: 'px' },
      { key: 'angle', label: 'Ângulo', min: 0, max: 360, step: 1, def: 0, unit: '°' },
    ],
    render: (ctx, w, h, p) => channelSplit(ctx, w, h, p.amount * base(w, h), p.angle),
  },
  {
    type: 'S_WarpWave',
    label: 'S_WarpWave',
    category: 'Distorção',
    gradient: 'from-blue-300 via-indigo-500 to-violet-700',
    description: 'Ondulação orgânica animada.',
    params: [
      { key: 'amplitude', label: 'Amplitude', min: 0, max: 80, step: 1, def: 18, unit: 'px' },
      { key: 'frequency', label: 'Frequência', min: 1, max: 30, step: 1, def: 6 },
      { key: 'speed', label: 'Velocidade', min: 0, max: 200, step: 1, def: 80, unit: '%' },
    ],
    render: (ctx, w, h, p, time) => {
      const copy = copyOf(ctx, w, h);
      const amplitude = p.amplitude * base(w, h);
      ctx.clearRect(0, 0, w, h);
      const slice = Math.max(2, Math.round(2 * base(w, h)));
      for (let y = 0; y < h; y += slice) {
        const offset = Math.sin((y / h) * p.frequency * Math.PI * 2 + time * (p.speed / 50)) * amplitude;
        ctx.drawImage(copy, 0, y, w, slice, offset, y, w, slice);
      }
    },
  },
  {
    type: 'S_Shake',
    label: 'S_Shake',
    category: 'Distorção',
    gradient: 'from-rose-300 via-red-500 to-slate-900',
    description: 'Tremor de câmera com rotação e escala.',
    params: [
      { key: 'amount', label: 'Quantidade', min: 0, max: 100, step: 1, def: 35, unit: '%' },
      { key: 'frequency', label: 'Frequência', min: 1, max: 30, step: 1, def: 11 },
      { key: 'rotation', label: 'Rotação', min: 0, max: 100, step: 1, def: 25, unit: '%' },
    ],
    render: (ctx, w, h, p, time, seed) => {
      const copy = copyOf(ctx, w, h);
      const phase = time * p.frequency;
      const dx = (Math.sin(phase * 1.7 + seed) + Math.sin(phase * 3.1)) * (p.amount / 100) * 18 * base(w, h);
      const dy = (Math.cos(phase * 2.3 + seed) + Math.sin(phase * 1.3)) * (p.amount / 100) * 14 * base(w, h);
      const angle = Math.sin(phase * 1.9 + seed) * (p.rotation / 100) * 0.035;
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + dx, h / 2 + dy);
      ctx.rotate(angle);
      ctx.scale(1.08, 1.08);
      ctx.drawImage(copy, -w / 2, -h / 2);
    },
  },
  {
    type: 'S_Mosaic',
    label: 'S_Mosaic',
    category: 'Estilizar',
    gradient: 'from-lime-300 via-emerald-500 to-teal-700',
    description: 'Pixelização em blocos.',
    params: [{ key: 'size', label: 'Tamanho do bloco', min: 2, max: 80, step: 1, def: 16, unit: 'px' }],
    render: (ctx, w, h, p) => {
      const blocks = Math.max(2, Math.round(w / Math.max(1, p.size * base(w, h))));
      const small = scratch('mosaic', blocks, Math.max(2, Math.round(blocks * (h / w))));
      small.context.drawImage(ctx.canvas, 0, 0, small.canvas.width, small.canvas.height);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small.canvas, 0, 0, w, h);
    },
  },
  {
    type: 'S_Kaleido',
    label: 'S_Kaleido',
    category: 'Estilizar',
    gradient: 'from-pink-300 via-violet-500 to-indigo-700',
    description: 'Caleidoscópio espelhado radial.',
    params: [
      { key: 'segments', label: 'Segmentos', min: 2, max: 16, step: 1, def: 6 },
      { key: 'rotation', label: 'Rotação', min: 0, max: 360, step: 1, def: 0, unit: '°' },
      { key: 'zoom', label: 'Zoom', min: 50, max: 250, step: 1, def: 120, unit: '%' },
    ],
    render: (ctx, w, h, p) => {
      const copy = copyOf(ctx, w, h);
      const segments = Math.max(2, Math.round(p.segments));
      const radius = Math.max(w, h);
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < segments; i++) {
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate((Math.PI * 2 * i) / segments + (p.rotation * Math.PI) / 180);
        if (i % 2) ctx.scale(-1, 1);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, -Math.PI / segments, Math.PI / segments);
        ctx.closePath();
        ctx.clip();
        const zoom = p.zoom / 100;
        ctx.drawImage(copy, (-w / 2) * zoom, (-h / 2) * zoom, w * zoom, h * zoom);
        ctx.restore();
      }
    },
  },
  {
    type: 'S_Duotone',
    label: 'S_Duotone',
    category: 'Estilizar',
    gradient: 'from-indigo-500 via-pink-500 to-amber-300',
    description: 'Mapeamento de duas cores com contraste de cinema.',
    params: [
      { key: 'mix', label: 'Mistura', min: 0, max: 100, step: 1, def: 80, unit: '%' },
      { key: 'shadowHue', label: 'Matiz sombras', min: 0, max: 360, step: 1, def: 232 },
      { key: 'lightHue', label: 'Matiz luzes', min: 0, max: 360, step: 1, def: 32 },
      { key: 'contrast', label: 'Contraste', min: 50, max: 200, step: 1, def: 120, unit: '%' },
    ],
    render: (ctx, w, h, p) => {
      const copy = copyOf(ctx, w, h);
      const toned = scratch('duotone', w, h);
      toned.context.filter = `grayscale(100%) contrast(${p.contrast}%)`;
      toned.context.drawImage(copy, 0, 0);
      toned.context.filter = 'none';
      toned.context.globalCompositeOperation = 'multiply';
      toned.context.fillStyle = `hsl(${p.lightHue}, 85%, 62%)`;
      toned.context.fillRect(0, 0, w, h);
      toned.context.globalCompositeOperation = 'screen';
      toned.context.fillStyle = `hsl(${p.shadowHue}, 70%, 24%)`;
      toned.context.fillRect(0, 0, w, h);
      toned.context.globalCompositeOperation = 'destination-in';
      toned.context.drawImage(copy, 0, 0);
      ctx.globalAlpha = p.mix / 100;
      ctx.drawImage(toned.canvas, 0, 0);
    },
  },
  {
    type: 'C_Exposure',
    label: 'Exposure & Gamma',
    category: 'Cor',
    gradient: 'from-amber-200 via-zinc-400 to-zinc-800',
    description: 'Controle fotográfico de stops de exposição, gamma e offset.',
    params: [
      { key: 'exposure', label: 'Exposição (EV)', min: -3, max: 3, step: 0.1, def: 0.45 },
      { key: 'gamma', label: 'Gamma', min: 0.4, max: 2.4, step: 0.05, def: 1.05 },
      { key: 'offset', label: 'Offset', min: -50, max: 50, step: 1, def: 0 },
    ],
    render: (ctx, w, h, p) => {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const gain = Math.pow(2, p.exposure);
      const invGamma = 1 / Math.max(0.2, p.gamma);
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) {
        const norm = Math.max(0, (v / 255) * gain + p.offset / 255);
        lut[v] = Math.round(Math.pow(norm, invGamma) * 255);
      }
      for (let i = 0; i < d.length; i += 4) {
        d[i] = lut[d[i]];
        d[i + 1] = lut[d[i + 1]];
        d[i + 2] = lut[d[i + 2]];
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    type: 'C_Levels',
    label: 'Levels (Níveis)',
    category: 'Cor',
    gradient: 'from-zinc-950 via-sky-500 to-white',
    description: 'Remapeamento preciso de ponto preto, branco e meios-tons.',
    params: [
      { key: 'inBlack', label: 'Preto Entrada', min: 0, max: 180, step: 1, def: 14 },
      { key: 'inWhite', label: 'Branco Entrada', min: 80, max: 255, step: 1, def: 242 },
      { key: 'gamma', label: 'Gamma', min: 0.3, max: 2.5, step: 0.05, def: 1.08 },
    ],
    render: (ctx, w, h, p) => {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const span = Math.max(4, p.inWhite - p.inBlack);
      const invG = 1 / Math.max(0.2, p.gamma);
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) {
        const clamped = Math.max(0, Math.min(1, (v - p.inBlack) / span));
        lut[v] = Math.round(Math.pow(clamped, invG) * 255);
      }
      for (let i = 0; i < d.length; i += 4) {
        d[i] = lut[d[i]];
        d[i + 1] = lut[d[i + 1]];
        d[i + 2] = lut[d[i + 2]];
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    type: 'C_Vibrance',
    label: 'Vibrance & Balance',
    category: 'Cor',
    gradient: 'from-cyan-400 via-emerald-400 to-rose-500',
    description: 'Saturação inteligente que protege tons saturados + balanço RGB.',
    params: [
      { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, def: 42, unit: '%' },
      { key: 'cyanRed', label: 'Ciano / Vermelho', min: -50, max: 50, step: 1, def: 8 },
      { key: 'yellowBlue', label: 'Amarelo / Azul', min: -50, max: 50, step: 1, def: -6 },
    ],
    render: (ctx, w, h, p) => {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const vib = p.vibrance / 100;
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i] + p.cyanRed;
        let g = d[i + 1];
        let b = d[i + 2] + p.yellowBlue;
        const max = Math.max(r, g, b);
        const avg = (r + g + b) / 3;
        const amt = ((Math.abs(max - avg) * 2) / 255) * -vib + vib;
        r += (r - avg) * amt;
        g += (g - avg) * amt;
        b += (b - avg) * amt;
        d[i] = Math.max(0, Math.min(255, r));
        d[i + 1] = Math.max(0, Math.min(255, g));
        d[i + 2] = Math.max(0, Math.min(255, b));
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    type: 'S_Sharpen',
    label: 'S_Sharpen',
    category: 'Desfoque',
    gradient: 'from-sky-300 via-slate-200 to-slate-700',
    description: 'Nitidez óptica por convolução Laplaciana de alta frequência.',
    params: [
      { key: 'amount', label: 'Intensidade', min: 0, max: 150, step: 1, def: 65, unit: '%' },
      { key: 'radius', label: 'Raio', min: 1, max: 6, step: 1, def: 1, unit: 'px' },
    ],
    render: (ctx, w, h, p) => {
      const srcImg = ctx.getImageData(0, 0, w, h);
      const outImg = ctx.createImageData(w, h);
      const s = srcImg.data;
      const o = outImg.data;
      const k = p.amount / 100;
      const step = Math.max(1, Math.round(p.radius));
      for (let y = 0; y < h; y++) {
        const yUp = Math.max(0, y - step) * w;
        const yDn = Math.min(h - 1, y + step) * w;
        const yRow = y * w;
        for (let x = 0; x < w; x++) {
          const xLt = Math.max(0, x - step);
          const xRt = Math.min(w - 1, x + step);
          const i = (yRow + x) * 4;
          const up = (yUp + x) * 4;
          const dn = (yDn + x) * 4;
          const lt = (yRow + xLt) * 4;
          const rt = (yRow + xRt) * 4;
          for (let c = 0; c < 3; c++) {
            const avg = (s[up + c] + s[dn + c] + s[lt + c] + s[rt + c]) * 0.25;
            o[i + c] = Math.max(0, Math.min(255, Math.round(s[i + c] + (s[i + c] - avg) * k * 1.8)));
          }
          o[i + 3] = s[i + 3];
        }
      }
      ctx.putImageData(outImg, 0, 0);
    },
  },
  {
    type: 'S_DropShadow',
    label: 'S_DropShadow',
    category: 'Estilizar',
    gradient: 'from-slate-900 via-indigo-900 to-sky-400',
    description: 'Sombra projetada suave respeitando o recorte alfa da camada.',
    params: [
      { key: 'opacity', label: 'Opacidade', min: 0, max: 100, step: 1, def: 75, unit: '%' },
      { key: 'distance', label: 'Distância', min: 0, max: 80, step: 1, def: 16, unit: 'px' },
      { key: 'angle', label: 'Ângulo', min: 0, max: 360, step: 5, def: 135, unit: '°' },
      { key: 'blur', label: 'Suavidade', min: 0, max: 60, step: 1, def: 18, unit: 'px' },
    ],
    render: (ctx, w, h, p) => {
      const copy = copyOf(ctx, w, h);
      const rad = (p.angle * Math.PI) / 180;
      const dx = Math.cos(rad) * p.distance * base(w, h);
      const dy = Math.sin(rad) * p.distance * base(w, h);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.shadowColor = `rgba(0, 0, 0, ${p.opacity / 100})`;
      ctx.shadowBlur = Math.max(1, p.blur * base(w, h));
      ctx.shadowOffsetX = dx;
      ctx.shadowOffsetY = dy;
      ctx.drawImage(copy, 0, 0);
      ctx.restore();
      // Slight rim lift so even full-frame layers exhibit subtle edge depth
      if (dx !== 0 || dy !== 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        const g = ctx.createLinearGradient(0, 0, 0, h * 0.08);
        g.addColorStop(0, `rgba(0,0,0,${(p.opacity / 100) * 0.14})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h * 0.08);
        ctx.restore();
      }
    },
  },
  {
    type: 'S_Posterize',
    label: 'S_Posterize',
    category: 'Estilizar',
    gradient: 'from-amber-400 via-rose-500 to-indigo-700',
    description: 'Redução artística de níveis tonais estilo pôster serigráfico.',
    params: [{ key: 'levels', label: 'Níveis', min: 2, max: 16, step: 1, def: 5 }],
    render: (ctx, w, h, p) => {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const n = Math.max(2, Math.round(p.levels));
      const step = 255 / (n - 1);
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.round(Math.round((d[i] / 255) * (n - 1)) * step);
        d[i + 1] = Math.round(Math.round((d[i + 1] / 255) * (n - 1)) * step);
        d[i + 2] = Math.round(Math.round((d[i + 2] / 255) * (n - 1)) * step);
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    type: 'S_Halftone',
    label: 'S_Halftone',
    category: 'Estilizar',
    gradient: 'from-zinc-100 via-zinc-500 to-zinc-950',
    description: 'Retícula gráfica de pontos proporcional à luminância.',
    params: [
      { key: 'dotSize', label: 'Tamanho Ponto', min: 4, max: 28, step: 1, def: 8, unit: 'px' },
      { key: 'mix', label: 'Mistura', min: 10, max: 100, step: 1, def: 65, unit: '%' },
    ],
    render: (ctx, w, h, p) => {
      const copy = copyOf(ctx, w, h);
      const src = ctx.getImageData(0, 0, w, h).data;
      const cell = Math.max(4, Math.round(p.dotSize * base(w, h) * 1.4));
      const half = scratch('halftone', w, h);
      half.context.fillStyle = '#09090b';
      half.context.fillRect(0, 0, w, h);
      for (let y = Math.floor(cell / 2); y < h; y += cell) {
        for (let x = Math.floor(cell / 2); x < w; x += cell) {
          const idx = (y * w + x) * 4;
          if (src[idx + 3] < 10) continue;
          const lum = (0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2]) / 255;
          const r = Math.max(0.6, lum * (cell * 0.52));
          half.context.fillStyle = `rgb(${src[idx]},${src[idx + 1]},${src[idx + 2]})`;
          half.context.beginPath();
          half.context.arc(x, y, r, 0, Math.PI * 2);
          half.context.fill();
        }
      }
      half.context.globalCompositeOperation = 'destination-in';
      half.context.drawImage(copy, 0, 0);
      ctx.globalAlpha = p.mix / 100;
      ctx.drawImage(half.canvas, 0, 0);
    },
  },
  {
    type: 'S_FindEdges',
    label: 'S_FindEdges',
    category: 'Estilizar',
    gradient: 'from-cyan-400 via-blue-700 to-black',
    description: 'Detecção de contornos luminosos por operador gradiente.',
    params: [{ key: 'mix', label: 'Intensidade', min: 10, max: 100, step: 1, def: 75, unit: '%' }],
    render: (ctx, w, h, p) => {
      const srcImg = ctx.getImageData(0, 0, w, h);
      const outImg = ctx.createImageData(w, h);
      const s = srcImg.data;
      const o = outImg.data;
      const mix = p.mix / 100;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const right = (y * w + Math.min(w - 1, x + 1)) * 4;
          const down = (Math.min(h - 1, y + 1) * w + x) * 4;
          const er = Math.min(255, (Math.abs(s[i] - s[right]) + Math.abs(s[i] - s[down])) * 2.8);
          const eg = Math.min(255, (Math.abs(s[i + 1] - s[right + 1]) + Math.abs(s[i + 1] - s[down + 1])) * 2.8);
          const eb = Math.min(255, (Math.abs(s[i + 2] - s[right + 2]) + Math.abs(s[i + 2] - s[down + 2])) * 2.8);
          o[i] = s[i] * (1 - mix) + er * mix;
          o[i + 1] = s[i + 1] * (1 - mix) + eg * mix;
          o[i + 2] = s[i + 2] * (1 - mix) + eb * mix;
          o[i + 3] = s[i + 3];
        }
      }
      ctx.putImageData(outImg, 0, 0);
    },
  },
  {
    type: 'S_ChromaKey',
    label: 'Chroma Key (Fundo Verde/Azul)',
    category: 'Keying',
    gradient: 'from-green-400 via-emerald-600 to-zinc-900',
    description: 'Recorte cromático em pixels reais com tolerância, suavidade e spill.',
    params: [
      { key: 'keyHue', label: 'Matiz Chave (°)', min: 0, max: 360, step: 1, def: 120, unit: '°' },
      { key: 'tolerance', label: 'Tolerância', min: 5, max: 140, step: 1, def: 48 },
      { key: 'softness', label: 'Suavidade', min: 1, max: 80, step: 1, def: 22 },
      { key: 'spill', label: 'Supressão Spill', min: 0, max: 100, step: 1, def: 45, unit: '%' },
    ],
    render: (ctx, w, h, p) => {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const targetHue = p.keyHue;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255;
        const g = d[i + 1] / 255;
        const b = d[i + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        if (delta < 0.08) continue;
        let hue = 0;
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue = ((hue * 60) + 360) % 360;
        let diff = Math.abs(hue - targetHue);
        if (diff > 180) diff = 360 - diff;

        if (diff < p.tolerance + p.softness) {
          const factor = diff <= p.tolerance ? 0 : (diff - p.tolerance) / Math.max(1, p.softness);
          d[i + 3] = Math.round(d[i + 3] * factor);
        }
        // Keylight-style skin-preserving despill (0.65*R + 0.35*B) removes green/cyan bounce
        if (p.spill > 0) {
          const limit = d[i] * 0.65 + d[i + 2] * 0.35;
          if (d[i + 1] > limit) {
            d[i + 1] = Math.round(d[i + 1] - (d[i + 1] - limit) * (p.spill / 100));
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    type: 'S_LumaKey',
    label: 'Luma Key (Recorte por Luz)',
    category: 'Keying',
    gradient: 'from-white via-zinc-500 to-black',
    description: 'Remove áreas escuras ou claras por limiar de luminância.',
    params: [
      { key: 'threshold', label: 'Limiar', min: 0, max: 255, step: 1, def: 42 },
      { key: 'softness', label: 'Suavidade', min: 1, max: 100, step: 1, def: 24 },
      { key: 'invert', label: 'Remover Claros (0/1)', min: 0, max: 1, step: 1, def: 0 },
    ],
    render: (ctx, w, h, p) => {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const dist = p.invert > 0.5 ? p.threshold - lum : lum - p.threshold;
        if (dist < p.softness) {
          const alpha = Math.max(0, dist / Math.max(1, p.softness));
          d[i + 3] = Math.round(d[i + 3] * alpha);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  {
    type: 'S_MotionBlur',
    label: 'Borrão de Movimento (S_MotionBlur)',
    category: 'Desfoque',
    gradient: 'from-blue-400 via-indigo-600 to-violet-800',
    description: 'Borrão de movimento profissional com ângulo de obturador até 720°, multi-amostragem e intensidade extrema configurável.',
    params: [
      { key: 'amount', label: 'Intensidade Extrema', min: 0, max: 500, step: 1, def: 100, unit: '%' },
      { key: 'shutterAngle', label: 'Ângulo do Obturador', min: 0, max: 720, step: 1, def: 180, unit: '°' },
      { key: 'samples', label: 'Amostras de Blur', min: 4, max: 32, step: 1, def: 16 },
      { key: 'blurType', label: 'Tipo (0=Lin, 1=Rad, 2=Spin)', min: 0, max: 2, step: 1, def: 0 },
      { key: 'angle', label: 'Ângulo Linear', min: -360, max: 360, step: 1, def: 0, unit: '°' },
      { key: 'length', label: 'Comprimento', min: 0, max: 300, step: 1, def: 40, unit: 'px' },
      { key: 'centerX', label: 'Centro X', min: 0, max: 100, step: 1, def: 50, unit: '%' },
      { key: 'centerY', label: 'Centro Y', min: 0, max: 100, step: 1, def: 50, unit: '%' },
      { key: 'blend', label: 'Mistura / Blend', min: 0, max: 100, step: 1, def: 100, unit: '%' },
    ],
    render: (ctx, w, h, p) => {
      const amount = Math.max(0, p.amount ?? 100);
      const blend = Math.max(0, Math.min(100, p.blend ?? 100)) / 100;
      if (amount <= 0.001 || blend <= 0.001) return;

      const orig = copyOf(ctx, w, h);
      const samples = Math.max(4, Math.min(32, Math.round(p.samples || 16)));
      const shutter = (p.shutterAngle ?? 180) / 180;
      const lengthPx = (p.length ?? 40) * (amount / 100) * shutter * base(w, h);
      const blurType = Math.round(p.blurType || 0);
      const cx = ((p.centerX ?? 50) / 100) * w;
      const cy = ((p.centerY ?? 50) / 100) * h;
      const radAngle = ((p.angle || 0) * Math.PI) / 180;

      const acc = scratch('motion-blur-acc', w, h);
      let totalWeight = 0;

      for (let s = 0; s < samples; s++) {
        const u = (s / (samples - 1) - 0.5) * 2; // -1 to 1
        const weight = Math.cos(u * (Math.PI / 2.15));
        totalWeight += weight;

        acc.context.save();
        acc.context.globalAlpha = weight;

        if (blurType === 0) {
          // Linear directional motion blur
          const dx = u * lengthPx * 0.5 * Math.cos(radAngle);
          const dy = u * lengthPx * 0.5 * Math.sin(radAngle);
          acc.context.drawImage(orig, dx, dy);
        } else if (blurType === 1) {
          // Radial / Zoom motion blur
          const zoomScale = Math.max(0.01, 1 + u * (lengthPx / w) * 0.7);
          acc.context.translate(cx, cy);
          acc.context.scale(zoomScale, zoomScale);
          acc.context.drawImage(orig, -cx, -cy);
        } else {
          // Spin / Rotational motion blur
          const spinRad = u * (lengthPx / Math.max(w, h)) * (Math.PI / 2.2);
          acc.context.translate(cx, cy);
          acc.context.rotate(spinRad);
          acc.context.drawImage(orig, -cx, -cy);
        }
        acc.context.restore();
      }

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(orig, 0, 0);

      ctx.save();
      ctx.globalAlpha = blend;
      ctx.drawImage(acc.canvas, 0, 0);
      ctx.restore();
    },
  },
  {
    type: 'S_TimeSlice',
    label: 'Time Slice (S_TimeSlice)',
    category: 'Tempo / Slice',
    gradient: 'from-cyan-400 via-violet-500 to-fuchsia-600',
    description: 'Deslocamento temporal espacial em fatias. Revela diferentes instantes reais do vídeo ou animação ao longo da imagem.',
    params: [
      { key: 'sliceDirection', label: 'Direção das Fatias', min: -360, max: 360, step: 1, def: 90, unit: '°' },
      { key: 'sliceNumber', label: 'Quantidade de Fatias', min: 1, max: 64, step: 1, def: 12 },
      { key: 'frameOffset', label: 'Deslocamento de Quadros', min: -60, max: 60, step: 0.5, def: 0, unit: 'qd' },
      { key: 'timeSpread', label: 'Amplitude Temporal', min: -120, max: 120, step: 1, def: 12, unit: 'qd' },
      { key: 'timeDistribution', label: 'Distribuição (0=Sim, 1=Pas, 2=Fut, 3=Prog, 4=Reg, 5=Alt)', min: 0, max: 5, step: 1, def: 0 },
      { key: 'interpolation', label: 'Interpolação (0=Nearest, 1=Linear)', min: 0, max: 1, step: 1, def: 0 },
      { key: 'blend', label: 'Intensidade / Blend', min: 0, max: 100, step: 1, def: 100, unit: '%' },
      { key: 'sliceOffsetX', label: 'Deslocamento Fatias X', min: -100, max: 100, step: 1, def: 0, unit: '%' },
      { key: 'sliceOffsetY', label: 'Deslocamento Fatias Y', min: -100, max: 100, step: 1, def: 0, unit: '%' },
      { key: 'maskType', label: 'Tipo Máscara (0=Nenhum, 1=Luma, 2=Alfa, 3=Camada)', min: 0, max: 3, step: 1, def: 0 },
      { key: 'maskInvert', label: 'Inverter Máscara (0/1)', min: 0, max: 1, step: 1, def: 0 },
      { key: 'maskFeather', label: 'Feather da Máscara', min: 0, max: 100, step: 1, def: 0, unit: 'px' },
      { key: 'maskOpacity', label: 'Opacidade da Máscara', min: 0, max: 100, step: 1, def: 100, unit: '%' },
      { key: 'maskOffsetX', label: 'Offset Máscara X', min: -100, max: 100, step: 1, def: 0, unit: '%' },
      { key: 'maskOffsetY', label: 'Offset Máscara Y', min: -100, max: 100, step: 1, def: 0, unit: '%' },
      { key: 'maskScale', label: 'Escala da Máscara', min: 10, max: 300, step: 1, def: 100, unit: '%' },
      { key: 'maskDilate', label: 'Dilatar / Erodir Máscara', min: -50, max: 50, step: 1, def: 0, unit: 'px' },
      { key: 'maskShowOnly', label: 'Exibir Somente Máscara (0/1)', min: 0, max: 1, step: 1, def: 0 },
      { key: 'maskBypass', label: 'Ignorar Máscara (0/1)', min: 0, max: 1, step: 1, def: 0 },
    ],
    render: (ctx, w, h, p, time, _seed, extra) => {
      renderTimeSliceEffect(
        ctx,
        w,
        h,
        p as unknown as TimeSliceParams,
        extra?.currentTime ?? time,
        (targetT) => (extra?.sampleSourceFrame ? extra.sampleSourceFrame(targetT) : null),
        extra?.fps ?? 30,
        extra?.duration ?? Infinity
      );
    },
  },
];

export const EFFECTS_BY_TYPE = new Map(EFFECT_DEFINITIONS.map((effect) => [effect.type, effect]));
export const EFFECT_CATEGORIES = [...new Set(EFFECT_DEFINITIONS.map((effect) => effect.category))];

export function createEffect(type: string, overrides: Record<string, number> = {}): ClipEffect | null {
  const definition = EFFECTS_BY_TYPE.get(type);
  if (!definition) return null;
  return {
    id: `fx-${Math.random().toString(36).slice(2, 10)}`,
    type,
    enabled: true,
    params: Object.fromEntries(
      definition.params.map((param) => [param.key, overrides[param.key] ?? param.def])
    ),
  };
}

export interface EffectPreset {
  id: string;
  label: string;
  description: string;
  effects: { type: string; params?: Record<string, number> }[];
}

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    id: 'blockbuster',
    label: 'Blockbuster Flare',
    description: 'Glow + flare anamórfico + grão fino',
    effects: [
      { type: 'S_Glow', params: { brightness: 70, size: 46 } },
      { type: 'S_LensFlare', params: { brightness: 85, posX: 74, posY: 26 } },
      { type: 'S_Grain', params: { amount: 18 } },
    ],
  },
  {
    id: 'vhs',
    label: 'VHS Retro',
    description: 'TV damage + aberração + vinheta',
    effects: [
      { type: 'S_TVDamage' },
      { type: 'S_WarpChroma', params: { amount: 8 } },
      { type: 'S_Vignette', params: { amount: 55 } },
    ],
  },
  {
    id: 'super8',
    label: 'Super 8mm',
    description: 'Film damage + halação quente',
    effects: [
      { type: 'S_FilmEffect' },
      { type: 'S_FilmDamage' },
      { type: 'S_Vignette', params: { amount: 38 } },
    ],
  },
  {
    id: 'dream',
    label: 'Sonho Etéreo',
    description: 'Desfoque de lente + glow + duotone suave',
    effects: [
      { type: 'S_ZDefocus', params: { amount: 9, bokeh: 85 } },
      { type: 'S_Glow', params: { brightness: 110, size: 60 } },
      { type: 'S_Duotone', params: { mix: 32 } },
    ],
  },
  {
    id: 'glitch',
    label: 'Glitch Cyber',
    description: 'Damage digital + raios + shake',
    effects: [
      { type: 'S_DigitalDamage' },
      { type: 'S_Rays', params: { brightness: 70 } },
      { type: 'S_Shake', params: { amount: 18 } },
    ],
  },
  {
    id: 'time-slice-vertical',
    label: 'Time Slice Vertical',
    description: '12 fatias temporais verticais com deslocamento simétrico',
    effects: [{ type: 'S_TimeSlice', params: { sliceDirection: 90, sliceNumber: 12, timeSpread: 18, blend: 100 } }],
  },
  {
    id: 'time-slice-diagonal',
    label: 'Time Slice Diagonal',
    description: 'Fatias temporais a 45° com transição dinâmica',
    effects: [{ type: 'S_TimeSlice', params: { sliceDirection: 45, sliceNumber: 16, timeSpread: 24, blend: 100 } }],
  },
  {
    id: 'motion-blur-extreme',
    label: 'Borrão de Movimento Extremo',
    description: 'Borrão de alta intensidade 300% com obturador 360°',
    effects: [{ type: 'S_MotionBlur', params: { amount: 300, shutterAngle: 360, samples: 20, length: 60 } }],
  },
];

export function evaluateEffectParams(
  effect: ClipEffect,
  time: number,
  definition?: EffectDefinition,
  extra?: EffectRenderContext,
  seed = 0
): Record<string, number> {
  const def = definition || EFFECTS_BY_TYPE.get(effect.type);
  const result: Record<string, number> = {};
  if (!def) return { ...effect.params };

  for (const param of def.params) {
    const track = effect.keyframes?.find((t) => t.property === param.key);
    if (track && track.keyframes.length > 0) {
      let val = evaluatePropertyTrack(track, time, effect.params?.[param.key] ?? param.def);
      if (track.expression && track.expressionEnabled !== false) {
        const exprOut = evaluateSafeExpression(track.expression, {
          time: extra?.currentTime ?? time,
          relTime: time,
          value: val,
          duration: extra?.duration || 10,
          fps: extra?.fps || 30,
          index: 1,
          audioLevel: extra?.audioLevel || 0,
          seed,
        });
        if (!exprOut.error && Number.isFinite(exprOut.value)) {
          val = exprOut.value;
        }
      }
      result[param.key] = val;
    } else {
      result[param.key] = effect.params?.[param.key] ?? param.def;
    }
  }
  return result;
}

export function applyEffectChain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  effects: ClipEffect[],
  time: number,
  seed: number,
  extra?: EffectRenderContext
) {
  for (const effect of effects) {
    const definition = EFFECTS_BY_TYPE.get(effect.type);
    if (!definition || !effect.enabled) continue;
    const params = evaluateEffectParams(effect, time, definition, extra, seed);
    ctx.save();
    try {
      definition.render(ctx, w, h, params, time, seed, extra);
    } catch {
      // A failing effect must never break the whole frame.
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
  }
}
