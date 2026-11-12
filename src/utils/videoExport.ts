import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import {
  ArrayBufferTarget as Mp4ArrayBufferTarget,
  Muxer as Mp4Muxer,
} from 'mp4-muxer';
import type { ExportQuality, MediaAsset, ProjectState, WorkArea } from '../types/editor';
import { MediaElementPool, renderFrameToCanvas } from './compositor';
import type { VideoExportOptions } from './compositor';
import { checkAborted, prepareMediaFrame, seekVideoFrame } from './previewCache';
import { clamp, getClipPlaybackRate, getClipSourceTime } from './timeRemap';
import { getProjectDimensions } from '../core/compositions';
import { evaluateClipVolume } from '../core/keyframes';
import { setWebmDuration } from './webmDuration';

export async function mixProjectAudio(
  project: ProjectState,
  assets: Map<string, MediaAsset>,
  rangeStart: number,
  duration: number,
  signal: AbortSignal
): Promise<AudioBuffer | null> {
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const clips = project.clips.filter((clip) => {
    const track = tracks.get(clip.trackId);
    return (
      clip.enabled !== false &&
      (clip.type === 'audio' || clip.type === 'video') &&
      track &&
      !track.muted &&
      !(clip.type === 'video' && track.hidden) &&
      !clip.muted &&
      (clip.volume > 0 || clip.keyframes?.some((k) => k.property === 'volume'))
    );
  });
  if (!clips.length) return null;
  const sampleRate = 48000;
  const output = new AudioBuffer({
    length: Math.max(1, Math.ceil(duration * sampleRate)),
    sampleRate,
    numberOfChannels: 2,
  });
  const decodeContext = new AudioContext({ sampleRate });
  const decoded = new Map<string, AudioBuffer | null>();
  let hasAudio = false;
  try {
    for (const clip of clips) {
      checkAborted(signal);
      const asset = clip.mediaId ? assets.get(clip.mediaId) : undefined;
      if (!asset) throw new Error(`Audio ausente: ${clip.name}`);
      if (!decoded.has(asset.id)) {
        try {
          const response = await fetch(asset.url, { signal });
          if (!response.ok) throw new Error('Arquivo de audio indisponivel');
          decoded.set(asset.id, await decodeContext.decodeAudioData(await response.arrayBuffer()));
        } catch (error) {
          checkAborted(signal);
          if (clip.type === 'audio') {
            throw new Error(
              `Nao foi possivel decodificar o audio: ${clip.name}. ${
                error instanceof Error ? error.message : ''
              }`
            );
          }
          decoded.set(asset.id, null);
        }
      }
      const source = decoded.get(asset.id);
      if (!source) continue;
      hasAudio = true;
      const first = Math.max(0, Math.round((clip.startTime - rangeStart) * sampleRate));
      const last = Math.min(
        output.length,
        Math.round((clip.startTime + clip.duration - rangeStart) * sampleRate)
      );
      for (let start = first; start < last; start += 64) {
        const globalT = rangeStart + start / sampleRate;
        const local = globalT - clip.startTime;
        const count = Math.min(64, last - start);
        const rate = getClipPlaybackRate(clip, local + count / sampleRate / 2);
        if (rate < 0.0625 || rate > 16) continue;
        const sourceStart = getClipSourceTime(clip, local) * source.sampleRate;
        const sourceEnd = getClipSourceTime(clip, local + count / sampleRate) * source.sampleRate;
        const panNorm = clamp((clip.pan ?? 0) / 100, -1, 1);
        const panGainL = panNorm <= 0 ? 1 : 1 - panNorm;
        const panGainR = panNorm >= 0 ? 1 : 1 + panNorm;
        const eqAvgDb = ((clip.eqLow ?? 0) + (clip.eqMid ?? 0) + (clip.eqHigh ?? 0)) / 3;
        const eqGain = Math.pow(10, eqAvgDb / 20);
        for (let channel = 0; channel < 2; channel++) {
          const data = source.getChannelData(Math.min(channel, source.numberOfChannels - 1));
          const target = output.getChannelData(channel);
          const chGain = (channel === 0 ? panGainL : panGainR) * eqGain;
          for (let i = 0; i < count; i++) {
            const position = sourceStart + ((sourceEnd - sourceStart) * i) / count;
            if (position < 0 || position >= data.length - 1) continue;
            const floor = Math.floor(position);
            const fraction = position - floor;
            const t = local + i / sampleRate;
            const dynVol = evaluateClipVolume(clip, t);
            const fadeIn = clip.fadeIn > 0 ? clamp(t / clip.fadeIn, 0, 1) : 1;
            const fadeOut = clip.fadeOut > 0 ? clamp((clip.duration - t) / clip.fadeOut, 0, 1) : 1;
            let s =
              (((data[floor] * (1 - fraction) + data[floor + 1] * fraction) * dynVol) / 100) *
              fadeIn *
              fadeOut *
              chGain;
            if (clip.audioCompressor) {
              // Soft-knee compressor/limiter (threshold 0.55, ratio 3:1)
              const absS = Math.abs(s);
              if (absS > 0.55) {
                s = Math.sign(s) * (0.55 + (absS - 0.55) / 3);
              }
            }
            target[start + i] += s;
          }
        }
        if ((start - first) % (sampleRate * 2) < 64) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          checkAborted(signal);
        }
      }
    }
    for (let channel = 0; channel < 2; channel++) {
      const samples = output.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] = clamp(samples[i], -1, 1);
    }
    return hasAudio ? output : null;
  } finally {
    await decodeContext.close();
  }
}

