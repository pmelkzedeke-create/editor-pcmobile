export interface TimeSliceParams {
  sliceDirection: number; // degrees, -360..360, default 90
  sliceNumber: number; // 1..64, default 12
  frameOffset: number; // -60..60 frames, default 0
  timeSpread: number; // -120..120 frames, default 12
  timeDistribution: number; // 0=symmetric, 1=past, 2=future, 3=progressive, 4=regressive, 5=alternate
  interpolation: number; // 0=nearest, 1=linear
  blend: number; // 0..100%, default 100
  sliceOffsetX: number; // -100..100%, default 0
  sliceOffsetY: number; // -100..100%, default 0
  maskType: number; // 0=none, 1=luminance, 2=alpha, 3=layerMask
  maskInvert: number; // 0 or 1
  maskFeather: number; // 0..100 px
  maskOpacity: number; // 0..100 %
  maskOffsetX: number; // -100..100 %
  maskOffsetY: number; // -100..100 %
  maskScale: number; // 10..300 %
  maskDilate: number; // -50..50 px
  maskShowOnly: number; // 0 or 1
  maskBypass: number; // 0 or 1
}

export const TIME_SLICE_DISTRIBUTIONS = [
  { id: 0, label: 'Simétrica (Passado e Futuro)' },
  { id: 1, label: 'Passado' },
  { id: 2, label: 'Futuro' },
  { id: 3, label: 'Progressiva' },
  { id: 4, label: 'Regressiva' },
  { id: 5, label: 'Alternada' },
] as const;

export const TIME_SLICE_INTERPOLATIONS = [
  { id: 0, label: 'Nearest Frame (Mais Próximo)' },
  { id: 1, label: 'Linear Frame Interpolation (Mistura Suave)' },
] as const;

export const TIME_SLICE_MASK_TYPES = [
  { id: 0, label: 'Nenhuma' },
  { id: 1, label: 'Luminância da Imagem' },
  { id: 2, label: 'Canal Alfa' },
  { id: 3, label: 'Máscara da Camada' },
] as const;

export const TIME_SLICE_PRESET_COUNTS = [4, 8, 12, 16, 24, 32, 48, 64] as const;

export interface TimeSlicePreset {
  id: string;
  name: string;
  description: string;
  params: Partial<TimeSliceParams>;
}

