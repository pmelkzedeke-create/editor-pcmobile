import { registerAssetBlob } from '../core/persistence/mediaStore';
import {
  ColorAdjustments,
  MediaAsset,
  TextStyle,
  TimelineClip,
  TransitionType,
} from '../types/editor';

export const DEFAULT_FILTERS: ColorAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  blur: 0,
  vignette: 0,
  temperature: 0,
  presetName: 'Original',
};

export interface ColorPreset {
  id: string;
  name: string;
  badge: string;
  gradient: string;
  filters: ColorAdjustments;
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'original',
    name: 'Original Neutro',
    badge: 'STD',
    gradient: 'from-zinc-700 via-zinc-500 to-zinc-300',
    filters: { ...DEFAULT_FILTERS, presetName: 'Original' },
  },
  {
    id: 'cinema-teal',
    name: 'Cinema Teal & Amber',
    badge: 'LUT 01',
    gradient: 'from-teal-700 via-cyan-900 to-amber-500',
    filters: {
      brightness: 103,
      contrast: 118,
      saturation: 118,
      hue: -6,
      blur: 0,
      vignette: 32,
      temperature: 14,
      presetName: 'Cinema Teal & Amber',
    },
  },
  {
    id: 'noir-bw',
    name: 'Noir P&B Dramático',
    badge: 'MONO',
    gradient: 'from-zinc-950 via-zinc-600 to-zinc-100',
    filters: {
      brightness: 98,
      contrast: 138,
      saturation: 0,
      hue: 0,
      blur: 0,
      vignette: 45,
      temperature: 0,
      presetName: 'Noir P&B',
    },
  },
  {
    id: 'golden-vintage',
    name: 'Filme Kodachrome Quente',
    badge: '35MM',
    gradient: 'from-amber-800 via-orange-600 to-yellow-300',
    filters: {
      brightness: 106,
      contrast: 110,
      saturation: 124,
      hue: 8,
      blur: 0,
      vignette: 26,
      temperature: 34,
      presetName: 'Kodachrome 35mm',
    },
  },
  {
    id: 'cyber-pulse',
    name: 'Cyberpunk Neon',
    badge: 'NEON',
    gradient: 'from-fuchsia-700 via-indigo-600 to-cyan-400',
    filters: {
      brightness: 102,
      contrast: 126,
      saturation: 148,
      hue: -18,
      blur: 0,
      vignette: 36,
      temperature: -22,
      presetName: 'Cyberpunk Neon',
    },
  },
  {
    id: 'arctic-clean',
    name: 'Frio Escandinavo',
    badge: 'CLEAN',
    gradient: 'from-slate-800 via-sky-700 to-cyan-200',
    filters: {
      brightness: 105,
      contrast: 108,
      saturation: 84,
      hue: -8,
      blur: 0,
      vignette: 16,
      temperature: -30,
      presetName: 'Frio Escandinavo',
    },
  },
];

export interface TextPresetItem {
  id: string;
  label: string;
  subtitle: string;
  previewText: string;
  y: number;
  style: TextStyle;
}