export async function exportAudioWavFile(
  project: ProjectState,
  assets: MediaAsset[],
  signal: AbortSignal,
  range?: WorkArea
): Promise<{ blob: Blob; filename: string }> {
  const assetsMap = new Map(assets.map((a) => [a.id, a]));
  const fullDur = Math.max(1 / project.fps, ...project.clips.map((c) => c.startTime + c.duration));
  const rStart = range ? Math.max(0, range.start) : 0;
  const rEnd = range ? Math.min(fullDur, range.end) : fullDur;
  const dur = Math.max(0.1, rEnd - rStart);

  const mixed = await mixProjectAudio(project, assetsMap, rStart, dur, signal);
  const sampleRate = mixed ? mixed.sampleRate : 48000;
  const numFrames = mixed ? mixed.length : Math.ceil(dur * sampleRate);
  const channels = 2;
  const bytesPerSample = 2;
  const dataBytes = numFrames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  const chL = mixed ? mixed.getChannelData(0) : new Float32Array(numFrames);
  const chR = mixed ? mixed.getChannelData(1) : new Float32Array(numFrames);
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = clamp(chL[i] || 0, -1, 1);
    const r = clamp(chR[i] || 0, -1, 1);
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }

  const safeName = project.projectName.trim().toLowerCase().replace(/[^a-z0-9-_]+/gi, '-') || 'meu-audio';
  return {
    blob: new Blob([buffer], { type: 'audio/wav' }),
    filename: `${safeName}-master.wav`,
  };
}

/**
 * Exports a TAR archive containing lossless transparent-alpha PNG sequence frames (`frame-0001.png`, ...).
 */
