import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight, Check, Crosshair, Eraser, Focus, Loader2, Play, RotateCcw, Scan, ShieldCheck, X } from 'lucide-react';
import type { ClipVfx, MediaAsset, MotionAnalysis, NormalizedRect, ProjectState, TimelineClip } from '../types/editor';
import { MediaElementPool } from '../utils/compositor';
import { getClipSourceTime } from '../utils/timeRemap';
import { seekVideoFrame } from '../utils/previewCache';
import { analyzeMotion, visibleSourceRange } from '../core/vision/analyzeMotion';
import { sampleMotion } from '../core/vision/motion';
import { cleanupRectAtTime } from '../core/vision/sourceEffects';
import { trackingToKeyframes } from '../core/vision/trackingKeyframes';

interface Props {
  clip: TimelineClip;
  asset: MediaAsset | undefined;
  project: ProjectState;
  currentTime: number;
  locked: boolean;
  onUpdate: (id: string, patch: Partial<TimelineClip>) => void;
  onCommit: () => void;
  onBusy: (busy: boolean) => void;
  onPause: () => void;
}

const DEFAULT_RECT: NormalizedRect = { x: 0.38, y: 0.3, width: 0.2, height: 0.26 };

export function MotionToolsPanel({ clip, asset, project, currentTime, locked, onUpdate, onCommit, onBusy, onPause }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [tool, setTool] = useState<'point' | 'region'>('point');
  const [seed, setSeed] = useState({ x: 0.5, y: 0.5 });
  const [draftRect, setDraftRect] = useState<NormalizedRect | null>(null);
  const [activity, setActivity] = useState<{ kind: 'point' | 'camera'; done: number; total: number; confidence: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState('');
  const [compare, setCompare] = useState(false);
  const [showPath, setShowPath] = useState(true);
  const callbacksRef = useRef({ onBusy, onPause });
  callbacksRef.current = { onBusy, onPause };
  const pool = useMemo(() => new MediaElementPool(), [asset?.url]);
  const sourceTime = getClipSourceTime(clip, Math.max(0, Math.min(clip.duration - 0.001, currentTime - clip.startTime)));
  const sourceRatio = (asset?.height || 720) / (asset?.width || 1280);
  const canvasH = Math.max(48, Math.round(256 * sourceRatio));
  const vfx = clip.vfx || {};
  const tracking = vfx.tracking;
  const point = tracking ? sampleMotion(tracking, sourceTime) : seed;
  const displayedRect = draftRect || cleanupRectAtTime(clip, sourceTime) || DEFAULT_RECT;
  const range = asset ? visibleSourceRange(clip, asset.duration) : null;
  const analysisIdentity = `${clip.id}:${asset?.url}:${range?.start}:${range?.end}`;

  useEffect(() => () => pool.dispose(), [pool]);
  useEffect(() => {
    setError(null);
    setActivity(null);
    return () => { controllerRef.current?.abort(); callbacksRef.current.onBusy(false); };
  }, [analysisIdentity]);

  useEffect(() => {
    if (!asset?.url || !canvasRef.current || activity) return;
    const abort = new AbortController();
    const draw = async () => {
      let source: HTMLVideoElement | HTMLImageElement;
      if (asset.type === 'video') {
        source = pool.getVideo(`tool-${clip.id}`, asset.url);
        source.muted = true;
        await seekVideoFrame(source, sourceTime, abort.signal);
      } else {
        source = pool.getImage(asset.url);
        await source.decode();
      }
      if (abort.signal.aborted) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const processed = compare ? source : pool.sourceEffects.process(source, asset.width || 1280, asset.height || 720, clip, sourceTime, 256);
      ctx.drawImage(processed, 0, 0, canvas.width, canvas.height);
    };
    void draw().catch((reason) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha ao ler quadro.'); });
    return () => abort.abort();
  }, [asset, clip, sourceTime, pool, compare, activity?.kind]);

  const patch = (updates: Partial<ClipVfx>, commit = true) => {
    if (locked || activity) return;
    onUpdate(clip.id, { vfx: { ...vfx, ...updates } });
    if (commit) onCommit();
  };
  const background = vfx.background || { enabled: false, tolerance: 34, softness: 18, color: null, connected: true };
  const cleanup = vfx.cleanup || { enabled: false, rect: DEFAULT_RECT, mode: 'clone' as const, sourceOffsetX: 0.24, sourceOffsetY: 0, feather: 20, followTrack: false };

  const startAnalysis = async (kind: MotionAnalysis['kind']) => {
    if (!asset || locked) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    callbacksRef.current.onPause();
    callbacksRef.current.onBusy(true);
    setError(null);
    setActivity({ kind, done: 0, total: 1, confidence: 0 });
    try {
      const analysis = await analyzeMotion(asset, clip, kind, { ...seed, time: sourceTime }, controller.signal, (progress) => setActivity({ kind, ...progress }));
      if (controller.signal.aborted) return;
      onUpdate(clip.id, { vfx: kind === 'point'
        ? { ...vfx, tracking: analysis }
        : { ...vfx, stabilization: { enabled: true, strength: 100, smoothing: 0.5, crop: 8, analysis } }
      });
      onCommit();
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Analise indisponivel.');
    } finally {
      if (controllerRef.current === controller) { setActivity(null); callbacksRef.current.onBusy(false); }
    }
  };

  const handleSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (locked || activity || !surfaceRef.current) return;
    event.preventDefault();
    callbacksRef.current.onPause();
    const bounds = surfaceRef.current.getBoundingClientRect();
    const normalized = (x: number, y: number) => ({ x: Math.max(0.02, Math.min(0.98, (x - bounds.left) / bounds.width)), y: Math.max(0.02, Math.min(0.98, (y - bounds.top) / bounds.height)) });
    const first = normalized(event.clientX, event.clientY);
    if (tool === 'point') { setSeed(first); return; }
    let rect = { x: first.x, y: first.y, width: 0.01, height: 0.01 };
    const move = (ev: PointerEvent) => {
      const next = normalized(ev.clientX, ev.clientY);
      rect = { x: Math.min(first.x, next.x), y: Math.min(first.y, next.y), width: Math.abs(first.x - next.x), height: Math.abs(first.y - next.y) };
      setDraftRect(rect);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDraftRect(null);
      if (rect.width > 0.02 && rect.height > 0.02) patch({ cleanup: { ...cleanup, rect, referenceTime: sourceTime } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  };

  const targets = project.clips.filter((c) => c.id !== clip.id && c.type !== 'audio' && !project.tracks.find((t) => t.id === c.trackId)?.locked);
  return <div className="motion-tools" data-testid="motion-tools-panel">
    <header className="vision-panel-heading"><span><Scan size={15} /> VFX & movimento</span><small>Processamento local</small></header>
    <div className="vision-view-toolbar">
      <button aria-pressed={tool === 'point'} onClick={() => setTool('point')} title="Clique em um detalhe contrastante para rastrear"><Crosshair size={12} /> Ponto</button>
      <button aria-pressed={tool === 'region'} onClick={() => setTool('region')} title="Arraste para selecionar o objeto"><Eraser size={12} /> Area</button>
      <button aria-pressed={compare} onClick={() => setCompare((v) => !v)} title="Comparar com o quadro original">{compare ? 'Original' : 'Resultado'}</button>
    </div>
    <div ref={surfaceRef} className={`vision-source-view ${tool === 'region' ? 'selecting-region' : ''}`} style={{ aspectRatio: `256 / ${canvasH}` }} onPointerDown={handleSelection} data-testid="vision-source-view">
      <canvas ref={canvasRef} width={256} height={canvasH} data-testid="vision-source-canvas" />
      {showPath && tracking && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="vision-path"><polyline points={tracking.samples.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')} fill="none" stroke="#63e6be" strokeWidth="1" vectorEffect="non-scaling-stroke" /></svg>}
      {tool === 'point' && <span className="vision-crosshair" style={{ left: `${(tracking ? point.x : seed.x) * 100}%`, top: `${(tracking ? point.y : seed.y) * 100}%` }}><Crosshair size={22} /></span>}
      {(tool === 'region' || cleanup.enabled) && <>
        <span className="vision-region" style={{ left: `${displayedRect.x * 100}%`, top: `${displayedRect.y * 100}%`, width: `${displayedRect.width * 100}%`, height: `${displayedRect.height * 100}%` }} />
        {cleanup.mode === 'clone' && <span className="vision-region is-source" style={{ left: `${(displayedRect.x + cleanup.sourceOffsetX) * 100}%`, top: `${(displayedRect.y + cleanup.sourceOffsetY) * 100}%`, width: `${displayedRect.width * 100}%`, height: `${displayedRect.height * 100}%` }} />}
      </>}
    </div>
    <p className="vision-hint">{tool === 'point' ? 'Clique num detalhe do quadro de origem. O rastreio analisa para frente e para tras.' : 'Arraste sobre o objeto. Retangulo branco: destino; tracejado: textura de origem.'}</p>

    {activity && <div className="vision-progress" role="status">
      <div><Loader2 size={13} className="animate-spin" /><span>{activity.kind === 'point' ? 'Rastreando' : 'Estabilizando'} {Math.min(100, Math.round(activity.done / activity.total * 100))}%</span><button onClick={() => controllerRef.current?.abort()} aria-label="Cancelar analise de movimento"><X size={13} /></button></div>
      <progress value={activity.done} max={activity.total} />
      <small>Correlacao do ultimo quadro: {Math.round(activity.confidence * 100)}%</small>
    </div>}
    {error && <div className="vision-error" role="alert">{error}</div>}

    <fieldset disabled={locked || !!activity}>
      <section className="vision-section">
        <div className="vision-section-heading"><h4><Eraser size={13} /> Remover fundo</h4><button role="switch" aria-label="Ativar remocao de fundo" aria-checked={background.enabled} className={`studio-switch ${background.enabled ? 'is-on' : ''}`} onClick={() => patch({ background: { ...background, enabled: !background.enabled } })}><span /></button></div>
        <p>Recorte por cor das bordas. Melhor em fundo uniforme; nao e segmentacao de pessoas por IA.</p>
        {background.enabled && <>
          <label>Cor de fundo<select aria-label="Metodo de recorte" value={background.color || 'auto'} onChange={(e) => patch({ background: { ...background, color: e.target.value === 'auto' ? null : e.target.value } })}><option value="auto">Detectar pelas bordas</option><option value="#00ff00">Verde</option><option value="#0000ff">Azul</option><option value="#ffffff">Branco</option><option value="#000000">Preto</option></select></label>
          <Control label="Tolerancia de fundo" value={background.tolerance} min={3} max={150} change={(value) => patch({ background: { ...background, tolerance: value } }, false)} commit={onCommit} />
          <Control label="Suavidade de fundo" value={background.softness} min={1} max={70} change={(value) => patch({ background: { ...background, softness: value } }, false)} commit={onCommit} />
          <label className="vision-checkbox"><input type="checkbox" checked={background.connected} onChange={(e) => patch({ background: { ...background, connected: e.target.checked } })} /> Preservar cores internas isoladas</label>
        </>}
      </section>

      <section className="vision-section">
        <div className="vision-section-heading"><h4><Crosshair size={13} /> Track Motion</h4>{tracking && <span className="vision-ready"><Check size={10} /> {tracking.samples.length} amostras</span>}</div>
        <p>Rastreia um ponto por correlacao de textura. Sem solver 3D ou tracking planar.</p>
        <button className="vision-action" disabled={asset?.type !== 'video'} onClick={() => void startAnalysis('point')}><Play size={12} />{tracking ? 'Reanalisar ponto' : 'Analisar ponto selecionado'}</button>
        {asset?.type !== 'video' && <small>Selecione um video importado para analisar.</small>}
        {tracking && <>
          <div className="vision-measurements"><span>Confianca media</span><strong>{Math.round(tracking.samples.reduce((sum, s) => sum + s.confidence, 0) / tracking.samples.length * 100)}%</strong></div>
          <label className="vision-checkbox"><input type="checkbox" checked={showPath} onChange={(e) => setShowPath(e.target.checked)} /> Mostrar trajetoria</label>
          <select aria-label="Camada para receber tracking" value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">Escolher camada de destino...</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <button className="vision-action secondary" disabled={!targetId} onClick={() => {
            const target = targets.find((t) => t.id === targetId);
            if (!target) return;
            try { onUpdate(target.id, { keyframes: trackingToKeyframes(clip, target, project) }); onCommit(); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao aplicar movimento.'); }
          }}><ArrowRight size={12} /> Converter em keyframes X/Y</button>
          <small>Substitui X/Y do destino no intervalo comum. Ctrl+Z desfaz.</small>
        </>}
      </section>

      <section className="vision-section">
        <div className="vision-section-heading"><h4><ShieldCheck size={13} /> Estabilizacao 2D</h4>{vfx.stabilization && <button role="switch" aria-label="Ativar estabilizacao" aria-checked={vfx.stabilization.enabled} className={`studio-switch ${vfx.stabilization.enabled ? 'is-on' : ''}`} onClick={() => patch({ stabilization: { ...vfx.stabilization!, enabled: !vfx.stabilization!.enabled } })}><span /></button>}</div>
        <p>Reduz tremor horizontal/vertical por consenso de 12 pontos. Nao corrige rotacao, parallax ou rolling shutter.</p>
        <button className="vision-action" disabled={asset?.type !== 'video'} onClick={() => void startAnalysis('camera')}><Focus size={13} />{vfx.stabilization ? 'Reanalisar camera' : 'Analisar e estabilizar'}</button>
        {vfx.stabilization && <>
          <Control label="Forca da estabilizacao" value={vfx.stabilization.strength} min={0} max={100} change={(value) => patch({ stabilization: { ...vfx.stabilization!, strength: value } }, false)} commit={onCommit} />
          <Control label="Suavizacao (segundos)" value={vfx.stabilization.smoothing} min={0.1} max={1.5} step={0.1} change={(value) => patch({ stabilization: { ...vfx.stabilization!, smoothing: value } }, false)} commit={onCommit} />
          <Control label="Recorte de seguranca (%)" value={vfx.stabilization.crop} min={0} max={30} change={(value) => patch({ stabilization: { ...vfx.stabilization!, crop: value } }, false)} commit={onCommit} />
        </>}
      </section>

      <section className="vision-section">
        <div className="vision-section-heading"><h4><Scan size={13} /> Remover / ocultar objeto</h4><button role="switch" aria-label="Ativar remocao de objeto" aria-checked={cleanup.enabled} className={`studio-switch ${cleanup.enabled ? 'is-on' : ''}`} onClick={() => { setTool('region'); patch({ cleanup: { ...cleanup, enabled: !cleanup.enabled } }); }}><span /></button></div>
        <p>Clonagem de uma regiao vizinha, sem IA generativa. Escolha uma textura limpa para cobrir o objeto.</p>
        {cleanup.enabled && <>
          <select aria-label="Tratamento de objeto" value={cleanup.mode} onChange={(e) => patch({ cleanup: { ...cleanup, mode: e.target.value as 'clone' | 'blur' | 'pixelate' } })}><option value="clone">Clonar textura vizinha</option><option value="blur">Desfocar area</option><option value="pixelate">Pixelizar area</option></select>
          {cleanup.mode === 'clone' && <>
            <Control label="Origem da textura X (%)" value={cleanup.sourceOffsetX * 100} min={-60} max={60} change={(value) => patch({ cleanup: { ...cleanup, sourceOffsetX: value / 100 } }, false)} commit={onCommit} />
            <Control label="Origem da textura Y (%)" value={cleanup.sourceOffsetY * 100} min={-60} max={60} change={(value) => patch({ cleanup: { ...cleanup, sourceOffsetY: value / 100 } }, false)} commit={onCommit} />
            <Control label="Feather da clonagem (%)" value={cleanup.feather} min={0} max={90} change={(value) => patch({ cleanup: { ...cleanup, feather: value } }, false)} commit={onCommit} />
          </>}
          <label className="vision-checkbox"><input type="checkbox" checked={cleanup.followTrack} disabled={!tracking} onChange={(e) => patch({ cleanup: { ...cleanup, followTrack: e.target.checked, referenceTime: sourceTime } })} /> Acompanhar Track Motion</label>
        </>}
      </section>
      <button className="vision-reset" onClick={() => { onUpdate(clip.id, { vfx: undefined }); onCommit(); setError(null); }}><RotateCcw size={12} /> Redefinir VFX desta camada</button>
    </fieldset>
  </div>;
}

function Control({ label, value, min, max, step = 1, change, commit }: { label: string; value: number; min: number; max: number; step?: number; change: (value: number) => void; commit: () => void }) {
  return <label className="vision-slider"><span>{label}<span className="vision-slider-value">{Number(value.toFixed(2))}</span></span><input aria-label={label} className="studio-slider" type="range" min={min} max={max} step={step} value={value} onChange={(e) => change(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /></label>;
}