export const TEXT_PRESETS: TextPresetItem[] = [
  {
    id: 'hero-title',
    label: 'Título Cinematográfico',
    subtitle: 'Impacto central com sombra suave',
    previewText: ' HISTÓRIAS EM MOVIMENTO',
    y: 0,
    style: {
      text: 'HISTÓRIAS EM MOVIMENTO',
      fontFamily: 'Inter',
      fontSize: 64,
      fontWeight: 800,
      color: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowBlur: 24,
      textAlign: 'center',
      letterSpacing: 4,
      borderRadius: 12,
      uppercase: true,
      animation: 'fade-up',
    },
  },
  {
    id: 'dynamic-caption',
    label: 'Legenda Reels / Shorts',
    subtitle: 'Fundo sólido com destaque alto',
    previewText: 'Edição rápida direto no navegador',
    y: 34,
    style: {
      text: 'Edição rápida direto no navegador',
      fontFamily: 'Inter',
      fontSize: 40,
      fontWeight: 700,
      color: '#facc15',
      backgroundColor: '#09090b',
      backgroundOpacity: 82,
      strokeColor: '#000000',
      strokeWidth: 2,
      shadowBlur: 12,
      textAlign: 'center',
      letterSpacing: 0.5,
      borderRadius: 14,
      uppercase: false,
      animation: 'pop',
    },
  },
  {
    id: 'lower-third',
    label: 'Lower Third Editorial',
    subtitle: 'Crédito / nome no canto inferior',
    previewText: 'DIREÇÃO & FOTOGRAFIA • ESTÚDIO BR',
    y: 36,
    style: {
      text: 'DIREÇÃO & FOTOGRAFIA • ESTÚDIO BR',
      fontFamily: 'JetBrains Mono',
      fontSize: 26,
      fontWeight: 600,
      color: '#f4f4f5',
      backgroundColor: '#2563eb',
      backgroundOpacity: 90,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowBlur: 14,
      textAlign: 'left',
      letterSpacing: 2,
      borderRadius: 8,
      uppercase: true,
      animation: 'typewriter',
    },
  },
  {
    id: 'outline-badge',
    label: 'Título Vazado (Stroke)',
    subtitle: 'Tipografia moderna com contorno',
    previewText: 'NOVO EPISÓDIO',
    y: -26,
    style: {
      text: 'NOVO EPISÓDIO',
      fontFamily: 'Inter',
      fontSize: 72,
      fontWeight: 800,
      color: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#38bdf8',
      strokeWidth: 3,
      shadowBlur: 18,
      textAlign: 'center',
      letterSpacing: 6,
      borderRadius: 8,
      uppercase: true,
      animation: 'glow',
    },
  },
];

export const TRANSITION_OPTIONS: {
  id: TransitionType;
  label: string;
  desc: string;
}[] = [
  { id: 'none', label: 'Corte Seco', desc: 'Sem transição gradual' },
  { id: 'fade', label: 'Fade', desc: 'Entrada/saída linear de opacidade' },
  { id: 'dissolve', label: 'Dissolve Suave', desc: 'Curva S cinematográfica de fusão' },
  { id: 'wipe-right', label: 'Wipe Linear', desc: 'Varredura progressiva com recorte real' },
  { id: 'push-left', label: 'Push', desc: 'Empurrão completo da largura do quadro' },
  { id: 'whip-pan', label: 'Whip Pan', desc: 'Chicote rápido com motion blur lateral' },
  { id: 'light-sweep', label: 'Light Sweep', desc: 'Feixe oblíquo luminoso de transição' },
  { id: 'iris-shape', label: 'Iris / Shape Reveal', desc: 'Abertura circular progressiva por máscara' },
  { id: 'glitch', label: 'Glitch Transition', desc: 'Deslocamento digital RGB nas bordas' },
  { id: 'zoom', label: 'Zoom Dinâmico', desc: 'Aproximação suave de lente' },
  { id: 'slide-left', label: 'Slide Lateral', desc: 'Entrada lateral fluida' },
  { id: 'slide-up', label: 'Slide Vertical', desc: 'Revelação ascendente' },
  { id: 'blur', label: 'Desfoque Óptico', desc: 'Transição de foco suave' },
  { id: 'flash', label: 'Flash de Filme', desc: 'Exposição clara de cinema' },
];

export function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function formatTimecode(seconds: number, showFrames = true, fps = 30): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const frameNumber = Math.floor(safe * fps + 1e-5);
  const mins = Math.floor(frameNumber / (60 * fps));
  const secs = Math.floor(frameNumber / fps) % 60;
  const frames = frameNumber % fps;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (!showFrames) return `${mm}:${ss}`;
  const ff = String(frames).padStart(2, '0');
  return `${mm}:${ss}:${ff}`;
}

