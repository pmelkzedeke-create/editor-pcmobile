import {
  Composition,
  ExportQuality,
  MediaAsset,
  ProjectState,
  TimelineClip,
  Track,
  WorkArea,
} from '../types/editor';
import { clamp, getClipPlaybackRate, getClipSourceTime } from './timeRemap';
import { applyEffectChain, type EffectRenderContext } from './sapphireEffects';
import { sampleProjectAudioLevel } from '../core/audioAnalysis';
import { getProjectDimensions, resolveWorldTransform } from '../core/compositions';
import { resolveClipAnimation } from '../core/keyframes';
import { SourceEffectsProcessor } from '../core/vision/sourceEffects';
import {
  applyLayerMasksToCanvas,
  applyTrackMatteToCanvas,
  renderVectorShapeLayer,
} from '../core/shapesAndMasks';
import { studioThreeEngine } from '../core/threeEngine';
import { applyPuppetPinDeformation } from '../core/puppetPins';
import { parseLottieJson, renderLottieFrame } from '../core/lottieRenderer';

const stagePool = new Map<string, HTMLCanvasElement>();
function getStageCanvas(key: string, w: number, h: number): CanvasRenderingContext2D {
  let c = stagePool.get(key);
  if (!c) {
    c = document.createElement('canvas');
    stagePool.set(key, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const context = c.getContext('2d')!;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
  context.imageSmoothingEnabled = true;
  context.clearRect(0, 0, w, h);
  return context;
}

function clipSeed(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  return hash;
}

export interface RenderedClipBounds {
  clipId: string;
  x: number; // canvas px left
  y: number; // canvas px top
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface RenderCompositionOptions {
  backgroundColor?: string;
  transparentBg?: boolean;
  fps?: number;
  compositions?: Composition[];
  depth?: number;
  audioLevel?: number;
  /** Substitui o drawable de um clipe de vídeo por quadro interpolado (fluxo óptico). */
  frameOverride?: Map<string, CanvasImageSource>;
}

export class MediaElementPool {
  readonly sourceEffects = new SourceEffectsProcessor();
  private videos = new Map<string, HTMLVideoElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private images = new Map<string, HTMLImageElement>();
  private listeners = new Set<() => void>();
  private temporalSamples = new Map<string, Map<number, HTMLCanvasElement>>();

  storeTemporalSample(clipId: string, timeSec: number, source: CanvasImageSource) {
    let map = this.temporalSamples.get(clipId);
    if (!map) {
      map = new Map<number, HTMLCanvasElement>();
      this.temporalSamples.set(clipId, map);
    }
    const key = Math.round(timeSec * 60) / 60;
    const canvas = document.createElement('canvas');
    const sw = (source as HTMLVideoElement).videoWidth || (source as HTMLCanvasElement).width || 640;
    const sh = (source as HTMLVideoElement).videoHeight || (source as HTMLCanvasElement).height || 360;
    canvas.width = Math.min(1280, Math.max(2, sw));
    canvas.height = Math.min(720, Math.max(2, sh));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      map.set(key, canvas);
    }
    if (map.size > 48) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  }

  getTemporalSample(clipId: string, timeSec: number): CanvasImageSource | null {
    const map = this.temporalSamples.get(clipId);
    if (!map || map.size === 0) return null;
    const key = Math.round(timeSec * 60) / 60;
    if (map.has(key)) return map.get(key)!;
    let best: CanvasImageSource | null = null;
    let minD = 1.0;
    for (const [t, canvas] of map.entries()) {
      const d = Math.abs(t - timeSec);
      if (d < minD) {
        minD = d;
        best = canvas;
      }
    }
    return best;
  }

  clearTemporalSamples(clipId?: string) {
    if (clipId) this.temporalSamples.delete(clipId);
    else this.temporalSamples.clear();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify = () => this.listeners.forEach((fn) => fn());

  getImage(url: string): HTMLImageElement {
    let img = this.images.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.addEventListener('load', this.notify);
      img.src = url;
      this.images.set(url, img);
    }
    return img;
  }

  getVideo(clipId: string, url: string): HTMLVideoElement {
    let video = this.videos.get(clipId);
    if (!video || video.dataset.srcUrl !== url) {
      if (video) {
        video.pause();
        video.src = '';
      }
      video = document.createElement('video');
      video.dataset.srcUrl = url;
      video.playsInline = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.addEventListener('loadeddata', this.notify);
      video.addEventListener('seeked', this.notify);
      video.src = url;
      this.videos.set(clipId, video);
    }
    return video;
  }

  getAudio(clipId: string, url: string): HTMLAudioElement {
    let audio = this.audios.get(clipId);
    if (!audio || audio.dataset.srcUrl !== url) {
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      audio = document.createElement('audio');
      audio.dataset.srcUrl = url;
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      audio.src = url;
      this.audios.set(clipId, audio);
    }
    return audio;
  }

  emitChange() {
    this.notify();
  }

  pauseAll() {
    this.videos.forEach((v) => {
      if (!v.paused) v.pause();
    });
    this.audios.forEach((a) => {
      if (!a.paused) a.pause();
    });
  }

  dispose() {
    this.pauseAll();
    this.sourceEffects.dispose();
    this.clearTemporalSamples();
    for (const element of [...this.videos.values(), ...this.audios.values()]) {
      element.removeAttribute('src');
      element.load();
    }
    this.videos.clear();
    this.audios.clear();
    this.images.clear();
    this.listeners.clear();
  }

  cleanupMissingClips(activeClipIds: Set<string>) {
    for (const [id, vid] of this.videos.entries()) {
      if (!activeClipIds.has(id)) {
        vid.pause();
        vid.src = '';
        this.videos.delete(id);
      }
    }
    for (const [id, aud] of this.audios.entries()) {
      if (!activeClipIds.has(id)) {
        aud.pause();
        aud.src = '';
        this.audios.delete(id);
      }
    }
    for (const id of this.temporalSamples.keys()) {
      if (!activeClipIds.has(id)) {
        this.temporalSamples.delete(id);
      }
    }
  }
}

function drawAmbientCinemaFX(
  ctx: CanvasRenderingContext2D,
  kind: 'rain-neon' | 'sunbeams' | 'dust-bokeh' | 'none',
  w: number,
  h: number,
  time: number
) {
  if (kind === 'none') return;
  ctx.save();
  if (kind === 'rain-neon') {
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.22)';
    ctx.lineWidth = Math.max(1, w * 0.0012);
    for (let i = 0; i < 42; i++) {
      const seed = i * 97.31;
      const rx = ((seed * 13.7 + time * 190) % (w + 120)) - 60;
      const ry = ((seed * 29.1 + time * 880) % (h + 160)) - 80;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 14, ry + 56);
      ctx.stroke();
    }
    const flareAlpha = 0.12 + 0.05 * Math.sin(time * 2.6);
    const flare = ctx.createLinearGradient(0, h * 0.48, w, h * 0.52);
    flare.addColorStop(0, 'rgba(56, 189, 248, 0)');
    flare.addColorStop(0.5, `rgba(56, 189, 248, ${flareAlpha})`);
    flare.addColorStop(1, 'rgba(244, 114, 182, 0)');
    ctx.fillStyle = flare;
    ctx.fillRect(0, h * 0.45, w, h * 0.08);
  } else if (kind === 'sunbeams') {
    const pulse = 0.14 + 0.05 * Math.sin(time * 1.4);
    const grad = ctx.createRadialGradient(
      w * (0.72 + 0.03 * Math.sin(time * 0.7)),
      h * 0.18,
      10,
      w * 0.72,
      h * 0.18,
      w * 0.75
    );
    grad.addColorStop(0, `rgba(254, 243, 199, ${pulse * 1.6})`);
    grad.addColorStop(0.45, `rgba(251, 191, 36, ${pulse * 0.55})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (kind === 'dust-bokeh') {
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 18; i++) {
      const s = i * 53.7;
      const bx = (s * 41.3 + Math.sin(time * 0.5 + i) * 45 + time * 18) % w;
      const by = (s * 19.7 + Math.cos(time * 0.4 + i) * 35) % h;
      const radius = w * 0.008 + (i % 5) * (w * 0.006);
      const alpha = 0.05 + 0.04 * Math.sin(time * 1.8 + i);
      ctx.fillStyle = i % 2 === 0 ? `rgba(251, 191, 36, ${alpha})` : `rgba(56, 189, 248, ${alpha})`;
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function syncMediaPlayback(
  pool: MediaElementPool,
  tracks: Track[],
  clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  currentTime: number,
  isPlaying: boolean,
  cachedVisual = false
) {
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  for (const clip of clips) {
    if (clip.enabled === false) continue;
    if (!clip.mediaId || (clip.type !== 'video' && clip.type !== 'audio')) continue;
    const asset = assetsMap.get(clip.mediaId);
    const track = trackMap.get(clip.trackId);
    if (!asset || !track) continue;
    const element =
      clip.type === 'video'
        ? pool.getVideo(clip.id, asset.url)
        : pool.getAudio(clip.id, asset.url);
    const localTime = currentTime - clip.startTime;
    if (localTime < 0 || localTime >= clip.duration || (track.hidden && clip.type === 'video')) {
      element.pause();
      continue;
    }
    const rate = getClipPlaybackRate(clip, localTime);
    const forward = rate >= 0.0625 && rate <= 16;
    const fadeIn = clip.fadeIn > 0 ? Math.min(1, localTime / clip.fadeIn) : 1;
    const fadeOut = clip.fadeOut > 0 ? Math.min(1, (clip.duration - localTime) / clip.fadeOut) : 1;
    const volume =
      !forward || track.muted || clip.muted
        ? 0
        : clamp(((clip.volume / 100) * fadeIn * fadeOut), 0, 1);
    element.volume = volume;
    element.muted = volume === 0;
    if (cachedVisual && clip.type === 'video' && volume === 0) {
      element.pause();
      continue;
    }
    const sourceDuration = Number.isFinite(element.duration) ? element.duration : asset.duration;
    const target = clamp(getClipSourceTime(clip, localTime), 0, Math.max(0, sourceDuration - 0.001));
    const shouldPlay = isPlaying && forward;
    const tolerance = shouldPlay ? (clip.timeRemap?.enabled ? 0.1 : 0.18) : 0.0005;
    if (!shouldPlay && !element.paused) element.pause();
    if (!element.seeking && Math.abs(element.currentTime - target) > tolerance) {
      try {
        element.currentTime = target;
      } catch {
        // Metadata may still be loading.
      }
    }
    if (shouldPlay) {
      try {
        element.playbackRate = clamp(rate, 0.0625, 16);
      } catch {
        element.playbackRate = 1;
      }
      if (element.paused && element.readyState >= 2) element.play().catch(() => {});
    }
  }
}

interface TransitionComputed {
  alpha: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  blur: number;
  flash: number;
  wipeProgress: number | null; // 0..1 reveal left-to-right
  irisProgress: number | null; // 0..1 circular reveal
  sweepProgress: number | null; // 0..1 light sweep bar
  glitchStrength: number; // 0..1
}

function evaluateClipTransitions(
  clip: TimelineClip,
  relTime: number,
  remTime: number,
  canvasWidth: number,
  canvasHeight: number
): TransitionComputed {
  const out: TransitionComputed = {
    alpha: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    blur: 0,
    flash: 0,
    wipeProgress: null,
    irisProgress: null,
    sweepProgress: null,
    glitchStrength: 0,
  };

  const applyOne = (type: TimelineClip['transitionIn'], rawP: number, dir: 1 | -1) => {
    const p = clamp(rawP, 0, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    const smoothS = p * p * (3 - 2 * p);
    switch (type) {
      case 'fade':
        out.alpha *= ease;
        break;
      case 'dissolve':
        out.alpha *= smoothS;
        break;
      case 'zoom':
        out.alpha *= ease;
        out.scale *= dir === 1 ? 0.82 + 0.18 * ease : 1 + (1 - ease) * 0.18;
        break;
      case 'slide-left':
        out.alpha *= Math.min(1, p * 2);
        out.offsetX += dir * (1 - ease) * canvasWidth * 0.35;
        break;
      case 'push-left':
        out.offsetX += dir * (1 - ease) * canvasWidth;
        break;
      case 'whip-pan':
        out.offsetX += dir * (1 - ease) * canvasWidth * 0.85;
        out.blur += (1 - ease) * 26;
        break;
      case 'slide-up':
        out.alpha *= Math.min(1, p * 2);
        out.offsetY += dir * (1 - ease) * canvasHeight * 0.28;
        break;
      case 'wipe-right':
        out.wipeProgress = out.wipeProgress === null ? smoothS : Math.min(out.wipeProgress, smoothS);
        break;
      case 'iris-shape':
        out.irisProgress = out.irisProgress === null ? ease : Math.min(out.irisProgress, ease);
        break;
      case 'light-sweep':
        out.alpha *= Math.min(1, 0.25 + ease * 0.75);
        out.sweepProgress = p;
        break;
      case 'glitch':
        out.glitchStrength = Math.max(out.glitchStrength, 1 - ease);
        out.alpha *= Math.min(1, 0.35 + p * 0.85);
        break;
      case 'blur':
        out.alpha *= ease;
        out.blur += (1 - ease) * 14;
        break;
      case 'flash':
        out.flash = Math.max(out.flash, (1 - ease) * 0.85);
        break;
    }
  };

  if (clip.transitionIn !== 'none' && clip.transitionInDuration > 0 && relTime < clip.transitionInDuration) {
    applyOne(clip.transitionIn, relTime / clip.transitionInDuration, 1);
  }
  if (clip.transitionOut !== 'none' && clip.transitionOutDuration > 0 && remTime < clip.transitionOutDuration) {
    applyOne(clip.transitionOut, remTime / clip.transitionOutDuration, -1);
  }
  return out;
}

/**
 * Renders a single clip onto `dctx` and returns its screen-space bounds if interactive.
 */
function renderSingleVisualClip(
  dctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  allClipsMap: Map<string, TimelineClip>,
  _tracks: Track[],
  _clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  pool: MediaElementPool,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
  fps: number,
  audioLevel: number,
  options?: RenderCompositionOptions
): RenderedClipBounds | null {
  const relTime = currentTime - clip.startTime;
  const remTime = clip.duration - relTime;
  const sourceTime = getClipSourceTime(clip, relTime);
  const progress = clip.timeRemap?.enabled
    ? clamp(
        (sourceTime - clip.timeRemap.sourceStart) /
          Math.max(0.001, clip.timeRemap.sourceEnd - clip.timeRemap.sourceStart),
        0,
        1
      )
    : clamp(relTime / Math.max(0.01, clip.duration), 0, 1);

  const trans = evaluateClipTransitions(clip, relTime, remTime, canvasWidth, canvasHeight);

  // Motion Preset (Ken Burns)
  let motionScale = 1;
  let motionX = 0;
  if (clip.motionPreset === 'zoom-in') motionScale = 1 + 0.13 * progress;
  else if (clip.motionPreset === 'zoom-out') motionScale = 1.14 - 0.14 * progress;
  else if (clip.motionPreset === 'pan-right') {
    motionScale = 1.12;
    motionX = (-0.05 + 0.1 * progress) * canvasWidth;
  } else if (clip.motionPreset === 'pan-left') {
    motionScale = 1.12;
    motionX = (0.05 - 0.1 * progress) * canvasWidth;
  }

  const world = resolveWorldTransform(
    clip,
    allClipsMap,
    canvasWidth,
    canvasHeight,
    currentTime,
    fps,
    audioLevel
  );
  const anim = resolveClipAnimation(clip, currentTime, fps, 1, audioLevel);

  const finalAlpha = clamp(world.opacityFactor * trans.alpha, 0, 1);

  const centerX = world.xPx + trans.offsetX + motionX;
  const centerY = world.yPx + trans.offsetY;
  const scaleXTotal = world.scaleX * trans.scale * motionScale;
  const scaleYTotal = world.scaleY * trans.scale * motionScale;

  // Null / Camera / Light controllers: invisible in final render, expose interactive handles
  if (clip.type === 'null' || clip.type === 'camera' || clip.type === 'light') {
    const size = clip.type === 'camera' ? 36 : clip.type === 'light' ? 32 : 28;
    return {
      clipId: clip.id,
      x: centerX - size,
      y: centerY - size,
      width: size * 2,
      height: size * 2,
      centerX,
      centerY,
    };
  }

  if (finalAlpha <= 0.002) return null;

  const activeEffects = (clip.effects || []).filter((effect) => effect.enabled);
  const hasMasks = !!clip.masks?.some((m) => m.enabled);
  const hasSpecialTrans =
    trans.wipeProgress !== null ||
    trans.irisProgress !== null ||
    trans.glitchStrength > 0.01;
  const blend = clip.blendMode && clip.blendMode !== 'source-over' ? clip.blendMode : null;

  // Adjustment Layer: processes the entire accumulated composition underneath it!
  if (clip.type === 'adjustment') {
    const depthKey = `adj-${options?.depth || 0}`;
    const adjCtx = getStageCanvas(depthKey, canvasWidth, canvasHeight);
    const f = clip.filters;
    const totalBlur = (f.blur + trans.blur) * (canvasHeight / 720);
    const filterParts: string[] = [];
    if (f.brightness !== 100) filterParts.push(`brightness(${f.brightness}%)`);
    if (f.contrast !== 100) filterParts.push(`contrast(${f.contrast}%)`);
    if (f.saturation !== 100) filterParts.push(`saturate(${f.saturation}%)`);
    if (f.hue !== 0) filterParts.push(`hue-rotate(${f.hue}deg)`);
    if (totalBlur > 0.05) filterParts.push(`blur(${totalBlur.toFixed(1)}px)`);
    if (filterParts.length > 0) adjCtx.filter = filterParts.join(' ');
    adjCtx.drawImage(dctx.canvas, 0, 0);
    adjCtx.filter = 'none';

    if (Math.abs(f.temperature) > 1) {
      adjCtx.globalCompositeOperation = 'soft-light';
      const tempAlpha = Math.min(0.42, Math.abs(f.temperature) / 220);
      adjCtx.fillStyle =
        f.temperature > 0
          ? `rgba(251, 146, 60, ${tempAlpha})`
          : `rgba(56, 189, 248, ${tempAlpha})`;
      adjCtx.fillRect(0, 0, canvasWidth, canvasHeight);
      adjCtx.globalCompositeOperation = 'source-over';
    }

    if (activeEffects.length > 0) {
      const adjEffectCtx: EffectRenderContext = {
        currentTime,
        fps,
        duration: clip.duration,
        audioLevel,
        originalSource: dctx.canvas,
        sampleSourceFrame: () => dctx.canvas,
      };
      applyEffectChain(adjCtx, canvasWidth, canvasHeight, activeEffects, relTime, clipSeed(clip.id), adjEffectCtx);
    }
    if (hasMasks && clip.masks) {
      applyLayerMasksToCanvas(
        adjCtx,
        canvasWidth,
        canvasHeight,
        clip.masks,
        anim.maskFeather,
        anim.maskExpansion
      );
    }

    dctx.save();
    dctx.globalAlpha = finalAlpha;
    if (blend) dctx.globalCompositeOperation = blend;
    dctx.drawImage(adjCtx.canvas, 0, 0);
    dctx.restore();

    return {
      clipId: clip.id,
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      centerX: canvasWidth / 2,
      centerY: canvasHeight / 2,
    };
  }

  const needsIsolation =
    activeEffects.length > 0 || hasMasks || hasSpecialTrans || !!blend;
  const isoCtx = needsIsolation
    ? getStageCanvas(`layer-${options?.depth || 0}`, canvasWidth, canvasHeight)
    : null;
  const targetCtx = isoCtx || dctx;

  let boundsOut: RenderedClipBounds | null = null;

  const applySpatialTransform = (c: CanvasRenderingContext2D) => {
    c.translate(centerX, centerY);
    c.rotate(world.rotationRad);
    if (Math.abs(world.skewRad) > 0.001) {
      c.transform(1, 0, Math.tan(world.skewRad), 1, 0, 0);
    }
    c.scale(
      scaleXTotal * (clip.flipH ? -1 : 1),
      scaleYTotal * (clip.flipV ? -1 : 1)
    );
    if (world.anchorOffsetXPx !== 0 || world.anchorOffsetYPx !== 0) {
      c.translate(-world.anchorOffsetXPx, -world.anchorOffsetYPx);
    }
  };

  const applyTransformAtTime = (c: CanvasRenderingContext2D, t: number) => {
    const smWorld = resolveWorldTransform(clip, allClipsMap, canvasWidth, canvasHeight, t, fps, audioLevel);
    const smCx = smWorld.xPx + trans.offsetX + motionX;
    const smCy = smWorld.yPx + trans.offsetY;
    const smSx = smWorld.scaleX * trans.scale * motionScale;
    const smSy = smWorld.scaleY * trans.scale * motionScale;
    c.translate(smCx, smCy);
    c.rotate(smWorld.rotationRad);
    if (Math.abs(smWorld.skewRad) > 0.001) {
      c.transform(1, 0, Math.tan(smWorld.skewRad), 1, 0, 0);
    }
    c.scale(smSx * (clip.flipH ? -1 : 1), smSy * (clip.flipV ? -1 : 1));
    if (smWorld.anchorOffsetXPx !== 0 || smWorld.anchorOffsetYPx !== 0) {
      c.translate(-smWorld.anchorOffsetXPx, -smWorld.anchorOffsetYPx);
    }
  };

  const renderLayerGraphic = (c: CanvasRenderingContext2D, drawItem: () => void) => {
    const drawWithShadow = () => {
      if (clip.dropShadow?.enabled && anim.dropShadowOpacity > 0) {
        c.save();
        const radAngle = ((clip.dropShadow.angle ?? 45) * Math.PI) / 180;
        const dist = anim.dropShadowDistance * (canvasHeight / 720);
        c.shadowColor = clip.dropShadow.color || 'rgba(0,0,0,0.7)';
        c.shadowBlur = anim.dropShadowBlur * (canvasHeight / 720);
        c.shadowOffsetX = dist * Math.cos(radAngle);
        c.shadowOffsetY = dist * Math.sin(radAngle);
        c.globalAlpha = (c.globalAlpha || 1) * (anim.dropShadowOpacity / 100);
        drawItem();
        c.restore();
      }
      drawItem();
    };

    if (!clip.motionBlur) {
      applySpatialTransform(c);
      drawWithShadow();
      return;
    }

    const shutterAngle = clip.shutterAngle !== undefined ? clip.shutterAngle : 180;
    const shutterSec = (shutterAngle / 360) / fps;
    const samples = clip.motionBlurSamples ? Math.max(4, Math.min(32, clip.motionBlurSamples)) : 8;

    const dt0 = currentTime - shutterSec * 0.5;
    const dt1 = currentTime + shutterSec * 0.5;
    const w0 = resolveWorldTransform(clip, allClipsMap, canvasWidth, canvasHeight, dt0, fps, audioLevel);
    const w1 = resolveWorldTransform(clip, allClipsMap, canvasWidth, canvasHeight, dt1, fps, audioLevel);
    const moved =
      Math.hypot(w1.xPx - w0.xPx, w1.yPx - w0.yPx) > 0.5 ||
      Math.abs(w1.rotationRad - w0.rotationRad) > 0.005 ||
      Math.abs(w1.scaleX - w0.scaleX) > 0.005;
    if (!moved) {
      applySpatialTransform(c);
      drawWithShadow();
      return;
    }

    for (let m = 0; m < samples; m++) {
      const u = m / (samples - 1) - 0.5; // -0.5 to 0.5
      const smT = currentTime + u * shutterSec;
      const weight = Math.cos(u * Math.PI);
      c.save();
      c.globalAlpha = (c.globalAlpha || 1) * Math.min(1, Math.max(0.04, weight / (samples * 0.636)));
      applyTransformAtTime(c, smT);
      drawWithShadow();
      c.restore();
    }
  };

  if (clip.type === 'solid') {
    targetCtx.save();
    targetCtx.globalAlpha = finalAlpha;
    targetCtx.fillStyle = clip.solidColor || '#2563eb';
    renderLayerGraphic(targetCtx, () => {
      targetCtx.fillRect(-canvasWidth / 2, -canvasHeight / 2, canvasWidth, canvasHeight);
    });
    targetCtx.restore();
    const sw = canvasWidth * Math.abs(scaleXTotal);
    const sh = canvasHeight * Math.abs(scaleYTotal);
    boundsOut = {
      clipId: clip.id,
      x: centerX - sw / 2,
      y: centerY - sh / 2,
      width: sw,
      height: sh,
      centerX,
      centerY,
    };
  } else if (clip.type === 'shape' && clip.shapeData) {
    targetCtx.save();
    targetCtx.globalAlpha = finalAlpha;
    const f = clip.filters;
    const totalBlur = (f.blur + trans.blur) * (canvasHeight / 720);
    const filterParts: string[] = [];
    if (f.brightness !== 100) filterParts.push(`brightness(${f.brightness}%)`);
    if (f.contrast !== 100) filterParts.push(`contrast(${f.contrast}%)`);
    if (f.saturation !== 100) filterParts.push(`saturate(${f.saturation}%)`);
    if (f.hue !== 0) filterParts.push(`hue-rotate(${f.hue}deg)`);
    if (totalBlur > 0.05) filterParts.push(`blur(${totalBlur.toFixed(1)}px)`);
    if (filterParts.length > 0) targetCtx.filter = filterParts.join(' ');

    applySpatialTransform(targetCtx);
    const box = renderVectorShapeLayer(targetCtx, clip.shapeData, canvasWidth, canvasHeight, {
      trimStart: anim.trimStartPct,
      trimEnd: anim.trimEndPct,
      strokeWidth: anim.strokeWidth,
      strokeDashOffset: anim.strokeDashOffset,
    });
    targetCtx.restore();

    const bw = box.width * Math.abs(scaleXTotal);
    const bh = box.height * Math.abs(scaleYTotal);
    boundsOut = {
      clipId: clip.id,
      x: centerX - bw / 2,
      y: centerY - bh / 2,
      width: bw,
      height: bh,
      centerX,
      centerY,
    };
  } else if (clip.type === 'precomp' && clip.precompId && (options?.depth || 0) < 4) {
    const subComp = options?.compositions?.find((c) => c.id === clip.precompId);
    if (subComp) {
      const subDepth = (options?.depth || 0) + 1;
      const subCtx = getStageCanvas(`precomp-${subDepth}`, canvasWidth, canvasHeight);
      renderFrameToCanvas(
        subCtx,
        canvasWidth,
        canvasHeight,
        subComp.tracks,
        subComp.clips,
        assetsMap,
        pool,
        sourceTime,
        {
          backgroundColor: subComp.backgroundColor,
          transparentBg: subComp.transparentBg !== false,
          fps: subComp.fps,
          compositions: options?.compositions,
          depth: subDepth,
        }
      );

      targetCtx.save();
      targetCtx.globalAlpha = finalAlpha;
      applySpatialTransform(targetCtx);
      targetCtx.drawImage(subCtx.canvas, -canvasWidth / 2, -canvasHeight / 2, canvasWidth, canvasHeight);
      targetCtx.restore();

      const pw = canvasWidth * Math.abs(scaleXTotal);
      const ph = canvasHeight * Math.abs(scaleYTotal);
      boundsOut = {
        clipId: clip.id,
        x: centerX - pw / 2,
        y: centerY - ph / 2,
        width: pw,
        height: ph,
        centerX,
        centerY,
      };
    }
  } else if ((clip.type === 'video' || clip.type === 'image') && clip.mediaId) {
    const asset = assetsMap.get(clip.mediaId);
    if (asset) {
      let drawable: HTMLVideoElement | HTMLImageElement | null = null;
      let srcW = asset.width || 1280;
      let srcH = asset.height || 720;

      if (clip.type === 'video') {
        const overridden = options?.frameOverride?.get(clip.id);
        if (overridden) {
          drawable = overridden as HTMLVideoElement;
          srcW = (overridden as HTMLCanvasElement).width || srcW;
          srcH = (overridden as HTMLCanvasElement).height || srcH;
        } else {
        const vid = pool.getVideo(clip.id, asset.url);
        if (vid.readyState >= 2) {
          drawable = vid;
          srcW = vid.videoWidth || srcW;
          srcH = vid.videoHeight || srcH;
        } else if (asset.thumbnail) {
          const thumb = pool.getImage(asset.thumbnail);
          if (thumb.complete && thumb.naturalWidth > 0) drawable = thumb;
        }
        }
      } else {
        const img = pool.getImage(asset.url);
        if (img.complete && img.naturalWidth > 0) {
          drawable = img;
          srcW = img.naturalWidth;
          srcH = img.naturalHeight;
        }
      }

      if (drawable) {
        let processedSource: CanvasImageSource = pool.sourceEffects.process(
          drawable, srcW, srcH, clip, sourceTime, Math.max(canvasWidth, canvasHeight)
        );
        // Puppet Pins deformam a fonte 2D antes do posicionamento na composição
        if (clip.puppetPins && clip.puppetPins.length > 0) {
          const pw = processedSource instanceof HTMLCanvasElement ? processedSource.width : srcW;
          const ph = processedSource instanceof HTMLCanvasElement ? processedSource.height : srcH;
          processedSource = applyPuppetPinDeformation(processedSource, pw, ph, clip.puppetPins);
        }
        const scaleFactor =
          clip.fitMode === 'cover'
            ? Math.max(canvasWidth / srcW, canvasHeight / srcH)
            : Math.min(canvasWidth / srcW, canvasHeight / srcH);

        const drawW = srcW * scaleFactor;
        const drawH = srcH * scaleFactor;

        targetCtx.save();
        targetCtx.globalAlpha = finalAlpha;

        const f = clip.filters;
        const totalBlur = (f.blur + trans.blur + (clip.motionBlur ? 2.5 : 0)) * (canvasHeight / 720);
        const filterParts: string[] = [];
        if (f.brightness !== 100) filterParts.push(`brightness(${f.brightness}%)`);
        if (f.contrast !== 100) filterParts.push(`contrast(${f.contrast}%)`);
        if (f.saturation !== 100) filterParts.push(`saturate(${f.saturation}%)`);
        if (f.hue !== 0) filterParts.push(`hue-rotate(${f.hue}deg)`);
        if (totalBlur > 0.05) filterParts.push(`blur(${totalBlur.toFixed(1)}px)`);
        if (filterParts.length > 0) {
          targetCtx.filter = filterParts.join(' ');
        }

        renderLayerGraphic(targetCtx, () => {
          targetCtx.drawImage(processedSource, -drawW / 2, -drawH / 2, drawW, drawH);
        });

        if (clip.ambientFX && clip.ambientFX !== 'none') {
          targetCtx.filter = 'none';
          targetCtx.save();
          targetCtx.translate(-drawW / 2, -drawH / 2);
          drawAmbientCinemaFX(targetCtx, clip.ambientFX, drawW, drawH, sourceTime);
          targetCtx.restore();
        }

        if (Math.abs(f.temperature) > 1) {
          targetCtx.filter = 'none';
          targetCtx.globalCompositeOperation = 'soft-light';
          const tempAlpha = Math.min(0.42, Math.abs(f.temperature) / 220);
          targetCtx.fillStyle =
            f.temperature > 0
              ? `rgba(251, 146, 60, ${tempAlpha})`
              : `rgba(56, 189, 248, ${tempAlpha})`;
          targetCtx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
          targetCtx.globalCompositeOperation = 'source-over';
        }

        targetCtx.restore();

        if (f.vignette > 1) {
          targetCtx.save();
          const vigStrength = Math.min(0.88, (f.vignette / 100) * 0.85) * finalAlpha;
          const rad = targetCtx.createRadialGradient(
            canvasWidth / 2,
            canvasHeight / 2,
            Math.min(canvasWidth, canvasHeight) * 0.28,
            canvasWidth / 2,
            canvasHeight / 2,
            Math.max(canvasWidth, canvasHeight) * 0.72
          );
          rad.addColorStop(0, 'rgba(0,0,0,0)');
          rad.addColorStop(1, `rgba(0,0,0,${vigStrength})`);
          targetCtx.fillStyle = rad;
          targetCtx.fillRect(0, 0, canvasWidth, canvasHeight);
          targetCtx.restore();
        }

        if (trans.flash > 0.01) {
          targetCtx.save();
          targetCtx.fillStyle = `rgba(255,255,255,${trans.flash})`;
          targetCtx.fillRect(0, 0, canvasWidth, canvasHeight);
          targetCtx.restore();
        }

        const scaledW = drawW * Math.abs(world.scaleX);
        const scaledH = drawH * Math.abs(world.scaleY);
        boundsOut = {
          clipId: clip.id,
          x: centerX - scaledW / 2,
          y: centerY - scaledH / 2,
          width: scaledW,
          height: scaledH,
          centerX,
          centerY,
        };
      }
    }
  } else if (clip.type === 'svg' && clip.mediaId) {
    const asset = assetsMap.get(clip.mediaId);
    if (asset) {
      const img = pool.getImage(asset.url);
      if (img.complete && img.naturalWidth > 0) {
        const svgW = img.naturalWidth || 800;
        const svgH = img.naturalHeight || 600;
        const scaleFactor =
          clip.fitMode === 'cover'
            ? Math.max(canvasWidth / svgW, canvasHeight / svgH)
            : Math.min(canvasWidth / svgW, canvasHeight / svgH);
        const drawW = svgW * scaleFactor;
        const drawH = svgH * scaleFactor;
        targetCtx.save();
        targetCtx.globalAlpha = finalAlpha;
        renderLayerGraphic(targetCtx, () => {
          targetCtx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        });
        targetCtx.restore();
        const scaledW = drawW * Math.abs(world.scaleX);
        const scaledH = drawH * Math.abs(world.scaleY);
        boundsOut = {
          clipId: clip.id,
          x: centerX - scaledW / 2,
          y: centerY - scaledH / 2,
          width: scaledW,
          height: scaledH,
          centerX,
          centerY,
        };
      }
    }
  } else if (clip.type === 'lottie') {
    let parsed = clip.lottieData?.parsedData || null;
    if (!parsed && clip.lottieData?.jsonString) {
      parsed = parseLottieJson(clip.lottieData.jsonString);
    }
    if (!parsed && clip.mediaId) {
      const asset = assetsMap.get(clip.mediaId);
      if (asset?.lottieJson) parsed = parseLottieJson(asset.lottieJson);
    }
    if (parsed) {
      const speed = clip.lottieData?.speed ?? 1;
      const lottieCanvas = renderLottieFrame(parsed, relTime * speed, canvasWidth, canvasHeight);
      targetCtx.save();
      targetCtx.globalAlpha = finalAlpha;
      renderLayerGraphic(targetCtx, () => {
        targetCtx.drawImage(lottieCanvas, -canvasWidth / 2, -canvasHeight / 2, canvasWidth, canvasHeight);
      });
      targetCtx.restore();
      const lw = canvasWidth * Math.abs(world.scaleX);
      const lh = canvasHeight * Math.abs(world.scaleY);
      boundsOut = {
        clipId: clip.id,
        x: centerX - lw / 2,
        y: centerY - lh / 2,
        width: lw,
        height: lh,
        centerX,
        centerY,
      };
    }
  } else if (clip.type === 'model3d') {
    if (studioThreeEngine.isSupported) {
      const allClips = [...allClipsMap.values()];
      const activeCamera = allClips.find(
        (c) =>
          c.type === 'camera' &&
          c.enabled !== false &&
          currentTime >= c.startTime &&
          currentTime < c.startTime + c.duration
      );
      const activeLights = allClips.filter(
        (c) =>
          c.type === 'light' &&
          c.enabled !== false &&
          currentTime >= c.startTime &&
          currentTime < c.startTime + c.duration
      );
      // Garante carregamento do GLB e redesenha quando pronto
      const modelUrl = clip.model3dData?.modelUrl;
      if (clip.model3dData?.geometry === 'custom' && modelUrl && !studioThreeEngine.isModelCached(modelUrl)) {
        void studioThreeEngine.loadGlbModel(modelUrl).then(() => pool.emitChange());
      }
      const threeCanvas = studioThreeEngine.render3DScene(
        [clip],
        allClipsMap,
        canvasWidth,
        canvasHeight,
        currentTime,
        fps,
        activeCamera,
        activeLights
      );
      if (threeCanvas) {
        targetCtx.save();
        targetCtx.globalAlpha = finalAlpha;
        targetCtx.drawImage(threeCanvas, 0, 0, canvasWidth, canvasHeight);
        targetCtx.restore();
        // Real projected bounds of the model (falls back to a centered box).
        const sb = studioThreeEngine.lastBounds;
        if (sb && threeCanvas.width > 0 && threeCanvas.height > 0) {
          const sx = canvasWidth / threeCanvas.width;
          const sy = canvasHeight / threeCanvas.height;
          boundsOut = {
            clipId: clip.id,
            x: sb.x * sx,
            y: sb.y * sy,
            width: sb.width * sx,
            height: sb.height * sy,
            centerX: (sb.x + sb.width / 2) * sx,
            centerY: (sb.y + sb.height / 2) * sy,
          };
        } else {
          const mw = canvasWidth * 0.6;
          const mh = canvasHeight * 0.6;
          boundsOut = {
            clipId: clip.id,
            x: centerX - mw / 2,
            y: centerY - mh / 2,
            width: mw,
            height: mh,
            centerX,
            centerY,
          };
        }
      }
    }
  } else if (clip.type === 'text' && clip.textStyle) {
    const ts = clip.textStyle;
    const scaleRatio = canvasHeight / 720;
    const fontSize = Math.max(12, ts.fontSize * scaleRatio);

    let animAlpha = 1;
    let animY = 0;
    let animScale = 1;
    let visibleCharsRatio = 1;
    let extraGlow = 0;
    let trackingBonus = 0;

    if (ts.animation === 'fade-up' && relTime < 0.55) {
      const p = relTime / 0.55;
      const ease = 1 - Math.pow(1 - p, 3);
      animAlpha = ease;
      animY = (1 - ease) * 32 * scaleRatio;
    } else if (ts.animation === 'pop' && relTime < 0.4) {
      const p = relTime / 0.4;
      animScale = p < 0.7 ? 0.6 + (p / 0.7) * 0.5 : 1.1 - ((p - 0.7) / 0.3) * 0.1;
      animAlpha = Math.min(1, p * 2.2);
    } else if (ts.animation === 'typewriter' && relTime < Math.min(1.4, clip.duration * 0.65)) {
      visibleCharsRatio = Math.max(0.05, relTime / Math.min(1.4, clip.duration * 0.65));
    } else if (ts.animation === 'tracking-in' && relTime < 0.75) {
      const p = 1 - Math.pow(1 - relTime / 0.75, 3);
      animAlpha = p;
      trackingBonus = (1 - p) * 28;
    } else if (ts.animation === 'mask-reveal' && relTime < 0.65) {
      const p = 1 - Math.pow(1 - relTime / 0.65, 3);
      animY = (1 - p) * fontSize * 1.25;
      animAlpha = Math.min(1, p * 1.4);
    } else if (ts.animation === 'glow') {
      extraGlow = 10 + 8 * Math.sin(currentTime * 4);
    }

    const rawContent = ts.uppercase ? ts.text.toUpperCase() : ts.text;
    const slicedContent =
      visibleCharsRatio < 1
        ? rawContent.slice(0, Math.ceil(rawContent.length * visibleCharsRatio))
        : rawContent;
    const lines = (slicedContent || ' ').split('\n');
    const effLetterSpacing = (anim.letterSpacing + trackingBonus) * scaleRatio;

    targetCtx.save();
    targetCtx.globalAlpha = clamp(finalAlpha * animAlpha, 0, 1);
    targetCtx.translate(centerX, centerY + animY);
    targetCtx.rotate(world.rotationRad);
    if (Math.abs(world.skewRad) > 0.001) {
      targetCtx.transform(1, 0, Math.tan(world.skewRad), 1, 0, 0);
    }
    targetCtx.scale(
      scaleXTotal * animScale * (clip.flipH ? -1 : 1),
      scaleYTotal * animScale * (clip.flipV ? -1 : 1)
    );
    if (world.anchorOffsetXPx !== 0 || world.anchorOffsetYPx !== 0) {
      targetCtx.translate(-world.anchorOffsetXPx, -world.anchorOffsetYPx);
    }

    targetCtx.font = `${ts.fontWeight} ${fontSize}px "${ts.fontFamily}", Inter, sans-serif`;
    targetCtx.textBaseline = 'middle';

    const lineHeight = fontSize * (ts.lineHeightMultiplier || 1.24);
    const measuredWidths = lines.map(
      (l) => targetCtx.measureText(l).width + Math.max(0, l.length - 1) * effLetterSpacing
    );
    const maxLineW = Math.max(40, ...measuredWidths);
    const totalTextH = lines.length * lineHeight;
    const padX = fontSize * 0.55;
    const padY = fontSize * 0.34;
    const boxW = maxLineW + padX * 2;
    const boxH = totalTextH + padY * 2;

    if (ts.backgroundOpacity > 0) {
      targetCtx.save();
      targetCtx.globalAlpha = clamp(finalAlpha * animAlpha * (ts.backgroundOpacity / 100), 0, 1);
      targetCtx.fillStyle = ts.backgroundColor;
      const r = Math.min(boxH / 2, ts.borderRadius * scaleRatio);
      targetCtx.beginPath();
      targetCtx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, r);
      targetCtx.fill();
      targetCtx.restore();
    }

    if (ts.shadowBlur > 0 || extraGlow > 0) {
      targetCtx.shadowColor = extraGlow > 0 ? ts.strokeColor || '#38bdf8' : 'rgba(0,0,0,0.78)';
      targetCtx.shadowBlur = (ts.shadowBlur + extraGlow) * scaleRatio;
      targetCtx.shadowOffsetY = extraGlow > 0 ? 0 : 3 * scaleRatio;
    }

    if (ts.useGradient && ts.gradientColor2) {
      const g = targetCtx.createLinearGradient(-maxLineW / 2, 0, maxLineW / 2, 0);
      g.addColorStop(0, ts.color);
      g.addColorStop(1, ts.gradientColor2);
      targetCtx.fillStyle = g;
    } else {
      targetCtx.fillStyle = ts.color;
    }
    targetCtx.strokeStyle = ts.strokeColor;
    targetCtx.lineWidth = ts.strokeWidth * scaleRatio * 2;
    targetCtx.lineJoin = 'round';

    const useCharAnimator =
      ts.animator?.enabled ||
      ts.animation === 'stagger-chars' ||
      ts.animation === 'stagger-words' ||
      Math.abs(ts.pathArc || 0) > 1;

    if (useCharAnimator) {
      const animator = ts.animator || {
        enabled: true,
        unit: ts.animation === 'stagger-words' ? 'word' : 'char',
        rangeStart: 0,
        rangeEnd: 100,
        offsetX: 0,
        offsetY: 36,
        scale: 70,
        rotation: 0,
        opacity: 0,
        tracking: 0,
      };
      const revealDur = Math.min(0.95, clip.duration * 0.6);
      const revealP = clamp(relTime / Math.max(0.1, revealDur), 0, 1);
      const arcAmount = (ts.pathArc || 0) * scaleRatio * 1.4;

      lines.forEach((line, lineIdx) => {
        const baseLy = -totalTextH / 2 + lineHeight * (lineIdx + 0.5);
        const tokens =
          animator.unit === 'word'
            ? line.split(/(\s+)/)
            : animator.unit === 'line'
            ? [line]
            : Array.from(line);
        const lineW = measuredWidths[lineIdx];
        let cursorX =
          ts.textAlign === 'left'
            ? -maxLineW / 2
            : ts.textAlign === 'right'
            ? maxLineW / 2 - lineW
            : -lineW / 2;

        tokens.forEach((tok, tokIdx) => {
          const tokW = targetCtx.measureText(tok).width + tok.length * effLetterSpacing;
          const unitNorm = tokens.length > 1 ? tokIdx / (tokens.length - 1) : 0;
          const localReveal = clamp((revealP * 1.5 - unitNorm * 0.65) / 0.65, 0, 1);
          const influence = 1 - (1 - Math.pow(1 - localReveal, 3));

          const normX = lineW > 1 ? (cursorX + tokW / 2) / (lineW / 2) : 0;
          const arcY = -arcAmount * (1 - normX * normX);

          targetCtx.save();
          targetCtx.globalAlpha *= clamp(
            1 * (1 - influence) + (animator.opacity / 100) * influence,
            0,
            1
          );
          targetCtx.translate(
            cursorX + tokW / 2 + animator.offsetX * scaleRatio * influence,
            baseLy + arcY + animator.offsetY * scaleRatio * influence
          );
          targetCtx.rotate(((animator.rotation * influence + normX * (ts.pathArc || 0) * 0.22) * Math.PI) / 180);
          const uScale = 1 * (1 - influence) + (animator.scale / 100) * influence;
          targetCtx.scale(uScale, uScale);
          targetCtx.textAlign = 'center';
          if (ts.strokeWidth > 0) targetCtx.strokeText(tok, 0, 0);
          targetCtx.fillText(tok, 0, 0);
          targetCtx.restore();

          cursorX += tokW;
        });
      });
    } else {
      lines.forEach((line, idx) => {
        const ly = -totalTextH / 2 + lineHeight * (idx + 0.5);
        targetCtx.textAlign = ts.textAlign;
        const lx =
          ts.textAlign === 'left'
            ? -maxLineW / 2
            : ts.textAlign === 'right'
            ? maxLineW / 2
            : 0;

        if ('letterSpacing' in targetCtx) {
          (targetCtx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${effLetterSpacing}px`;
        }

        if (ts.strokeWidth > 0) {
          targetCtx.strokeText(line, lx, ly);
        }
        targetCtx.fillText(line, lx, ly);
      });
    }

    targetCtx.restore();

    const worldW = boxW * Math.abs(scaleXTotal);
    const worldH = boxH * Math.abs(scaleYTotal);
    boundsOut = {
      clipId: clip.id,
      x: centerX - worldW / 2,
      y: centerY - worldH / 2,
      width: worldW,
      height: worldH,
      centerX,
      centerY,
    };
  }

  // Post-process isolated layer (Wipe/Iris/Glitch transitions -> Masks -> Effects -> Blend onto dctx)
  if (isoCtx) {
    if (trans.wipeProgress !== null) {
      isoCtx.save();
      isoCtx.globalCompositeOperation = 'destination-in';
      isoCtx.fillStyle = '#ffffff';
      isoCtx.fillRect(0, 0, canvasWidth * trans.wipeProgress, canvasHeight);
      isoCtx.restore();
    }
    if (trans.irisProgress !== null) {
      isoCtx.save();
      isoCtx.globalCompositeOperation = 'destination-in';
      isoCtx.fillStyle = '#ffffff';
      isoCtx.beginPath();
      const maxR = Math.hypot(canvasWidth, canvasHeight) * 0.52;
      isoCtx.arc(canvasWidth / 2, canvasHeight / 2, maxR * trans.irisProgress, 0, Math.PI * 2);
      isoCtx.fill();
      isoCtx.restore();
    }
    if (hasMasks && clip.masks) {
      applyLayerMasksToCanvas(
        isoCtx,
        canvasWidth,
        canvasHeight,
        clip.masks,
        anim.maskFeather,
        anim.maskExpansion
      );
    }
    const layerEffectCtx: EffectRenderContext = {
      currentTime,
      fps,
      duration: clip.duration,
      audioLevel,
      originalSource: isoCtx.canvas,
      sampleSourceFrame: (sampleTimeSec: number) => {
        if (clip.type === 'video' && clip.mediaId) {
          // sampleTimeSec pode ser tempo absoluto (timeline) ou offset relativo
          // ao clipe (efeitos como Force Motion Blur passam offsets pequenos).
          const isOffset = Math.abs(sampleTimeSec) < clip.duration + 1 && sampleTimeSec < clip.startTime - 0.5;
          const timelineT = isOffset ? currentTime + sampleTimeSec : sampleTimeSec;
          const sampleSourceT = getClipSourceTime(clip, timelineT - clip.startTime);
          const sample = pool.getTemporalSample(clip.id, sampleSourceT);
          if (sample) return sample;
          const vid = pool.getVideo(clip.id, assetsMap.get(clip.mediaId)!.url);
          return vid.readyState >= 2 ? vid : null;
        }
        return isoCtx.canvas;
      },
    };

    if (activeEffects.length > 0) {
      applyEffectChain(isoCtx, canvasWidth, canvasHeight, activeEffects, relTime, clipSeed(clip.id), layerEffectCtx);
    }
    if (trans.glitchStrength > 0.01) {
      applyEffectChain(
        isoCtx,
        canvasWidth,
        canvasHeight,
        [
          {
            id: 'trans-glitch',
            type: 'S_DigitalDamage',
            enabled: true,
            params: {
              amount: Math.round(trans.glitchStrength * 75),
              blocks: 14,
              shift: 45,
              rgb: Math.round(trans.glitchStrength * 24),
            },
          },
        ],
        relTime,
        clipSeed(clip.id),
        layerEffectCtx
      );
    }

    dctx.save();
    dctx.globalAlpha = 1;
    dctx.globalCompositeOperation = blend || 'source-over';
    dctx.filter = 'none';
    dctx.drawImage(isoCtx.canvas, 0, 0);
    dctx.restore();
  }

  // Optional Light Sweep transition highlight bar
  if (trans.sweepProgress !== null) {
    dctx.save();
    dctx.globalCompositeOperation = 'screen';
    const sx = -canvasWidth * 0.3 + trans.sweepProgress * canvasWidth * 1.6;
    const grad = dctx.createLinearGradient(sx - canvasWidth * 0.14, 0, sx + canvasWidth * 0.14, canvasHeight * 0.25);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,250,220,0.65)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    dctx.fillStyle = grad;
    dctx.fillRect(0, 0, canvasWidth, canvasHeight);
    dctx.restore();
  }

  return boundsOut;
}