export const TIME_SLICE_PRESETS: TimeSlicePreset[] = [
  {
    id: 'subtle',
    name: 'Subtle Slice',
    description: 'Deslocamento sutil com 8 fatias e mistura suave',
    params: { sliceDirection: 90, sliceNumber: 8, frameOffset: 0, timeSpread: 6, timeDistribution: 0, interpolation: 1, blend: 75 },
  },
  {
    id: 'smooth-temporal',
    name: 'Smooth Temporal Slice',
    description: '16 fatias com interpolação linear entre quadros',
    params: { sliceDirection: 90, sliceNumber: 16, frameOffset: 0, timeSpread: 16, timeDistribution: 0, interpolation: 1, blend: 90 },
  },
  {
    id: 'strong',
    name: 'Strong Slice',
    description: 'Separação temporal marcante e fatias nítidas',
    params: { sliceDirection: 90, sliceNumber: 16, frameOffset: 0, timeSpread: 30, timeDistribution: 0, interpolation: 0, blend: 100 },
  },
  {
    id: 'horizontal',
    name: 'Horizontal Slice',
    description: 'Fatias horizontais orientadas a 0°',
    params: { sliceDirection: 0, sliceNumber: 12, frameOffset: 0, timeSpread: 15, timeDistribution: 0, interpolation: 0, blend: 100 },
  },
  {
    id: 'vertical',
    name: 'Vertical Slice',
    description: 'Fatias verticais clássicas a 90°',
    params: { sliceDirection: 90, sliceNumber: 12, frameOffset: 0, timeSpread: 15, timeDistribution: 0, interpolation: 0, blend: 100 },
  },
  {
    id: 'diagonal',
    name: 'Diagonal Slice',
    description: 'Fatias inclinadas em diagonal dinâmica a 45°',
    params: { sliceDirection: 45, sliceNumber: 16, frameOffset: 0, timeSpread: 20, timeDistribution: 0, interpolation: 0, blend: 100 },
  },
  {
    id: 'reverse-time',
    name: 'Reverse Time Slice',
    description: 'Ordem temporal invertida criando eco retrocedido',
    params: { sliceDirection: 90, sliceNumber: 12, frameOffset: 0, timeSpread: -24, timeDistribution: 0, interpolation: 0, blend: 100 },
  },
  {
    id: 'future',
    name: 'Future Slice',
    description: 'Amostragem voltada exclusivamente para instantes futuros',
    params: { sliceDirection: 90, sliceNumber: 12, frameOffset: 0, timeSpread: 24, timeDistribution: 2, interpolation: 0, blend: 100 },
  },
  {
    id: 'past',
    name: 'Past Slice',
    description: 'Amostragem voltada exclusivamente para o rastro passado',
    params: { sliceDirection: 90, sliceNumber: 12, frameOffset: 0, timeSpread: 24, timeDistribution: 1, interpolation: 0, blend: 100 },
  },
  {
    id: 'symmetrical',
    name: 'Symmetrical Slice',
    description: '24 fatias com expansão temporal simétrica e equilibrada',
    params: { sliceDirection: 90, sliceNumber: 24, frameOffset: 0, timeSpread: 24, timeDistribution: 0, interpolation: 1, blend: 100 },
  },
  {
    id: 'cinematic',
    name: 'Cinematic Slice',
    description: 'Fatias cinematográficas a 30° com transição aveludada',
    params: { sliceDirection: 30, sliceNumber: 8, frameOffset: 0, timeSpread: 16, timeDistribution: 0, interpolation: 1, blend: 85, maskFeather: 10 },
  },
  {
    id: 'action',
    name: 'Action Slice',
    description: 'Deslocamento agressivo a -45° para sequências de ação rápida',
    params: { sliceDirection: -45, sliceNumber: 24, frameOffset: 0, timeSpread: 40, timeDistribution: 5, interpolation: 0, blend: 100 },
  },
  {
    id: 'glitch',
    name: 'Glitch Slice',
    description: 'Padrão alternado de alta densidade criando vibração glitch',
    params: { sliceDirection: 90, sliceNumber: 32, frameOffset: 4, timeSpread: 60, timeDistribution: 5, interpolation: 0, blend: 100 },
  },
  {
    id: 'fast-motion',
    name: 'Fast Motion Slice',
    description: 'Deslocamento horizontal acelerado em progressão cúbica',
    params: { sliceDirection: 0, sliceNumber: 16, frameOffset: 0, timeSpread: 48, timeDistribution: 3, interpolation: 0, blend: 100 },
  },
  {
    id: 'soft',
    name: 'Soft Slice',
    description: 'Apenas 6 fatias amplas com mistura suave',
    params: { sliceDirection: 90, sliceNumber: 6, frameOffset: 0, timeSpread: 10, timeDistribution: 0, interpolation: 1, blend: 60 },
  },
  {
    id: 'high-density',
    name: 'High Density Slice',
    description: '48 micro-fatias criando estrias temporais finas e nítidas',
    params: { sliceDirection: 90, sliceNumber: 48, frameOffset: 0, timeSpread: 32, timeDistribution: 0, interpolation: 0, blend: 100 },
  },
  {
    id: 'extreme',
    name: 'Extreme Slice',
    description: 'Separação extrema com 64 fatias e grande amplitude temporal',
    params: { sliceDirection: -60, sliceNumber: 64, frameOffset: 0, timeSpread: 90, timeDistribution: 5, interpolation: 0, blend: 100 },
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Configuração personalizada definida pelo usuário',
    params: { sliceDirection: 90, sliceNumber: 12, frameOffset: 0, timeSpread: 12, timeDistribution: 0, interpolation: 0, blend: 100 },
  },
];

export const DEFAULT_TIME_SLICE_PARAMS: TimeSliceParams = {
  sliceDirection: 90,
  sliceNumber: 12,
  frameOffset: 0,
  timeSpread: 12,
  timeDistribution: 0,
  interpolation: 0,
  blend: 100,
  sliceOffsetX: 0,
  sliceOffsetY: 0,
  maskType: 0,
  maskInvert: 0,
  maskFeather: 0,
  maskOpacity: 100,
  maskOffsetX: 0,
  maskOffsetY: 0,
  maskScale: 100,
  maskDilate: 0,
  maskShowOnly: 0,
  maskBypass: 0,
};

/**
 * Calculates the delta factor (-1..1) for slice index k out of total slices N,
 * based on the selected time distribution mode.
 */