/**
 * Generates a real playable WAV Blob URL + waveform peak array in memory
 * so built-in music & SFX work seamlessly in HTMLAudioElement and MediaRecorder export.
 */
export function synthesizeStudioAudio(
  kind: 'cinema-pulse' | 'lofi-groove' | 'ambient-pad' | 'whoosh-sfx',
  durationSec: number
): { url: string; waveform: number[]; envelope: number[] } {
  const sampleRate = 22050;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const buffer = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    if (kind === 'cinema-pulse') {
      // Warm cinematic chord progression + subtle rhythmic pulse
      const chordIdx = Math.floor(t / 4) % 4;
      const roots = [110, 87.31, 130.81, 98.0]; // Am - F - C - G
      const f = roots[chordIdx];
      const pad =
        0.22 * Math.sin(2 * Math.PI * f * t) +
        0.16 * Math.sin(2 * Math.PI * f * 1.5 * t) +
        0.11 * Math.sin(2 * Math.PI * f * 2 * t) +
        0.06 * Math.sin(2 * Math.PI * (f * 3) * t);
      const beatPhase = (t * 2) % 1;
      const pulseEnv = Math.exp(-beatPhase * 6.5);
      const subKick = 0.34 * Math.sin(2 * Math.PI * (58 * Math.exp(-beatPhase * 4)) * t) * pulseEnv;
      const shimmer = 0.04 * Math.sin(2 * Math.PI * f * 4 * t) * (0.5 + 0.5 * Math.sin(t * 3));
      sample = (pad + subKick + shimmer) * 0.85;
    } else if (kind === 'lofi-groove') {
      const chordIdx = Math.floor(t / 3) % 4;
      const roots = [146.83, 130.81, 110.0, 123.47];
      const f = roots[chordIdx];
      const keys =
        0.24 * Math.sin(2 * Math.PI * f * t + 0.3 * Math.sin(2 * Math.PI * f * t)) +
        0.15 * Math.sin(2 * Math.PI * f * 1.25 * t) +
        0.12 * Math.sin(2 * Math.PI * f * 1.5 * t);
      const step = (t * 2.4) % 1;
      const kick = step < 0.5 ? 0.35 * Math.sin(2 * Math.PI * 52 * t) * Math.exp(-step * 12) : 0;
      const hatStep = (t * 4.8) % 1;
      const hat = (Math.sin(i * 12.9898) * 0.05) * Math.exp(-hatStep * 22);
      sample = (keys + kick + hat) * 0.85;
    } else if (kind === 'ambient-pad') {
      const f = 130.81;
      const lfo = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.2 * t);
      sample =
        lfo *
        (0.25 * Math.sin(2 * Math.PI * f * t) +
          0.18 * Math.sin(2 * Math.PI * f * 1.498 * t) +
          0.12 * Math.sin(2 * Math.PI * f * 1.887 * t));
    } else {
      // Transition whoosh sound effect
      const norm = t / durationSec;
      const env = Math.sin(Math.PI * Math.min(1, norm));
      const sweepFreq = 120 + 980 * norm * norm;
      const noise = Math.sin(i * 43.137 + Math.cos(i * 0.71)) * 0.22;
      sample = env * (0.4 * Math.sin(2 * Math.PI * sweepFreq * t) + noise);
    }

    // Master envelope at edges to avoid clicks
    const edgeFade = Math.min(1, t / 0.08, (durationSec - t) / 0.15);
    buffer[i] = Math.max(-0.98, Math.min(0.98, sample * Math.max(0, edgeFade)));
  }

  // Compute 64 visual waveform bars
  const bars = 64;
  const blockSize = Math.max(1, Math.floor(totalSamples / bars));
  const waveform: number[] = [];
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    const start = b * blockSize;
    for (let j = 0; j < blockSize && start + j < totalSamples; j += 8) {
      peak = Math.max(peak, Math.abs(buffer[start + j]));
    }
    waveform.push(Math.min(1, Math.max(0.14, peak * 1.35)));
  }

  // Encode 16-bit PCM WAV
  const wavBytes = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(wavBytes);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, totalSamples * 2, true);
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  // Also compute 60Hz amplitude envelope for audio-reactive animations & beat detection
  const envRate = 60;
  const envWin = Math.max(1, Math.floor(sampleRate / envRate));
  const envLen = Math.max(1, Math.ceil(totalSamples / envWin));
  const envelope: number[] = [];
  let maxEnv = 0.001;
  for (let e = 0; e < envLen; e++) {
    let sum = 0;
    const st = e * envWin;
    const en = Math.min(totalSamples, st + envWin);
    for (let j = st; j < en; j++) sum += buffer[j] * buffer[j];
    const rms = Math.sqrt(sum / Math.max(1, en - st));
    envelope.push(rms);
    if (rms > maxEnv) maxEnv = rms;
  }
  for (let e = 0; e < envelope.length; e++) {
    envelope[e] = Number((envelope[e] / maxEnv).toFixed(4));
  }

  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  return {
    url: URL.createObjectURL(blob),
    waveform,
    envelope,
  };
}