export function renderFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  tracks: Track[],
  clips: TimelineClip[],
  assetsMap: Map<string, MediaAsset>,
  pool: MediaElementPool,
  currentTime: number,
  options?: RenderCompositionOptions
): RenderedClipBounds[] {
  const boundsList: RenderedClipBounds[] = [];
  const fps = options?.fps || 30;
  const audioLevel =
    options?.audioLevel ??
    sampleProjectAudioLevel(
      {
        projectName: '',
        aspectRatio: '16:9',
        fps: fps as 24 | 30 | 60 | 120,
        tracks,
        clips,
        markers: [],
      },
      assetsMap,
      currentTime
    );

  // Clear composition background (solid color or alpha transparency)
  ctx.save();
  if (options?.transparentBg) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  } else {
    ctx.fillStyle = options?.backgroundColor || '#000000';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }
  ctx.restore();

  const allClipsMap = new Map(clips.map((c) => [c.id, c]));

  // Tracks at bottom of list are background layers; top of list are foreground layers
  const visualTracksBottomUp = [...tracks]
    .filter((t) => !t.hidden && t.type !== 'audio')
    .reverse();

  const consumedMatteIds = new Set<string>();

  for (let tIdx = 0; tIdx < visualTracksBottomUp.length; tIdx++) {
    const track = visualTracksBottomUp[tIdx];
    const aboveTrack = visualTracksBottomUp[tIdx + 1];

    const activeClips = clips
      .filter(
        (c) =>
          c.enabled !== false &&
          c.trackId === track.id &&
          currentTime >= c.startTime &&
          currentTime < c.startTime + c.duration
      )
      .sort((a, b) => a.startTime - b.startTime);

    for (const clip of activeClips) {
      if (consumedMatteIds.has(clip.id)) continue;

      if (clip.trackMatte && clip.trackMatte !== 'none' && aboveTrack) {
        const matteClip = clips.find(
          (m) =>
            m.enabled !== false &&
            m.trackId === aboveTrack.id &&
            currentTime >= m.startTime &&
            currentTime < m.startTime + m.duration
        );
        if (matteClip) {
          consumedMatteIds.add(matteClip.id);
          const fillStage = getStageCanvas(`matte-fill-${options?.depth || 0}`, canvasWidth, canvasHeight);
          const matteStage = getStageCanvas(`matte-src-${options?.depth || 0}`, canvasWidth, canvasHeight);

          const fillBounds = renderSingleVisualClip(
            fillStage,
            clip,
            allClipsMap,
            tracks,
            clips,
            assetsMap,
            pool,
            canvasWidth,
            canvasHeight,
            currentTime,
            fps,
            audioLevel,
            options
          );
          renderSingleVisualClip(
            matteStage,
            matteClip,
            allClipsMap,
            tracks,
            clips,
            assetsMap,
            pool,
            canvasWidth,
            canvasHeight,
            currentTime,
            fps,
            audioLevel,
            options
          );

          applyTrackMatteToCanvas(
            fillStage,
            matteStage.canvas,
            canvasWidth,
            canvasHeight,
            clip.trackMatte
          );

          ctx.save();
          ctx.globalCompositeOperation = clip.blendMode || 'source-over';
          ctx.drawImage(fillStage.canvas, 0, 0);
          ctx.restore();

          if (fillBounds) boundsList.push(fillBounds);
          continue;
        }
      }

      const b = renderSingleVisualClip(
        ctx,
        clip,
        allClipsMap,
        tracks,
        clips,
        assetsMap,
        pool,
        canvasWidth,
        canvasHeight,
        currentTime,
        fps,
        audioLevel,
        options
      );
      if (b) boundsList.push(b);
    }
  }

  return boundsList;
}

