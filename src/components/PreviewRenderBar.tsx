import { CircleCheck, Eraser, Loader2, Play, Square, X, Zap } from 'lucide-react';
import type { PreviewResolution, WorkArea } from '../types/editor';
import type { PreviewRenderState } from '../hooks/usePreviewRender';
import { formatTimecode } from '../utils/mediaHelpers';

export interface PreviewControlsProps {
  autoPreview?: boolean;
  autoBusy?: boolean;
  onToggleAutoPreview?: () => void;
  previewState: PreviewRenderState;
  previewResolution: PreviewResolution;
  onChangePreviewResolution: (resolution: PreviewResolution) => void;
  workArea: WorkArea;
  onSetWorkAreaStart: () => void;
  onSetWorkAreaEnd: () => void;
  onFitWorkArea: () => void;
  onRenderPreview: () => void;
  onCancelPreview: () => void;
  onClearPreview: () => void;
  onPlayWorkArea: () => void;
  playingWorkArea: boolean;
  fps: number;
}

export function PreviewRenderBar({ autoPreview, autoBusy, onToggleAutoPreview, previewState: state, previewResolution, onChangePreviewResolution, workArea, onSetWorkAreaStart, onSetWorkAreaEnd, onFitWorkArea, onRenderPreview, onCancelPreview, onClearPreview, onPlayWorkArea, playingWorkArea, fps }: PreviewControlsProps) {
  const rendering = state.status === 'rendering';
  return <div className="preview-render-bar">
    <div className="preview-area-controls">
      <span className="preview-area-label">Area de trabalho</span>
      <button title="Definir inicio na agulha (B)" onClick={onSetWorkAreaStart}><kbd>B</kbd><span>{formatTimecode(workArea.start, true, fps)}</span></button>
      <span className="preview-range-dash">/</span>
      <button title="Definir fim na agulha (N)" onClick={onSetWorkAreaEnd}><kbd>N</kbd><span>{formatTimecode(workArea.end, true, fps)}</span></button>
      <button className="preview-fit-area" onClick={onFitWorkArea} title="Usar toda a composicao">Tudo</button>
    </div>
    <div className="preview-render-actions">
      <button aria-label="Cache automatico da timeline" aria-pressed={!!autoPreview} onClick={onToggleAutoPreview} className={`auto-preview-toggle ${autoPreview ? 'enabled' : ''}`} title="Renderiza automaticamente os quadros por onde a agulha passa e alguns quadros a frente. Limite: 64 MB / 600 quadros.">
        {autoBusy ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
        <span>Auto {autoPreview ? 'ON' : 'OFF'}</span>
      </button>
      <span role="status" className={`preview-cache-status ${state.frameCount ? 'has-cache' : ''}`}>
        {rendering ? <><Loader2 size={12} className="animate-spin" />{state.progress}%</> : state.frameCount ? <><CircleCheck size={12} />{state.frameCount} quadros<span className="cache-size"> / {(state.bytes / 1024 / 1024).toFixed(1)} MB</span></> : 'Previa em tempo real'}
      </span>
      <select aria-label="Qualidade da previa" value={previewResolution} onChange={(event) => onChangePreviewResolution(Number(event.target.value) as PreviewResolution)} title="Resolucao somente da previa. A exportacao mantem a qualidade escolhida.">
        <option value={1}>Completa</option><option value={2}>1/2</option><option value={4}>1/4</option>
      </select>
      {rendering ? <button className="render-preview-button is-rendering" onClick={onCancelPreview}><X size={13} /><span>Cancelar</span></button> : <button className="render-preview-button" onClick={onRenderPreview}><Play size={12} /><span>Renderizar previa</span><kbd>R</kbd></button>}
      <button title="Reproduzir area de trabalho (Shift+Espaco)" aria-label="Reproduzir area de trabalho" className={`play-work-area ${playingWorkArea ? 'active' : ''}`} onClick={onPlayWorkArea}>{playingWorkArea ? <Square size={13} /> : <Play size={13} />}</button>
      <button title="Limpar cache da previa" aria-label="Limpar cache da previa" disabled={!state.frameCount && !rendering} onClick={onClearPreview}><Eraser size={13} /></button>
    </div>
    {rendering && <div className="preview-render-progress" style={{ width: `${state.progress}%` }} />}
    {state.error && <div className="preview-render-error" role="alert">{state.error}</div>}
  </div>;
}