export async function extractWaveformFromFile(file: File, bars = 64): Promise<number[]> {
  let ctx: AudioContext | null = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AudioCtx();
    const audioBuf = await ctx.decodeAudioData(arrayBuffer);
    const channelData = audioBuf.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channelData.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize && start + j < channelData.length; j += 16) {
        const val = Math.abs(channelData[start + j]);
        if (val > max) max = val;
      }
      peaks.push(Math.min(1, Math.max(0.12, max * 1.25)));
    }
    await ctx.close();
    return peaks;
  } catch {
    return Array.from({ length: bars }, (_, idx) =>
      Math.max(0.18, 0.45 + 0.35 * Math.sin(idx * 0.65) * Math.cos(idx * 0.23))
    );
  } finally {
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => {});
  }
}

export interface IngestionOptions {
  onProgress?: (p: { stage: string; percent: number }) => void;
  signal?: AbortSignal;
}

function create3DThumbnail(_name: string): string {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 320, 180);
  grad.addColorStop(0, '#1e1b4b');
  grad.addColorStop(0.5, '#312e81');
  grad.addColorStop(1, '#0f172a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 320, 180);

  // Wireframe isometric 3D cube illustration
  ctx.save();
  ctx.translate(160, 85);
  ctx.strokeStyle = '#818cf8';
  ctx.fillStyle = 'rgba(129, 140, 248, 0.25)';
  ctx.lineWidth = 2;

  // Top face
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.lineTo(46, -18);
  ctx.lineTo(0, 4);
  ctx.lineTo(-46, -18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Left face
  ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
  ctx.beginPath();
  ctx.moveTo(-46, -18);
  ctx.lineTo(0, 4);
  ctx.lineTo(0, 48);
  ctx.lineTo(-46, 26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Right face
  ctx.fillStyle = 'rgba(165, 180, 252, 0.3)';
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.lineTo(46, -18);
  ctx.lineTo(46, 26);
  ctx.lineTo(0, 48);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  // Badge label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('3D MODEL • GLB/GLTF', 160, 155);

  return c.toDataURL('image/jpeg', 0.85);
}

async function analyzeMediaFile(file: File, options?: IngestionOptions): Promise<MediaAsset | null> {
  const url = URL.createObjectURL(file);
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const onProg = options?.onProgress;
  const signal = options?.signal;

  if (signal?.aborted) {
    URL.revokeObjectURL(url);
    throw new DOMException('Operação cancelada', 'AbortError');
  }

  // 1. 3D Models (.glb / .gltf)
  if (name.endsWith('.glb') || name.endsWith('.gltf') || mime.includes('gltf') || mime.includes('glb')) {
    onProg?.({ stage: 'Carregando modelo 3D...', percent: 40 });
    const thumb = create3DThumbnail(file.name);
    onProg?.({ stage: 'Modelo 3D pronto', percent: 100 });
    return {
      id: uid('media-3d'),
      name: file.name,
      type: 'model3d',
      url,
      duration: 10,
      thumbnail: thumb,
      width: 1280,
      height: 720,
    };
  }

  // 2. Lottie JSON
  if (name.endsWith('.json') && !name.endsWith('.ottoproj.json')) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data && typeof data === 'object' && Array.isArray(data.layers) && typeof data.fr === 'number') {
        const fr = data.fr || 30;
        const dur = Math.max(1, ((data.op || 60) - (data.ip || 0)) / fr);
        onProg?.({ stage: 'Animação vetorial pronta', percent: 100 });
        return {
          id: uid('media-lottie'),
          name: file.name,
          type: 'lottie',
          url,
          duration: dur,
          width: data.w || 1080,
          height: data.h || 1080,
          lottieJson: text.slice(0, 500000),
        };
      }
    } catch {
      // not a lottie json
    }
  }

  // 3. SVG vector
  if (name.endsWith('.svg') || mime.includes('svg')) {
    return {
      id: uid('media-svg'),
      name: file.name,
      type: 'image',
      url,
      duration: 8,
      thumbnail: url,
      width: 1280,
      height: 720,
    };
  }

  // 4. Video files
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(name)) {
    onProg?.({ stage: 'Lendo dados do vídeo...', percent: 15 });
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const waitFor = (event: string, action?: () => void) =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
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
          reject(new Error('Vídeo não suportado ou codec incompatível'));
        };
        const aborted = () => {
          cleanup();
          reject(new DOMException('Operação cancelada', 'AbortError'));
        };
        const timer = window.setTimeout(failed, 25000);
        video.addEventListener(event, ready, { once: true });
        video.addEventListener('error', failed, { once: true });
        signal?.addEventListener('abort', aborted, { once: true });
        action?.();
      });

    try {
      onProg?.({ stage: 'Decodificando metadados...', percent: 35 });
      await waitFor('loadedmetadata', () => {
        video.src = url;
      });

      if (signal?.aborted) throw new DOMException('Operação cancelada', 'AbortError');

      if (!Number.isFinite(video.duration)) {
        await waitFor('seeked', () => {
          video.currentTime = 1e10;
        });
      }

      const duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
      if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) {
        throw new Error('Duração de vídeo inválida');
      }

      onProg?.({ stage: 'Gerando miniatura...', percent: 65 });
      const thumbnailTime = Math.min(0.5, duration * 0.15);
      if (Math.abs(video.currentTime - thumbnailTime) > 0.001) {
        await waitFor('seeked', () => {
          video.currentTime = thumbnailTime;
        });
      }

      if (video.readyState < 2) await waitFor('loadeddata');

      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = Math.max(1, Math.round((320 * (video.videoHeight || 720)) / (video.videoWidth || 1280)));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);

      onProg?.({ stage: 'Extraindo forma de onda...', percent: 85 });
      const waveform = await extractWaveformFromFile(file, 56);

      onProg?.({ stage: 'Concluído!', percent: 100 });
      return {
        id: uid('media'),
        name: file.name,
        type: 'video',
        url,
        duration,
        thumbnail: canvas.toDataURL('image/jpeg', 0.8),
        waveform,
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
      };
    } catch (err) {
      URL.revokeObjectURL(url);
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      return null;
    } finally {
      video.removeAttribute('src');
      video.load();
    }
  }

  // 5. Image files
  if (mime.startsWith('image/')) {
    onProg?.({ stage: 'Carregando imagem...', percent: 50 });
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        onProg?.({ stage: 'Imagem carregada', percent: 100 });
        resolve({
          id: uid('media'),
          name: file.name,
          type: 'image',
          url,
          duration: 6,
          thumbnail: url,
          width: img.naturalWidth || 1280,
          height: img.naturalHeight || 720,
        });
      };
      img.onerror = () => resolve(null);
      signal?.addEventListener('abort', () => {
        URL.revokeObjectURL(url);
        reject(new DOMException('Operação cancelada', 'AbortError'));
      });
      img.src = url;
    });
  }

  // 6. Audio files
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(name)) {
    onProg?.({ stage: 'Lendo áudio...', percent: 30 });
    return new Promise((resolve, reject) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = url;
      audio.onloadedmetadata = async () => {
        onProg?.({ stage: 'Extraindo forma de onda do áudio...', percent: 70 });
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 12;
        const waveform = await extractWaveformFromFile(file, 64);
        onProg?.({ stage: 'Áudio pronto!', percent: 100 });
        resolve({
          id: uid('media'),
          name: file.name,
          type: 'audio',
          url,
          duration,
          waveform,
        });
      };
      audio.onerror = () => resolve(null);
      signal?.addEventListener('abort', () => {
        URL.revokeObjectURL(url);
        reject(new DOMException('Operação cancelada', 'AbortError'));
      });
    });
  }

  return null;
}