export function calculateSliceDistributionDelta(k: number, N: number, mode: number): number {
  if (N <= 1) return 0;
  const u = (k + 0.5) / N; // 0..1
  switch (Math.round(mode)) {
    case 1: // Past only: -1 to 0
      return -(1 - u);
    case 2: // Future only: 0 to 1
      return u;
    case 3: { // Progressive: power curve from -1 to 1
      const centered = (u - 0.5) * 2;
      return Math.sign(centered) * Math.pow(Math.abs(centered), 1.8);
    }
    case 4: { // Regressive: inverse power curve from -1 to 1
      const centered = (u - 0.5) * 2;
      const mag = 1 - Math.pow(1 - Math.abs(centered), 1.8);
      return Math.sign(centered) * mag;
    }
    case 5: { // Alternate: flip between positive and negative shifts
      const mag = (k + 1) / N;
      return (k % 2 === 0 ? 1 : -1) * mag;
    }
    case 0: // Symmetric (default): -1 to +1 centered at 0
    default:
      return (u - 0.5) * 2;
  }
}

/**
 * Calculates the requested sample times for every slice k = 0..N-1.
 */
export function calculateTimeSliceTimes(
  currentTime: number,
  params: TimeSliceParams,
  fps = 30,
  maxDuration = Infinity
): { time: number; deltaFrames: number; sliceIndex: number }[] {
  const N = Math.max(1, Math.min(64, Math.round(params.sliceNumber || 12)));
  const globalOffsetSec = (params.frameOffset || 0) / fps;
  const spreadSec = (params.timeSpread || 0) / fps;

  const result: { time: number; deltaFrames: number; sliceIndex: number }[] = [];
  for (let k = 0; k < N; k++) {
    const delta = calculateSliceDistributionDelta(k, N, params.timeDistribution);
    const dt = globalOffsetSec + delta * spreadSec * 0.5;
    const sampleT = Math.max(0, Math.min(maxDuration, currentTime + dt));
    const deltaFrames = Math.round(dt * fps * 10) / 10;
    result.push({ time: sampleT, deltaFrames, sliceIndex: k });
  }
  return result;
}