export async function exportPngSequenceArchive(
  project: ProjectState,
  assets: MediaAsset[],
  quality: ExportQuality,
  onProgress: (percent: number, time: number) => void,
  signal: AbortSignal,
  range?: WorkArea,
  imageFormat: 'png' | 'jpeg' | 'webp' = 'png',
  waitIfPaused?: () => Promise<void>
): Promise<{ blob: Blob; filename: string; frameCount: number }> {
  const spec = getProjectDimensions(project);
  const targetShort = quality === '4k' ? 2160 : quality === '2k' ? 1440 : quality === '1080p' ? 1080 : 720;
  const factor = targetShort / Math.min(spec.width, spec.height);
  const width = Math.round((spec.width * factor) / 2) * 2;
  const height = Math.round((spec.height * factor) / 2) * 2;

  const assetsMap = new Map(assets.map((a) => [a.id, a]));
  const fullDur = Math.max(1 / project.fps, ...project.clips.map((c) => c.startTime + c.duration));
  const rStart = range ? Math.max(0, range.start) : 0;
  const rEnd = range ? Math.min(fullDur, range.end) : fullDur;
  const span = Math.max(1 / project.fps, rEnd - rStart);
  const frameCount = Math.max(1, Math.ceil(span * project.fps));

  const pool = new MediaElementPool();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Canvas indisponível.');

  const tarParts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  const makeTarHeader = (name: string, byteLen: number): Uint8Array => {
    const header = new Uint8Array(512);
    header.set(encoder.encode(name).slice(0, 100), 0);
    header.set(encoder.encode('0000644\0'), 100);
    header.set(encoder.encode('0000000\0'), 108);
    header.set(encoder.encode('0000000\0'), 116);
    header.set(encoder.encode(byteLen.toString(8).padStart(11, '0') + '\0'), 124);
    header.set(encoder.encode(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0'), 136);
    header.fill(32, 148, 156); // checksum spaces
    header[156] = 48; // '0' regular file
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.set(encoder.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    return header;
  };

  const mime =
    imageFormat === 'jpeg'
      ? 'image/jpeg'
      : imageFormat === 'webp'
      ? 'image/webp'
      : 'image/png';
  const ext = imageFormat === 'jpeg' ? 'jpg' : imageFormat;

  try {
    await document.fonts.ready;
    for (let i = 0; i < frameCount; i++) {
      if (waitIfPaused) await waitIfPaused();
      checkAborted(signal);
      const time = rStart + i / project.fps;
      await prepareMediaFrame(project, assetsMap, pool, time, signal);
      renderFrameToCanvas(ctx, width, height, project.tracks, project.clips, assetsMap, pool, time, {
        backgroundColor: project.backgroundColor,
        transparentBg: imageFormat === 'jpeg' ? false : project.transparentBg,
        fps: project.fps,
        compositions: project.compositions,
        isExport: true,
      });
      const imgBlob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error(`Falha ao codificar ${ext.toUpperCase()}`))),
          mime,
          0.92
        )
      );
      const bytes = new Uint8Array(await imgBlob.arrayBuffer());
      const name = `frame-${String(i + 1).padStart(4, '0')}.${ext}`;
      tarParts.push(makeTarHeader(name, bytes.length));
      tarParts.push(bytes);
      const pad = (512 - (bytes.length % 512)) % 512;
      if (pad > 0) tarParts.push(new Uint8Array(pad));
      onProgress(Math.round(((i + 1) / frameCount) * 100), time);
    }
    tarParts.push(new Uint8Array(1024)); // End-of-archive blocks
    const safeName = project.projectName.trim().toLowerCase().replace(/[^a-z0-9-_]+/gi, '-') || 'sequencia';
    return {
      blob: new Blob(tarParts as BlobPart[], { type: 'application/x-tar' }),
      filename: `${safeName}-${ext}-seq.tar`,
      frameCount,
    };
  } finally {
    pool.dispose();
  }
}