export function createClipFromAsset(
  asset: MediaAsset,
  trackId: string,
  startTime: number
): TimelineClip {
  const isImage = asset.type === 'image' || asset.type === 'svg';
  const is3D = asset.type === 'model3d';
  const isLottie = asset.type === 'lottie';
  const defaultDuration = isImage ? 5.5 : is3D ? 10 : isLottie ? Math.max(2, asset.duration) : Math.min(asset.duration, 15);

  const clipType: TimelineClip['type'] =
    is3D ? 'model3d' : isLottie ? 'lottie' : asset.type === 'svg' ? 'svg' : (asset.type as TimelineClip['type']);

  return {
    id: uid('clip'),
    trackId,
    mediaId: asset.id,
    type: clipType,
    name: asset.name,
    startTime: Math.max(0, Number(startTime.toFixed(2))),
    duration: Number(defaultDuration.toFixed(2)),
    trimStart: 0,
    maxDuration: isImage || is3D ? 300 : Math.max(asset.duration, defaultDuration),
    x: 0,
    y: 0,
    z: is3D ? 0 : 0,
    scale: 100,
    rotation: 0,
    opacity: 100,
    flipH: false,
    flipV: false,
    fitMode: 'cover',
    is3D: is3D ? true : false,
    model3dData: is3D
      ? {
          geometry: 'custom',
          modelUrl: asset.url,
          color: '#ffffff',
          roughness: 0.35,
          metalness: 0.5,
          wireframe: false,
          castShadow: true,
          receiveShadow: true,
        }
      : undefined,
    lottieData: isLottie && asset.lottieJson ? { jsonString: asset.lottieJson, loop: true, speed: 1 } : undefined,
    speed: 1,
    motionPreset: isImage ? 'zoom-in' : 'none',
    filters: { ...DEFAULT_FILTERS },
    transitionIn: 'fade',
    transitionInDuration: 0.4,
    transitionOut: 'fade',
    transitionOutDuration: 0.4,
    volume: 100,
    muted: false,
    fadeIn: 0.2,
    fadeOut: 0.3,
    thumbnail: asset.thumbnail,
    waveform: asset.waveform,
    ambientFX: asset.ambientFX || 'none',
  };
}

/**
 * Public ingestion entry point: analyzes the file AND persists its binary in the
 * media store so the project survives reloads (blob URLs alone never do).
 */
export async function parseUploadedMediaFile(
  file: File,
  options?: IngestionOptions
): Promise<MediaAsset | null> {
  const asset = await analyzeMediaFile(file, options);
  if (!asset) return null;
  asset.size = file.size;
  asset.mimeType = file.type || asset.mimeType;
  try {
    asset.storageKey = await registerAssetBlob(asset.id, file);
    asset.status = 'ready';
  } catch {
    // Storage unavailable: the asset still works in this session and will be
    // reported as missing on reload so the user can relink it explicitly.
    asset.status = 'missing';
  }
  return asset;
}
