import type { MediaAsset, ProjectState, WorkArea } from '../types/editor';
import { MediaElementPool, renderFrameToCanvas } from './compositor';
import type { RenderedClipBounds } from './compositor';
import { clamp, getClipSourceTime } from './timeRemap';
import { evaluateEffectParams } from './sapphireEffects';
import { calculateTimeSliceTimes, type TimeSliceParams } from './timeSlice';

export function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Operacao cancelada', 'AbortError');
}

function waitForMedia(video: HTMLVideoElement, event: string, signal?: AbortSignal) {
  checkAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(event, ready);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error('Nao foi possivel decodificar o video. Importe um MP4 ou WebM compativel.'));
    };
    const aborted = () => {
      cleanup();
      reject(new DOMException('Operacao cancelada', 'AbortError'));
    };
    const timeout = window.setTimeout(failed, 15000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

export async function seekVideoFrame(video: HTMLVideoElement, time: number, signal?: AbortSignal) {
  checkAborted(signal);
  video.pause();
  if (video.error) throw new Error('Este video nao pode ser decodificado pelo navegador.');
  if (video.readyState < 2) await waitForMedia(video, 'loadeddata', signal);
  if (video.seeking) await waitForMedia(video, 'seeked', signal);
  const target = clamp(time, 0, Math.max(0, video.duration - 0.001));
  if (Math.abs(video.currentTime - target) > 0.0005) {
    const seeked = waitForMedia(video, 'seeked', signal);
    video.currentTime = target;
    await seeked;
  }
  checkAborted(signal);
}

export async function prepareMediaFrame(
  project: ProjectState,
  assets: Map<string, MediaAsset>,
  pool: MediaElementPool,
  time: number,
  signal?: AbortSignal,
  depth = 0
) {
  const visible = new Set(project.tracks.filter((t) => !t.hidden).map((t) => t.id));
  await Promise.all(
    project.clips.map(async (clip) => {
      if (
        clip.enabled === false ||
        !visible.has(clip.trackId) ||
        time < clip.startTime ||
        time >= clip.startTime + clip.duration
      ) {
        return;
      }
      if (clip.type === 'precomp' && clip.precompId && depth < 4) {
        const sub = project.compositions?.find((c) => c.id === clip.precompId);
        if (sub) {
          await prepareMediaFrame(
            {
              projectName: sub.name,
              aspectRatio: sub.aspectRatio,
              fps: sub.fps,
              tracks: sub.tracks,
              clips: sub.clips,
              markers: sub.markers,
              compositions: project.compositions,
            },
            assets,
            pool,
            getClipSourceTime(clip, time - clip.startTime),
            signal,
            depth + 1
          );
        }
        return;
      }
      if (!clip.mediaId) return;
      const asset = assets.get(clip.mediaId);
      if (!asset) throw new Error(`Midia ausente: ${clip.name}. Importe o arquivo novamente.`);
      if (clip.type === 'video') {
        const video = pool.getVideo(clip.id, asset.url);
        video.muted = true;
        const currentSourceTime = getClipSourceTime(clip, time - clip.startTime);
        pool.suppressNotify++;
        try {
          await seekVideoFrame(video, currentSourceTime, signal);
          pool.storeTemporalSample(clip.id, currentSourceTime, video);

          // Pre-sample frames for S_TimeSlice / S_ForceMotionBlur if active on this video clip
          const sliceEffect = clip.effects?.find((e) => e.type === 'S_TimeSlice' && e.enabled);
          const fmb = clip.effects?.find((e) => e.type === 'S_ForceMotionBlur' && e.enabled);
          if (sliceEffect || fmb) {
            const sampleTimes: number[] = [];
            if (sliceEffect) {
              const evalParams = evaluateEffectParams(sliceEffect, time - clip.startTime);
              const sampleList = calculateTimeSliceTimes(
                currentSourceTime,
                evalParams as unknown as TimeSliceParams,
                project.fps,
                asset.duration
              );
              sampleTimes.push(...sampleList.map((s) => s.time));
            }
            if (fmb) {
              // Amostras dentro do shutter angle (metade antes, metade depois)
              const fp = evaluateEffectParams(fmb, time - clip.startTime);
              const shutterSec = ((fp.shutterAngle ?? 180) / 360) / Math.max(1, project.fps);
              const count = Math.max(2, Math.round(fp.samples ?? 12));
              for (let s = 0; s < count; s++) {
                const u = count === 1 ? 0 : s / (count - 1) - 0.5;
                sampleTimes.push(currentSourceTime + u * shutterSec);
              }
            }
            const uniqueTimes = [...new Set(sampleTimes.map((s) => Math.round(s * 30) / 30))];
            for (const sampleT of uniqueTimes) {
              checkAborted(signal);
              if (sampleT < 0 || sampleT >= asset.duration) continue;
              if (!pool.getTemporalSample(clip.id, sampleT)) {
                await seekVideoFrame(video, sampleT, signal);
                pool.storeTemporalSample(clip.id, sampleT, video);
              }
            }
            await seekVideoFrame(video, currentSourceTime, signal);
          }
        } finally {
          pool.suppressNotify = Math.max(0, pool.suppressNotify - 1);
        }
      } else if (clip.type === 'image') {
        const image = pool.getImage(asset.url);
        if (!image.complete || image.naturalWidth === 0) {
          await image.decode();
        }
      }
    })
  );
  checkAborted(signal);
}

interface StoredFrame {
  blob: Blob;
  bounds: RenderedClipBounds[];
}

export class PreviewFrameCache {
  readonly frames = new Map<number, StoredFrame>();
  private decoded = new Map<number, ImageBitmap>();
  private pending = new Map<number, Promise<ImageBitmap | null>>();
  private generation = 0;
  bytes = 0;

  constructor(
    readonly fps: number,
    readonly width: number,
    readonly height: number
  ) {}

  frameIndex(time: number) {
    return Math.max(0, Math.floor(time * this.fps + 1e-5));
  }
  has(time: number) {
    return this.frames.has(this.frameIndex(time));
  }
  peek(time: number) {
    return this.decoded.get(this.frameIndex(time));
  }
  bounds(time: number) {
    return this.frames.get(this.frameIndex(time))?.bounds || [];
  }

  private putDecodedBitmap(index: number, bitmap: ImageBitmap) {
    const prev = this.decoded.get(index);
    if (prev && prev !== bitmap) prev.close();
    this.decoded.delete(index);
    this.decoded.set(index, bitmap);
    while (this.decoded.size > 48) {
      const oldest = this.decoded.keys().next().value!;
      this.decoded.get(oldest)?.close();
      this.decoded.delete(oldest);
    }
  }

  store(index: number, blob: Blob, bounds: RenderedClipBounds[], bitmap?: ImageBitmap | null) {
    const previous = this.frames.get(index);
    const size = this.bytes + blob.size - (previous?.blob.size || 0);
    if (size > 192 * 1024 * 1024) {
      bitmap?.close();
      throw new Error('Limite de cache de 192 MB atingido. Reduza a area de trabalho ou use qualidade 1/4.');
    }
    this.bytes = size;
    this.frames.set(index, { blob, bounds });
    if (bitmap) {
      this.putDecodedBitmap(index, bitmap);
    }
  }

  /** Automatic rendering has a bounded working set; evict farthest frames first. */
  storeAutomatic(
    index: number,
    blob: Blob,
    bounds: RenderedClipBounds[],
    playheadIndex: number,
    bitmap?: ImageBitmap | null
  ) {
    const budget = 64 * 1024 * 1024;
    if (blob.size > budget) {
      bitmap?.close();
      return;
    }
    const candidates = [...this.frames.keys()].sort((a, b) => Math.abs(b - playheadIndex) - Math.abs(a - playheadIndex));
    while ((this.bytes + blob.size > budget || this.frames.size >= 600) && candidates.length) {
      const oldest = candidates.shift()!;
      this.bytes -= this.frames.get(oldest)!.blob.size;
      this.frames.delete(oldest);
      this.decoded.get(oldest)?.close();
      this.decoded.delete(oldest);
    }
    this.store(index, blob, bounds, bitmap);
  }

  decode(index: number): Promise<ImageBitmap | null> {
    const decoded = this.decoded.get(index);
    if (decoded) {
      this.decoded.delete(index);
      this.decoded.set(index, decoded);
      return Promise.resolve(decoded);
    }
    const existing = this.pending.get(index);
    if (existing) return existing;
    const frame = this.frames.get(index);
    if (!frame) return Promise.resolve(null);
    const generation = this.generation;
    const task = createImageBitmap(frame.blob)
      .then((bitmap) => {
        if (generation !== this.generation || !this.frames.has(index)) {
          bitmap.close();
          return null;
        }
        this.putDecodedBitmap(index, bitmap);
        return bitmap;
      })
      .finally(() => {
        if (this.pending.get(index) === task) this.pending.delete(index);
      });
    this.pending.set(index, task);
    return task;
  }

  prefetch(time: number) {
    const index = this.frameIndex(time);
    for (let i = 0; i < 12; i++) void this.decode(index + i).catch(() => {});
  }

  ranges(): WorkArea[] {
    const indices = [...this.frames.keys()].sort((a, b) => a - b);
    const ranges: WorkArea[] = [];
    for (const index of indices) {
      const last = ranges[ranges.length - 1];
      if (last && Math.abs(last.end - index / this.fps) < 0.5 / this.fps) last.end = (index + 1) / this.fps;
      else ranges.push({ start: index / this.fps, end: (index + 1) / this.fps });
    }
    return ranges;
  }

  clear() {
    this.generation++;
    this.decoded.forEach((bitmap) => bitmap.close());
    this.decoded.clear();
    this.pending.clear();
    this.frames.clear();
    this.bytes = 0;
  }
}

export async function renderPreviewRange(
  project: ProjectState,
  assets: Map<string, MediaAsset>,
  cache: PreviewFrameCache,
  area: WorkArea,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void
) {
  const pool = new MediaElementPool();
  const canvas = document.createElement('canvas');
  canvas.width = cache.width;
  canvas.height = cache.height;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Canvas indisponivel para renderizacao.');
  const first = Math.floor(area.start * project.fps + 1e-5);
  const last = Math.ceil(area.end * project.fps - 1e-5);
  try {
    await document.fonts.ready;
    for (let index = first; index < last; index++) {
      checkAborted(signal);
      if (!cache.frames.has(index)) {
        await prepareMediaFrame(project, assets, pool, index / project.fps, signal);
        const bounds = renderFrameToCanvas(
          context,
          canvas.width,
          canvas.height,
          project.tracks,
          project.clips,
          assets,
          pool,
          index / project.fps,
          {
            backgroundColor: project.backgroundColor,
            transparentBg: project.transparentBg,
            fps: project.fps,
            compositions: project.compositions,
          }
        );
        const [blob, bitmap] = await Promise.all([
          new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) => (value ? resolve(value) : reject(new Error('Falha ao armazenar um quadro.'))),
              project.transparentBg ? 'image/png' : 'image/jpeg',
              0.86
            )
          ),
          index - first < 36 && typeof createImageBitmap !== 'undefined'
            ? createImageBitmap(canvas).catch(() => null)
            : Promise.resolve(null),
        ]);
        checkAborted(signal);
        cache.store(index, blob, bounds, bitmap);
      }
      if ((index - first) % 5 === 0 || index === last - 1) {
        onProgress(index - first + 1, last - first);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } finally {
    pool.dispose();
  }
}
