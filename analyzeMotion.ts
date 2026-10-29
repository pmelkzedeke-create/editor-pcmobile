import type { MediaAsset, MotionAnalysis, MotionSample, TimelineClip } from '../../types/editor';
import { checkAborted, seekVideoFrame } from '../../utils/previewCache';
import { estimateCameraTranslation, matchPatch, toGray } from './motion';

export interface AnalysisProgress { done: number; total: number; confidence: number }

export function visibleSourceRange(clip: TimelineClip, mediaDuration: number) {
  const keys = clip.timeRemap?.enabled ? clip.timeRemap.keyframes.map((k) => k.sourceTime) : [];
  const start = Math.max(0, keys.length ? Math.min(...keys) : clip.trimStart);
  const end = Math.min(mediaDuration - 0.002, keys.length ? Math.max(...keys) : clip.trimStart + clip.duration * clip.speed);
  return { start, end: Math.max(start, end) };
}

/** Offline pixel analysis. Original video playback is never sought or mutated. */
export async function analyzeMotion(
  asset: MediaAsset,
  clip: TimelineClip,
  kind: MotionAnalysis['kind'],
  seed: { x: number; y: number; time: number },
  signal: AbortSignal,
  onProgress: (progress: AnalysisProgress) => void
): Promise<MotionAnalysis> {
  if (asset.type !== 'video' || !asset.url) throw new Error('Importe e selecione um video para analisar movimento.');
  const range = visibleSourceRange(clip, asset.duration);
  if (range.end - range.start < 0.08) throw new Error('O intervalo de origem e muito curto para analisar.');
  if (range.end - range.start > 60) throw new Error('Apare o clipe para ate 60 segundos por analise. Nada foi alterado.');
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = asset.url;
  const canvas = document.createElement('canvas');
  const width = 256;
  const height = Math.max(48, Math.round(width * (asset.height || 720) / (asset.width || 1280)));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas de analise indisponivel.');
  const rate = 15;
  const times = Array.from({ length: Math.ceil((range.end - range.start) * rate) + 1 }, (_, i) => Math.min(range.end, range.start + i / rate));
  const referenceTime = kind === 'camera' ? range.start : Math.max(range.start, Math.min(range.end, seed.time));
  if (!times.some((t) => Math.abs(t - referenceTime) < 0.001)) times.push(referenceTime);
  times.sort((a, b) => a - b);
  const readFrame = async (time: number) => {
    checkAborted(signal);
    await seekVideoFrame(video, time, signal);
    context.drawImage(video, 0, 0, width, height);
    return toGray(context.getImageData(0, 0, width, height).data, width, height);
  };
  const samples: MotionSample[] = [];
  let processed = 1;
  try {
    const reference = await readFrame(referenceTime);
    if (kind === 'point') {
      const referenceX = Math.max(7, Math.min(width - 8, seed.x * width));
      const referenceY = Math.max(7, Math.min(height - 8, seed.y * height));
      const texture = matchPatch(reference, reference, referenceX, referenceY, referenceX, referenceY, 6, 1);
      if (texture.confidence < 0.55) throw new Error('Ponto sem textura. Escolha um detalhe contrastante, nao uma area lisa.');
      samples.push({ time: referenceTime, x: referenceX / width, y: referenceY / height, confidence: 1 });
      for (const direction of [1, -1]) {
        let previous = reference;
        let x = referenceX;
        let y = referenceY;
        const subset = direction === 1 ? times.filter((t) => t > referenceTime + 0.001) : times.filter((t) => t < referenceTime - 0.001).reverse();
        for (const time of subset) {
          const frame = await readFrame(time);
          const found = matchPatch(previous, frame, x, y, x, y, 6, 18);
          if (found.confidence < 0.55) throw new Error(`Rastreio perdido em ${time.toFixed(2)}s. Escolha outro ponto ou apare o intervalo. A analise anterior foi preservada.`);
          x = found.x;
          y = found.y;
          previous = frame;
          samples.push({ time, x: x / width, y: y / height, confidence: found.confidence });
          onProgress({ done: ++processed, total: times.length, confidence: found.confidence });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    } else {
      let previous = reference;
      let x = 0;
      let y = 0;
      let valid = 0;
      samples.push({ time: referenceTime, x, y, confidence: 1 });
      for (const time of times.filter((t) => t > referenceTime + 0.001)) {
        const frame = await readFrame(time);
        const delta = estimateCameraTranslation(previous, frame);
        if (delta.confidence >= 0.65) { x += delta.dx / width; y += delta.dy / height; valid++; }
        samples.push({ time, x, y, confidence: delta.confidence });
        previous = frame;
        onProgress({ done: ++processed, total: times.length, confidence: delta.confidence });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (valid < Math.max(1, (times.length - 1) * 0.45)) {
        throw new Error('Poucos pontos confiaveis para estabilizar. Use uma cena com textura, sem cortes internos e com movimento moderado.');
      }
    }
    checkAborted(signal);
    return { kind, mediaId: asset.id, sourceWidth: asset.width || video.videoWidth, sourceHeight: asset.height || video.videoHeight, start: range.start, end: range.end, sampleRate: rate, samples: samples.sort((a, b) => a.time - b.time) };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    canvas.width = canvas.height = 1;
  }
}