export interface VideoExportOptions {
  range?: WorkArea;
  fpsOverride?: 24 | 30 | 60 | 120;
  bitrateMbps?: number;
  /** Suavização de clipes de baixa taxa: 'off' | 'flow' (fluxo óptico) | 'blend' */
  smoothing?: 'off' | 'flow' | 'blend';
  /** Motion blur por amostragem temporal: 0 (off), 2 ou 4 subamostras por quadro. */
  motionBlurSamples?: number;
}

/**
 * Exports Project (Canvas Video + Web Audio Mixed Soundtrack) via frame-accurate WebCodecs
 * or real-time MediaRecorder fallback.
 */
export async function exportProjectToVideoFile(
  project: ProjectState,
  assets: MediaAsset[],
  quality: ExportQuality,
  onProgress: (percent: number, timeSec: number) => void,
  signal: AbortSignal,
  exportOpts?: VideoExportOptions
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  const effectiveProject: ProjectState = exportOpts?.fpsOverride
    ? { ...project, fps: exportOpts.fpsOverride as 24 | 30 | 60 }
    : project;

  const { exportWithWebCodecs } = await import('./videoExport');
  const encoded = await exportWithWebCodecs(
    effectiveProject,
    assets,
    quality,
    onProgress,
    signal,
    exportOpts
  );
  if (encoded) return encoded;
  if (effectiveProject.clips.some((clip) => clip.timeRemap?.enabled)) {
    throw new Error(
      'A exportacao com Time Remapping precisa de WebCodecs. Use uma versao atual do Chrome ou Edge. A previa continua disponivel.'
    );
  }

  const baseSpec = getProjectDimensions(effectiveProject);
  const targetShortSide =
    quality === '4k' ? 2160 : quality === '2k' ? 1440 : quality === '1080p' ? 1080 : 720;
  const factor = targetShortSide / Math.min(baseSpec.width, baseSpec.height);
  const width = Math.round((baseSpec.width * factor) / 2) * 2;
  const height = Math.round((baseSpec.height * factor) / 2) * 2;

  const fullDuration = Math.max(
    1,
    ...effectiveProject.clips.map((c) => c.startTime + c.duration)
  );
  const rangeStart = exportOpts?.range ? Math.max(0, exportOpts.range.start) : 0;
  const rangeEnd = exportOpts?.range ? Math.min(fullDuration, exportOpts.range.end) : fullDuration;
  const exportSpan = Math.max(0.2, rangeEnd - rangeStart);

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível inicializar o Canvas de exportação.');

  const exportPool = new MediaElementPool();
  const assetsMap = new Map(assets.map((a) => [a.id, a]));

  await Promise.all(
    assets
      .filter((a) => a.type === 'image')
      .map(
        (a) =>
          new Promise<void>((res) => {
            const img = exportPool.getImage(a.url);
            if (img.complete) res();
            else {
              img.onload = () => res();
              img.onerror = () => res();
            }
          })
      )
  );

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const destNode = audioCtx.createMediaStreamDestination();

  for (const clip of effectiveProject.clips) {
    if (!clip.mediaId) continue;
    const asset = assetsMap.get(clip.mediaId);
    if (!asset) continue;
    try {
      if (clip.type === 'video') {
        const vid = exportPool.getVideo(clip.id, asset.url);
        const src = audioCtx.createMediaElementSource(vid);
        src.connect(destNode);
      } else if (clip.type === 'audio') {
        const aud = exportPool.getAudio(clip.id, asset.url);
        const src = audioCtx.createMediaElementSource(aud);
        src.connect(destNode);
      }
    } catch {
      // Safe fallback
    }
  }

  const canvasStream = exportCanvas.captureStream(effectiveProject.fps);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destNode.stream.getAudioTracks(),
  ]);

  const candidateTypes = [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const supportedMime =
    candidateTypes.find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm';

  const defaultMbps = quality === '4k' ? 20 : quality === '2k' ? 12 : quality === '1080p' ? 8 : 5;
  const videoBitsPerSecond = (exportOpts?.bitrateMbps || defaultMbps) * 1_000_000;

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType: supportedMime,
    videoBitsPerSecond,
  });

  const renderOpts: RenderCompositionOptions = {
    backgroundColor: effectiveProject.backgroundColor,
    transparentBg: effectiveProject.transparentBg,
    fps: effectiveProject.fps,
    compositions: effectiveProject.compositions,
  };

  return new Promise((resolve, reject) => {
    let animId = 0;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    recorder.onerror = () => {
      exportPool.pauseAll();
      audioCtx.close().catch(() => {});
      reject(new Error('Erro durante a gravação do arquivo de vídeo.'));
    };

    recorder.onstop = () => {
      exportPool.pauseAll();
      audioCtx.close().catch(() => {});
      if (signal.aborted) {
        reject(new Error('Exportação cancelada pelo usuário.'));
        return;
      }
      const blob = new Blob(chunks, { type: supportedMime });
      const ext = supportedMime.includes('mp4') ? 'mp4' : 'webm';
      const safeName =
        effectiveProject.projectName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/gi, '-') || 'meu-video';
      resolve({
        blob,
        filename: `${safeName}-${quality}.${ext}`,
        mimeType: supportedMime,
      });
    };

    signal.addEventListener('abort', () => {
      cancelAnimationFrame(animId);
      if (recorder.state !== 'inactive') recorder.stop();
    });

    syncMediaPlayback(exportPool, effectiveProject.tracks, effectiveProject.clips, assetsMap, rangeStart, true);
    renderFrameToCanvas(
      ctx,
      width,
      height,
      effectiveProject.tracks,
      effectiveProject.clips,
      assetsMap,
      exportPool,
      rangeStart,
      renderOpts
    );

    recorder.start(200);
    const startWall = performance.now();

    const step = () => {
      if (signal.aborted) return;
      const elapsed = (performance.now() - startWall) / 1000;
      const currentT = Math.min(rangeStart + elapsed, rangeEnd);

      syncMediaPlayback(exportPool, effectiveProject.tracks, effectiveProject.clips, assetsMap, currentT, true);
      renderFrameToCanvas(
        ctx,
        width,
        height,
        effectiveProject.tracks,
        effectiveProject.clips,
        assetsMap,
        exportPool,
        currentT,
        renderOpts
      );

      onProgress(Math.min(99, Math.round((elapsed / exportSpan) * 100)), currentT);

      if (elapsed >= exportSpan) {
        onProgress(100, rangeEnd);
        recorder.stop();
        return;
      }
      animId = requestAnimationFrame(step);
    };

    animId = requestAnimationFrame(step);
  });
}