export async function exportWithWebCodecs(
  project: ProjectState,
  assets: MediaAsset[],
  quality: ExportQuality,
  onProgress: (percent: number, time: number) => void,
  signal: AbortSignal,
  exportOpts?: VideoExportOptions
): Promise<{ blob: Blob; filename: string; mimeType: string } | null> {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return null;
  const spec = getProjectDimensions(project);
  const size = quality === '4k' ? 2160 : quality === '2k' ? 1440 : quality === '1080p' ? 1080 : 720;
  const factor = size / Math.min(spec.width, spec.height);
  const width = Math.round((spec.width * factor) / 2) * 2;
  const height = Math.round((spec.height * factor) / 2) * 2;
  const defaultMbps = quality === '4k' ? 22 : quality === '2k' ? 14 : quality === '1080p' ? 8 : 5;
  const bitrate = (exportOpts?.bitrateMbps || defaultMbps) * 1_000_000;

  let useMp4 = exportOpts?.container === 'mp4' && !project.transparentBg;
  let videoConfig: VideoEncoderConfig = {
    codec: 'vp8',
    width,
    height,
    framerate: project.fps,
    bitrate,
  };
  let audioConfig: AudioEncoderConfig = {
    codec: 'opus',
    sampleRate: 48000,
    numberOfChannels: 2,
    bitrate: 128000,
  };
  let mp4AudioCodec: 'aac' | 'opus' = 'aac';

  if (useMp4) {
    const h264Candidates = ['avc1.640028', 'avc1.4d002a', 'avc1.420028', 'avc1.42001f'];
    let pickedH264: string | null = null;
    for (const c of h264Candidates) {
      const check = await VideoEncoder.isConfigSupported({
        codec: c,
        width,
        height,
        framerate: project.fps,
        bitrate,
      });
      if (check.supported) {
        pickedH264 = c;
        break;
      }
    }
    const aacCheck = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128000,
    });
    const opusCheck = await AudioEncoder.isConfigSupported(audioConfig);
    if (pickedH264 && (aacCheck.supported || opusCheck.supported)) {
      videoConfig = {
        codec: pickedH264,
        width,
        height,
        framerate: project.fps,
        bitrate,
      };
      if (aacCheck.supported) {
        audioConfig = {
          codec: 'mp4a.40.2',
          sampleRate: 48000,
          numberOfChannels: 2,
          bitrate: 128000,
        };
        mp4AudioCodec = 'aac';
      } else {
        mp4AudioCodec = 'opus';
      }
    } else {
      useMp4 = false;
    }
  }

  if (
    !useMp4 &&
    (!(await VideoEncoder.isConfigSupported(videoConfig)).supported ||
      !(await AudioEncoder.isConfigSupported(audioConfig)).supported)
  ) {
    return null;
  }
  checkAborted(signal);
  const assetsMap = new Map(assets.map((asset) => [asset.id, asset]));
  const fullDuration = Math.max(1 / project.fps, ...project.clips.map((clip) => clip.startTime + clip.duration));
  const rangeStart = exportOpts?.range ? Math.max(0, exportOpts.range.start) : 0;
  const rangeEnd = exportOpts?.range ? Math.min(fullDuration, exportOpts.range.end) : fullDuration;
  const duration = Math.max(1 / project.fps, rangeEnd - rangeStart);

  onProgress(0, rangeStart);
  const audio = await mixProjectAudio(project, assetsMap, rangeStart, duration, signal);

  const webmTarget = useMp4 ? null : new ArrayBufferTarget();
  const webmMuxer = useMp4
    ? null
    : new Muxer({
        target: webmTarget!,
        video: { codec: 'V_VP8', width, height, frameRate: project.fps },
        ...(audio ? { audio: { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 2 } } : {}),
        firstTimestampBehavior: 'offset',
      });

  const mp4Target = useMp4 ? new Mp4ArrayBufferTarget() : null;
  const mp4Muxer = useMp4
    ? new Mp4Muxer({
        target: mp4Target!,
        video: { codec: 'avc', width, height, frameRate: project.fps },
        ...(audio
          ? { audio: { codec: mp4AudioCodec, sampleRate: 48000, numberOfChannels: 2 } }
          : {}),
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      })
    : null;

  let encoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => {
      if (mp4Muxer) mp4Muxer.addVideoChunk(chunk, metadata);
      else webmMuxer?.addVideoChunk(chunk, metadata);
    },
    error: (error) => {
      encoderError = error;
    },
  });
  const audioEncoder = audio
    ? new AudioEncoder({
        output: (chunk, metadata) => {
          if (mp4Muxer) mp4Muxer.addAudioChunk(chunk, metadata);
          else webmMuxer?.addAudioChunk(chunk, metadata);
        },
        error: (error) => {
          encoderError = error;
        },
      })
    : null;
  const pool = new MediaElementPool();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: !!project.transparentBg });
  if (!context) throw new Error('Canvas indisponivel.');
  let audioPosition = 0;
  // --- Suavização de fps (fluxo óptico) + motion blur por amostragem temporal ---
  const smoothing = exportOpts?.smoothing || 'off';
  const blurSamples = exportOpts?.motionBlurSamples || 0;
  const interpolators = new Map<string, { interp: import('./frameInterpolation').ClipFrameInterpolator; asset: MediaAsset }>();
  if (smoothing !== 'off') {
    for (const clip of project.clips) {
      if (clip.type !== 'video' || !clip.mediaId) continue;
      const asset = assetsMap.get(clip.mediaId);
      if (!asset) continue;
      try {
      const video = pool.getVideo(clip.id, asset.url);
      video.muted = true;
      const { ClipFrameInterpolator } = await import('./frameInterpolation');
      const interp = new ClipFrameInterpolator(
        video,
        async (time, sig) => {
          await seekVideoFrame(video, Math.max(0, Math.min(time, Math.max(0, video.duration - 0.001))), sig);
        },
        Math.max(2, Math.round(width / 2)),
        Math.max(2, Math.round(height / 2)),
        smoothing === 'flow'
      );
      await interp.estimateSourceFps(signal);
      interpolators.set(clip.id, { interp, asset });
      } catch {
        // Interpolador indisponível para este clipe: segue sem suavização.
      }
    }
  }
  const frameOverride = new Map<string, CanvasImageSource>();
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = width;
  blurCanvas.height = height;
  const blurCtx = blurCanvas.getContext('2d')!;
  const accumCanvas = document.createElement('canvas');
  accumCanvas.width = width;
  accumCanvas.height = height;
  const accumCtx = accumCanvas.getContext('2d')!;
  try {
    videoEncoder.configure(videoConfig);
    audioEncoder?.configure(audioConfig);
    await document.fonts.ready;
    const frameCount = Math.ceil(duration * project.fps);
    for (let index = 0; index < frameCount; index++) {
      if (exportOpts?.waitIfPaused) await exportOpts.waitIfPaused();
      checkAborted(signal);
      if (encoderError) throw encoderError;
      const localExportTime = index / project.fps;
      const globalTime = rangeStart + localExportTime;
      await prepareMediaFrame(project, assetsMap, pool, globalTime, signal);
      // Interpolação de quadros (fluxo óptico) para clipes de baixa taxa
      frameOverride.clear();
      if (interpolators.size) {
        for (const clip of project.clips) {
          const entry = interpolators.get(clip.id);
          if (!entry || clip.enabled === false) continue;
          const local = globalTime - clip.startTime;
          if (local < 0 || local >= clip.duration) continue;
          const sourceTime = getClipSourceTime(clip, local);
          frameOverride.set(clip.id, await entry.interp.frameAt(sourceTime, signal));
        }
      }
      // Motion blur por amostragem temporal: média de N sub-quadros
      const subSamples = blurSamples > 0 ? blurSamples : 1;
      let targetContext = context;
      if (blurSamples > 0) {
        accumCtx.setTransform(1, 0, 0, 1, 0, 0);
        accumCtx.clearRect(0, 0, width, height);
        for (let s = 0; s < subSamples; s++) {
          const subTime = globalTime + (s / subSamples) * (1 / project.fps);
          frameOverride.clear();
          if (interpolators.size) {
            for (const clip of project.clips) {
              const entry = interpolators.get(clip.id);
              if (!entry || clip.enabled === false) continue;
              const local = subTime - clip.startTime;
              if (local < 0 || local >= clip.duration) continue;
              frameOverride.set(clip.id, await entry.interp.frameAt(getClipSourceTime(clip, local), signal));
            }
          }
          await prepareMediaFrame(project, assetsMap, pool, subTime, signal);
          blurCtx.setTransform(1, 0, 0, 1, 0, 0);
          blurCtx.clearRect(0, 0, width, height);
          renderFrameToCanvas(
            blurCtx,
            width,
            height,
            project.tracks,
            project.clips,
            assetsMap,
            pool,
            subTime,
            {
              backgroundColor: project.backgroundColor,
              transparentBg: project.transparentBg,
              fps: project.fps,
              compositions: project.compositions,
              frameOverride,
              isExport: true,
            }
          );
          accumCtx.globalAlpha = 1 / subSamples;
          accumCtx.drawImage(blurCanvas, 0, 0);
        }
        accumCtx.globalAlpha = 1;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);
        context.drawImage(accumCanvas, 0, 0);
        targetContext = context;
      } else {
        renderFrameToCanvas(
          targetContext,
          width,
          height,
          project.tracks,
          project.clips,
          assetsMap,
          pool,
          globalTime,
          {
            backgroundColor: project.backgroundColor,
            transparentBg: project.transparentBg,
            fps: project.fps,
            compositions: project.compositions,
            frameOverride,
            isExport: true,
          }
        );
      }
      void targetContext;
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(localExportTime * 1_000_000),
        duration: Math.round(1_000_000 / project.fps),
      });
      videoEncoder.encode(frame, { keyFrame: index % (project.fps * 2) === 0 });
      frame.close();
      if (audio && audioEncoder) {
        const until = Math.min(audio.length, Math.ceil(((index + 1) / project.fps) * audio.sampleRate));
        while (audioPosition < until) {
          const count = Math.min(960, until - audioPosition);
          const data = new Float32Array(count * 2);
          for (let channel = 0; channel < 2; channel++) {
            data.set(audio.getChannelData(channel).subarray(audioPosition, audioPosition + count), channel * count);
          }
          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: audio.sampleRate,
            numberOfChannels: 2,
            numberOfFrames: count,
            timestamp: Math.round((audioPosition / audio.sampleRate) * 1_000_000),
            data,
          });
          audioEncoder.encode(audioData);
          audioData.close();
          audioPosition += count;
        }
      }
      if (videoEncoder.encodeQueueSize >= 6) await videoEncoder.flush();
      if (audioEncoder && audioEncoder.encodeQueueSize >= 16) await audioEncoder.flush();
      if (index % 3 === 0) {
        onProgress(Math.min(99, Math.round(((index + 1) / frameCount) * 100)), globalTime);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    await videoEncoder.flush();
    await audioEncoder?.flush();
    checkAborted(signal);
    if (encoderError) throw encoderError;
    const name = project.projectName.trim().toLowerCase().replace(/[^a-z0-9-_]+/gi, '-') || 'meu-video';
    if (mp4Muxer && mp4Target) {
      mp4Muxer.finalize();
      onProgress(100, rangeEnd);
      return {
        blob: new Blob([mp4Target.buffer], { type: 'video/mp4' }),
        filename: `${name}-${quality}.mp4`,
        mimeType: 'video/mp4',
      };
    }
    webmMuxer!.finalize();
    if (!setWebmDuration(webmTarget!.buffer, duration)) throw new Error('Falha ao finalizar a duracao do WebM.');
    onProgress(100, rangeEnd);
    return {
      blob: new Blob([webmTarget!.buffer], { type: 'video/webm' }),
      filename: `${name}-${quality}.webm`,
      mimeType: 'video/webm',
    };
  } finally {
    pool.dispose();
    if (videoEncoder.state !== 'closed') videoEncoder.close();
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
  }
}
