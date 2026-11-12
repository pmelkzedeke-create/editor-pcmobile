import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Download,
  FileText,
  Film,
  Images,
  Keyboard,
  Loader2,
  Music,
  Pause,
  Play,
  X,
} from 'lucide-react';
import {
  ExportQuality,
  MediaAsset,
  ProjectState,
  WorkArea,
} from '../types/editor';
import { getProjectDimensions } from '../core/compositions';
import { serializeClipsToSubtitles } from '../core/subtitles';
import { exportProjectToVideoFile } from '../utils/compositor';
import { formatTimecode } from '../utils/mediaHelpers';
import { exportAudioWavFile, exportPngSequenceArchive } from '../utils/videoExport';

interface ExportModalProps {
  project: ProjectState;
  assets: MediaAsset[];
  totalDuration: number;
  workArea: WorkArea;
  onCaptureFramePng: () => void;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  project,
  assets,
  totalDuration,
  workArea,
  onCaptureFramePng,
  onClose,
}) => {
  const [quality, setQuality] = useState<ExportQuality>('1080p');
  const [container, setContainer] = useState<'webm' | 'mp4'>('webm');
  const [rangeMode, setRangeMode] = useState<'full' | 'workArea'>('full');
  const [bitrateMbps, setBitrateMbps] = useState<number>(8);
  const [fpsOverride, setFpsOverride] = useState<'' | 24 | 30 | 60 | 120>('');
  const [smoothing, setSmoothing] = useState<'off' | 'flow' | 'blend'>('flow');
  const [motionBlurSamples, setMotionBlurSamples] = useState<number>(0);
  const [seqFormat, setSeqFormat] = useState<'png' | 'webp' | 'jpeg'>('png');
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [isPaused, setIsPaused] = useState(false);
  const pausedRef = useRef(false);
  const renderStartWallRef = useRef(0);
  const [renderSpeedFps, setRenderSpeedFps] = useState(0);
  const [etaSec, setEtaSec] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [renderedTime, setRenderedTime] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string>('');
  const [exportedKind, setExportedKind] = useState<'video' | 'png-seq' | 'audio'>('video');
  const [verifiedMeta, setVerifiedMeta] = useState<{ w: number; h: number; dur: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const spec = getProjectDimensions(project);
  const targetShort =
    quality === '4k' ? 2160 : quality === '2k' ? 1440 : quality === '1080p' ? 1080 : 720;
  const mult = targetShort / Math.min(spec.width, spec.height);
  const outW = Math.round((spec.width * mult) / 2) * 2;
  const outH = Math.round((spec.height * mult) / 2) * 2;

  const activeRange = rangeMode === 'workArea' ? workArea : undefined;
  const targetDuration = activeRange ? activeRange.end - activeRange.start : totalDuration;

  // Runtime capability detection (never claim a container the browser cannot write).
  const capabilities = useMemo(() => {
    const hasWebCodecs = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
    const mp4ViaRecorder =
      typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1');
    return { hasWebCodecs, mp4ViaRecorder };
  }, []);
  const estimatedMB = Math.max(
    1,
    Math.round(((bitrateMbps * 1_000_000) / 8) * targetDuration / (1024 * 1024))
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );
  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl]
  );

  const triggerDownload = (blob: Blob, filename: string, kind: 'video' | 'png-seq' | 'audio') => {
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setDownloadFilename(filename);
    setExportedKind(kind);
    setVerifiedMeta(null);
    setStatus('done');

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const waitIfPaused = async () => {
    while (pausedRef.current && !abortRef.current?.signal.aborted) {
      await new Promise((r) => setTimeout(r, 80));
    }
  };

  const updateProgressMetrics = (pct: number, t: number) => {
    setProgress(pct);
    setRenderedTime(t);
    const elapsedSec = Math.max(0.05, (performance.now() - renderStartWallRef.current) / 1000);
    const activeFps = fpsOverride || project.fps;
    const totalFrames = Math.max(1, Math.ceil(targetDuration * activeFps));
    const doneFrames = Math.max(1, Math.round((pct / 100) * totalFrames));
    const fpsNow = Number((doneFrames / elapsedSec).toFixed(1));
    setRenderSpeedFps(fpsNow);
    const remainingFrames = Math.max(0, totalFrames - doneFrames);
    setEtaSec(fpsNow > 0.2 ? Math.ceil(remainingFrames / fpsNow) : null);
  };

  const startExport = async () => {
    setStatus('rendering');
    setIsPaused(false);
    pausedRef.current = false;
    renderStartWallRef.current = performance.now();
    setProgress(0);
    setErrorMsg('');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await exportProjectToVideoFile(
        project,
        assets,
        quality,
        updateProgressMetrics,
        controller.signal,
        {
          range: activeRange,
          bitrateMbps,
          fpsOverride: fpsOverride || undefined,
          container,
          smoothing,
          motionBlurSamples,
          waitIfPaused,
        }
      );
      triggerDownload(result.blob, result.filename, 'video');
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Falha inesperada na renderização.'
        );
        setStatus('error');
      } else {
        setStatus('idle');
      }
    }
  };

  const startPngSequenceExport = async () => {
    setStatus('rendering');
    setIsPaused(false);
    pausedRef.current = false;
    renderStartWallRef.current = performance.now();
    setProgress(0);
    setErrorMsg('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await exportPngSequenceArchive(
        project,
        assets,
        quality,
        updateProgressMetrics,
        controller.signal,
        activeRange,
        seqFormat,
        waitIfPaused
      );
      triggerDownload(result.blob, result.filename, 'png-seq');
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorMsg(err instanceof Error ? err.message : 'Erro ao exportar sequência de imagens.');
        setStatus('error');
      } else {
        setStatus('idle');
      }
    }
  };

  const exportSubtitlesFile = (format: 'srt' | 'vtt') => {
    const content = serializeClipsToSubtitles(project.clips, format);
    const safeName = project.projectName.trim().toLowerCase().replace(/[^a-z0-9-_]+/gi, '-') || 'legendas';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName}.${format}`;
    a.click();
  };

  const startWavExport = async () => {
    setStatus('rendering');
    setProgress(35);
    setErrorMsg('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await exportAudioWavFile(project, assets, controller.signal, activeRange);
      triggerDownload(result.blob, result.filename, 'audio');
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorMsg(err instanceof Error ? err.message : 'Erro ao exportar áudio WAV.');
        setStatus('error');
      } else {
        setStatus('idle');
      }
    }
  };

  const handleClose = () => {
    if (status === 'rendering') {
      abortRef.current?.abort();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#121215] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-[#3b82f6]" />
            <h3 className="text-sm font-semibold text-[#f4f4f5]">
              Exportar Vídeo Final
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded text-[#71717a] hover:text-[#f4f4f5] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3.5 max-h-[calc(100dvh-8rem)] overflow-y-auto">
          {status === 'idle' || status === 'error' ? (
            <>
              <div>
                <label className="text-xs font-medium text-[#a1a1aa] block mb-2">
                  Qualidade de Renderização
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['720p', 'HD 720p Rápido', '5 Mbps • Leve'],
                      ['1080p', 'Full HD 1080p', '8 Mbps • Alta Nitidez'],
                      ['2k', '2K QHD 1440p', '14 Mbps • Estúdio'],
                      ['4k', '4K UHD 2160p', '22 Mbps • Master'],
                    ] as const
                  ).map(([q, title, sub]) => (
                    <button
                      key={q}
                      onClick={() => {
                        setQuality(q);
                        setBitrateMbps(q === '4k' ? 22 : q === '2k' ? 14 : q === '1080p' ? 8 : 5);
                      }}
                      className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        quality === q
                          ? 'bg-[#2563eb]/15 border-[#3b82f6] text-[#f4f4f5]'
                          : 'bg-[#18181c] border-[#27272a] text-[#a1a1aa]'
                      }`}
                    >
                      <p className="text-xs font-semibold">{title}</p>
                      <p className="font-mono-code text-[10px] text-[#71717a] mt-0.5">{sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[#a1a1aa] block mb-1">Formato / Contêiner</label>
                  <select
                    aria-label="Formato de contêiner"
                    value={project.transparentBg ? 'webm' : container}
                    disabled={!!project.transparentBg}
                    onChange={(e) => setContainer(e.target.value as 'webm' | 'mp4')}
                    className="w-full bg-[#18181c] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-[#f4f4f5]"
                  >
                    <option value="webm">WebM (VP8 + Opus)</option>
                    <option value="mp4">MP4 (H.264 + AAC/Opus)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[#a1a1aa] block mb-1">Intervalo</label>
                  <select
                    aria-label="Intervalo de renderização"
                    value={rangeMode}
                    onChange={(e) => setRangeMode(e.target.value as 'full' | 'workArea')}
                    className="w-full bg-[#18181c] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-[#f4f4f5]"
                  >
                    <option value="full">Composição Completa</option>
                    <option value="workArea">Área de Trabalho (B..N)</option>
                  </select>
                </div>
              </div>

              <div className="text-xs">
                <label className="text-[#a1a1aa] block mb-1">Bitrate ({bitrateMbps} Mbps)</label>
                <input
                  type="range"
                  min={2}
                  max={30}
                  step={1}
                  value={bitrateMbps}
                  onChange={(e) => setBitrateMbps(Number(e.target.value))}
                  className="studio-slider w-full mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[#a1a1aa] block mb-1">FPS de Saída</label>
                  <select
                    aria-label="FPS de saida"
                    value={fpsOverride}
                    onChange={(e) => setFpsOverride(e.target.value === '' ? '' : Number(e.target.value) as 24 | 30 | 60 | 120)}
                    className="w-full bg-[#18181c] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-[#f4f4f5]"
                  >
                    <option value="">Projeto ({project.fps} fps)</option>
                    <option value={24}>24 fps</option>
                    <option value={30}>30 fps</option>
                    <option value={60}>60 fps</option>
                    <option value={120}>120 fps (ultra suave)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#a1a1aa] block mb-1">Suavização de Clipe</label>
                  <select
                    aria-label="Suavizacao de clipe"
                    value={smoothing}
                    onChange={(e) => setSmoothing(e.target.value as 'off' | 'flow' | 'blend')}
                    className="w-full bg-[#18181c] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-[#f4f4f5]"
                  >
                    <option value="flow">Fluxo óptico (recomendado)</option>
                    <option value="blend">Mistura de quadros</option>
                    <option value="off">Desligada</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[#a1a1aa] block mb-1">
                  Motion Blur ({motionBlurSamples === 0 ? 'Desligado' : `${motionBlurSamples} amostras/quadro`})
                </label>
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={1}
                  value={motionBlurSamples}
                  onChange={(e) => setMotionBlurSamples(Number(e.target.value))}
                  className="studio-slider w-full mt-2.5"
                />
                <p className="text-[10px] text-[#71717a] mt-1">
                  Clipes de baixa taxa (ex.: 15 fps) são re-tempos com fluxo óptico e saem suaves em 60/120 fps.
                </p>
              </div>

              <div className="rounded-lg bg-[#18181c] border border-[#27272a] p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#71717a]">Contêiner / Codec real</span>
                  <span className="font-mono-code text-[#f4f4f5]">
                    {container === 'mp4' && !project.transparentBg
                      ? 'MP4 • H.264 + AAC/Opus'
                      : 'WebM • VP8 + Opus'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#71717a]">Tamanho estimado</span>
                  <span className="font-mono-code text-[#f4f4f5]">≈ {estimatedMB} MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#71717a]">Aceleração WebCodecs</span>
                  <span className="font-mono-code text-[#f4f4f5]">
                    {capabilities.hasWebCodecs ? 'Disponível (quadro-a-quadro)' : 'Indisponível (tempo real)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#71717a]">Dimensões Finais</span>
                  <span className="font-mono-code text-[#f4f4f5]">
                    {outW} × {outH} px
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#71717a]">Taxa de Quadros</span>
                  <span className="font-mono-code text-[#f4f4f5]">{project.fps} FPS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#71717a]">Duração Total</span>
                  <span className="font-mono-code text-[#f4f4f5]">
                    {formatTimecode(targetDuration, true, project.fps)}
                  </span>
                </div>
              </div>

              {errorMsg && (
                <p className="text-xs text-[#fca5a5] bg-[#ef4444]/15 border border-[#ef4444]/30 rounded-lg p-2.5">
                  {errorMsg}
                </p>
              )}

              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={startExport}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    Renderizar e Baixar Vídeo (.{container === 'mp4' && !project.transparentBg ? 'mp4' : 'webm'})
                  </span>
                </button>

                <p className="text-[10px] leading-relaxed text-[#71717a]">
                  {capabilities.mp4ViaRecorder
                    ? 'Este navegador também sinaliza gravação MP4/H.264; o arquivo continua sendo entregue em WebM para preservar transparência e precisão de quadros.'
                    : 'MP4/H.264 não é gravado por este navegador. A exportação usa WebM (VP8/VP9) — nunca rotulamos um arquivo WebM como MP4.'}
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex rounded-lg bg-[#18181c] border border-[#27272a] overflow-hidden">
                    <button
                      onClick={startPngSequenceExport}
                      className="flex-1 py-2 px-2 hover:bg-[#27272a] text-[#a1a1aa] hover:text-white text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Images className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" />
                      <span>Sequência ({seqFormat.toUpperCase()})</span>
                    </button>
                    <select
                      aria-label="Formato da sequência de imagens"
                      value={seqFormat}
                      onChange={(e) => setSeqFormat(e.target.value as 'png' | 'webp' | 'jpeg')}
                      className="bg-[#121215] border-l border-[#27272a] px-1.5 text-[10px] text-[#f4f4f5] cursor-pointer"
                    >
                      <option value="png">PNG</option>
                      <option value="webp">WebP</option>
                      <option value="jpeg">JPG</option>
                    </select>
                  </div>

                  <button
                    onClick={startWavExport}
                    className="py-2 px-3 rounded-lg bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Music className="w-3.5 h-3.5 text-[#34d399]" />
                    <span>Exportar Áudio (.wav)</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => exportSubtitlesFile('srt')}
                    className="py-1.5 px-2.5 rounded-lg bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-amber-400" />
                    <span>Legendas (.SRT)</span>
                  </button>
                  <button
                    onClick={() => exportSubtitlesFile('vtt')}
                    className="py-1.5 px-2.5 rounded-lg bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-sky-400" />
                    <span>Legendas (.VTT)</span>
                  </button>
                </div>

                <button
                  onClick={() => {
                    onCaptureFramePng();
                    onClose();
                  }}
                  className="w-full py-2 px-4 rounded-lg bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5] text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Salvar Quadro Atual como Thumbnail (.PNG)</span>
                </button>
              </div>
            </>
          ) : status === 'rendering' ? (
            <div className="py-4 space-y-4 text-center">
              <Loader2 className={`w-8 h-8 text-[#3b82f6] mx-auto ${isPaused ? '' : 'animate-spin'}`} />
              <div>
                <p className="text-sm font-semibold text-[#f4f4f5]">
                  {isPaused
                    ? 'Renderização pausada'
                    : 'Renderizando composição quadro a quadro...'}
                </p>
                <p className="font-mono-code text-xs text-[#71717a] mt-1">
                  {formatTimecode(renderedTime, true, project.fps)} /{' '}
                  {formatTimecode(targetDuration, true, project.fps)} ({progress}%)
                </p>
                <div className="flex items-center justify-center gap-3 mt-1.5 text-[11px] font-mono-code text-[#a1a1aa]">
                  <span>Velocidade: {renderSpeedFps} fps</span>
                  {etaSec !== null && <span>ETA: ~{etaSec}s</span>}
                </div>
              </div>

              <div className="w-full h-2 rounded-full bg-[#1c1c21] overflow-hidden">
                <div
                  style={{ width: `${progress}%` }}
                  className="h-full bg-[#2563eb] transition-all duration-150"
                />
              </div>

              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => {
                    const next = !isPaused;
                    pausedRef.current = next;
                    setIsPaused(next);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-[#18181c] hover:bg-[#27272a] border border-[#27272a] text-xs text-[#f4f4f5] flex items-center gap-1.5 cursor-pointer"
                >
                  {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  <span>{isPaused ? 'Retomar' : 'Pausar'}</span>
                </button>
                <button
                  onClick={() => {
                    pausedRef.current = false;
                    abortRef.current?.abort();
                  }}
                  className="px-4 py-1.5 rounded-lg bg-[#1c1c21] hover:bg-[#27272a] border border-[#27272a] text-xs text-[#a1a1aa] cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="py-2 space-y-3 text-center">
              <CheckCircle2 className="w-9 h-9 text-[#10b981] mx-auto" />
              <div>
                <p className="text-sm font-semibold text-[#f4f4f5]">
                  Seu vídeo está pronto!
                </p>
                <p className="font-mono-code text-xs text-[#71717a] mt-0.5">
                  {downloadFilename}
                </p>
              </div>

              {/* Inline Playback Verification Player */}
              {downloadUrl && exportedKind === 'video' && (
                <div className="rounded-lg overflow-hidden border border-[#27272a] bg-black">
                  <video
                    src={downloadUrl}
                    controls
                    data-testid="exported-video-preview"
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      setVerifiedMeta({
                        w: v.videoWidth,
                        h: v.videoHeight,
                        dur: v.duration,
                      });
                    }}
                    className="w-full max-h-48 object-contain"
                  />
                  {verifiedMeta && (
                    <div className="px-2.5 py-1 bg-[#18181c] text-[10px] font-mono-code text-[#a1a1aa] flex justify-between">
                      <span>
                        Validado: {verifiedMeta.w}×{verifiedMeta.h}px
                      </span>
                      <span>Duração: {verifiedMeta.dur.toFixed(2)}s</span>
                    </div>
                  )}
                </div>
              )}

              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download={downloadFilename}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#059669] hover:bg-[#10b981] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Baixar Novamente</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ShortcutsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const groups: { title: string; items: { key: string; action: string }[] }[] = [
    {
      title: 'Reprodução & Prévia',
      items: [
        { key: 'Espaço', action: 'Play / Pause' },
        { key: 'R  ou  0 (numérico)', action: 'Prévia RAM — renderizar área de trabalho' },
        { key: 'Shift + Espaço', action: 'Reproduzir somente a área de trabalho' },
        { key: 'B / N', action: 'Definir início / fim da área de trabalho' },
        { key: '← / → ou PgUp / PgDn', action: 'Voltar / avançar 1 quadro' },
        { key: 'Shift + ← / →', action: 'Voltar / avançar 10 quadros' },
        { key: 'Home / End', action: 'Ir ao início / fim da composição' },
      ],
    },
    {
      title: 'Camadas & Composições',
      items: [
        { key: 'Ctrl + K', action: 'Abrir Paleta Global de Comandos' },
        { key: 'Ctrl + Shift + D', action: 'Dividir camada na agulha (Split Layer)' },
        { key: 'Ctrl + Shift + C', action: 'Pré-compor camada selecionada' },
        { key: 'Ctrl + D', action: 'Duplicar camada' },
        { key: '[ / ]', action: 'Mover início / fim da camada até a agulha' },
        { key: 'Alt + [ / Alt + ]', action: 'Aparar entrada / saída na agulha' },
        { key: 'I / O', action: 'Ir ao início / fim da camada selecionada' },
        { key: 'Delete / Shift + Delete', action: 'Excluir / Excluir e fechar espaço' },
      ],
    },
    {
      title: 'Propriedades, Curvas & Efeitos',
      items: [
        { key: 'S', action: 'Revelar Escala no inspetor' },
        { key: 'P', action: 'Revelar Posição no inspetor' },
        { key: 'T', action: 'Revelar Opacidade no inspetor' },
        { key: 'U', action: 'Mostrar / ocultar keyframes (Graph Editor)' },
        { key: 'M', action: 'Adicionar marcador na agulha' },
        { key: 'F9', action: 'Easy Ease nos keyframes selecionados' },
        { key: 'Ctrl + Z / Ctrl + Y', action: 'Desfazer / Refazer' },
        { key: '+ / −', action: 'Zoom da timeline' },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#121215] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-[#3b82f6]" />
            <h3 className="text-sm font-semibold text-[#f4f4f5]">
              Central de Atalhos do Estúdio
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#71717a] hover:text-[#f4f4f5] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[calc(100dvh-9rem)] overflow-y-auto p-4 space-y-4">
          {groups.map((group) => (
            <section key={group.title}>
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#60a5fa] mb-1.5">
                {group.title}
              </h4>
              <div className="divide-y divide-[#27272a]/60 rounded-md border border-[#27272a]/70 bg-[#141418]">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="px-3 py-1.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-[#a1a1aa]">{item.action}</span>
                    <kbd className="font-mono-code shrink-0 text-[10px] px-2 py-0.5 rounded bg-[#1c1c21] border border-[#333339] text-[#f4f4f5]">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