const scratchCanvases = new Map<string, HTMLCanvasElement>();
function getScratch(key: string, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let c = scratchCanvases.get(key);
  if (!c) {
    c = document.createElement('canvas');
    scratchCanvases.set(key, c);
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

/**
 * Renders the Time Slice effect onto ctx using real temporal frames.
 */
export function renderTimeSliceEffect(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: TimeSliceParams,
  currentTime: number,
  sampleFrame: (time: number) => CanvasImageSource | null,
  fps = 30,
  maxDuration = Infinity
): void {
  // If blend is 0%, original image stays 100% untouched
  const blendFactor = Math.max(0, Math.min(100, params.blend ?? 100)) / 100;
  if (blendFactor <= 0.001) return;

  const N = Math.max(1, Math.min(64, Math.round(params.sliceNumber || 12)));
  const angleRad = ((params.sliceDirection ?? 90) * Math.PI) / 180;
  const cx = w / 2 + ((params.sliceOffsetX || 0) / 100) * w;
  const cy = h / 2 + ((params.sliceOffsetY || 0) / 100) * h;

  // Keep a clean copy of the original layer
  const orig = getScratch('ts-orig', w, h);
  orig.ctx.drawImage(ctx.canvas, 0, 0);

  // Compute bounding radius to cover the frame at any rotation and offset
  const R = Math.hypot(w, h) * 1.6;
  const totalSpan = 2 * R;
  const stripWidth = totalSpan / N;

  // Render the slices onto output scratch canvas
  const sliced = getScratch('ts-sliced', w, h);
  const sampleTimes = calculateTimeSliceTimes(currentTime, params, fps, maxDuration);

  for (let k = 0; k < N; k++) {
    const { time: targetT } = sampleTimes[k];

    let frameImage: CanvasImageSource | null = null;
    const isLinear = Math.round(params.interpolation || 0) === 1;

    if (isLinear) {
      // Linear Frame Interpolation: blend neighboring frame moments
      const frameExact = targetT * fps;
      const f0 = Math.floor(frameExact) / fps;
      const f1 = Math.ceil(frameExact) / fps;
      const alpha = frameExact - Math.floor(frameExact);

      const frame0 = sampleFrame(f0);
      const frame1 = f1 !== f0 ? sampleFrame(f1) : frame0;

      if (frame0 && frame1 && alpha > 0.02 && alpha < 0.98) {
        const blendScratch = getScratch(`ts-blend-${k % 4}`, w, h);
        blendScratch.ctx.drawImage(frame0, 0, 0, w, h);
        blendScratch.ctx.save();
        blendScratch.ctx.globalAlpha = alpha;
        blendScratch.ctx.drawImage(frame1, 0, 0, w, h);
        blendScratch.ctx.restore();
        frameImage = blendScratch.canvas;
      } else {
        frameImage = frame0 || frame1;
      }
    } else {
      // Nearest Frame
      const nearestT = Math.round(targetT * fps) / fps;
      frameImage = sampleFrame(nearestT);
    }

    // Fallback: if no alternate frame is available (e.g. static graphic), use original
    if (!frameImage) {
      frameImage = orig.canvas;
    }

    // Clip strip k in rotated coordinates and draw the sampled frame
    sliced.ctx.save();
    sliced.ctx.translate(cx, cy);
    sliced.ctx.rotate(angleRad);
    sliced.ctx.beginPath();
    const x0 = -R + k * stripWidth;
    sliced.ctx.rect(x0, -R, stripWidth + 0.6, 2 * R);
    sliced.ctx.clip();

    sliced.ctx.rotate(-angleRad);
    sliced.ctx.translate(-cx, -cy);
    sliced.ctx.drawImage(frameImage, 0, 0, w, h);
    sliced.ctx.restore();
  }

  // --- MASK PROCESSING ---
  const maskType = Math.round(params.maskType || 0);
  const bypassMask = Math.round(params.maskBypass || 0) === 1;

  if (maskType > 0 && !bypassMask) {
    const maskScratch = getScratch('ts-mask', w, h);
    const mctx = maskScratch.ctx;

    // Build base mask
    if (maskType === 1) {
      // Luminance mask: high brightness = 1, dark = 0
      mctx.drawImage(orig.canvas, 0, 0);
      const imgData = mctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.round(luma);
      }
      mctx.putImageData(imgData, 0, 0);
    } else if (maskType === 2 || maskType === 3) {
      // Alpha mask / Layer mask
      mctx.drawImage(orig.canvas, 0, 0);
      const imgData = mctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = a;
      }
      mctx.putImageData(imgData, 0, 0);
    }

    // Mask Offset & Scale
    if (params.maskScale !== 100 || params.maskOffsetX !== 0 || params.maskOffsetY !== 0) {
      const copyMask = getScratch('ts-mask-copy', w, h);
      copyMask.ctx.drawImage(maskScratch.canvas, 0, 0);
      mctx.clearRect(0, 0, w, h);
      mctx.save();
      const mcx = w / 2 + ((params.maskOffsetX || 0) / 100) * w;
      const mcy = h / 2 + ((params.maskOffsetY || 0) / 100) * h;
      mctx.translate(mcx, mcy);
      const ms = Math.max(0.1, (params.maskScale || 100) / 100);
      mctx.scale(ms, ms);
      mctx.drawImage(copyMask.canvas, -w / 2, -h / 2);
      mctx.restore();
    }

    // Mask Invert
    if (Math.round(params.maskInvert || 0) === 1) {
      const imgData = mctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = 255 - d[i + 3];
      }
      mctx.putImageData(imgData, 0, 0);
    }

    // Mask Feather (Blur)
    if (params.maskFeather && params.maskFeather > 0) {
      const copyMask = getScratch('ts-mask-blur', w, h);
      copyMask.ctx.drawImage(maskScratch.canvas, 0, 0);
      mctx.clearRect(0, 0, w, h);
      mctx.save();
      mctx.filter = `blur(${Math.min(50, params.maskFeather)}px)`;
      mctx.drawImage(copyMask.canvas, 0, 0);
      mctx.restore();
    }

    // Mask Dilate / Erode
    if (params.maskDilate && Math.abs(params.maskDilate) > 0.5) {
      const imgData = mctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      const threshold = params.maskDilate > 0 ? Math.max(10, 128 - params.maskDilate * 2) : Math.min(245, 128 - params.maskDilate * 2);
      for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = d[i + 3] >= threshold ? 255 : 0;
      }
      mctx.putImageData(imgData, 0, 0);
    }

    // Mask Opacity
    if (params.maskOpacity !== undefined && params.maskOpacity < 100) {
      const alphaFactor = Math.max(0, Math.min(100, params.maskOpacity)) / 100;
      const imgData = mctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = Math.round(d[i + 3] * alphaFactor);
      }
      mctx.putImageData(imgData, 0, 0);
    }

    // If "Show Mask Only" is active, render the black/white mask on ctx and finish!
    if (Math.round(params.maskShowOnly || 0) === 1) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(maskScratch.canvas, 0, 0);
      return;
    }

    // Mask the sliced result (keep original outside the mask)
    sliced.ctx.save();
    sliced.ctx.globalCompositeOperation = 'destination-in';
    sliced.ctx.drawImage(maskScratch.canvas, 0, 0);
    sliced.ctx.restore();
  }

  // Final blend between original image and sliced result
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(orig.canvas, 0, 0);

  ctx.save();
  ctx.globalAlpha = blendFactor;
  ctx.drawImage(sliced.canvas, 0, 0);
  ctx.restore();
}
