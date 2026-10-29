import type { MediaAsset, ProjectState } from '../types/editor';
import { MediaElementPool, renderFrameToCanvas } from '../utils/compositor';
import { prepareMediaFrame, PreviewFrameCache } from '../utils/previewCache';

/** Single asynchronous queue: the playhead always outranks speculative look-ahead. */
export class AutoPreviewRenderer {
  private pending = new Set<number>();
  private controller = new AbortController();
  private pool = new MediaElementPool();
  private canvas: HTMLCanvasElement;
  private running = false;
  private disposed = false;
  private head = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private project: ProjectState,
    private assets: Map<string, MediaAsset>,
    private cache: PreviewFrameCache,
    private onUpdate: (busy: boolean, error?: string) => void
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = cache.width;
    this.canvas.height = cache.height;
  }

  schedule(time: number, duration: number, playing: boolean) {
    if (this.disposed) return;
    const index = Math.max(0, Math.min(Math.ceil(duration * this.project.fps) - 1, this.cache.frameIndex(time)));
    if (Math.abs(index - this.head) > this.project.fps) this.pending.clear();
    this.head = index;
    const last = Math.ceil(duration * this.project.fps) - 1;
    const ahead = playing ? 3 : Math.min(10, Math.ceil(this.project.fps * 0.28));
    for (let offset = -2; offset <= ahead; offset++) {
      const frame = index + offset;
      if (frame < 0 || frame > last || this.cache.frames.has(frame)) continue;
      this.pending.add(frame);
    }
    if (this.pending.size > 48) {
      const keep = new Set([...this.pending].sort((a, b) => Math.abs(a - index) - Math.abs(b - index)).slice(0, 48));
      for (const frame of this.pending) if (!keep.has(frame)) this.pending.delete(frame);
    }
    if (!this.running && !this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.pump(); }, playing ? 12 : 100);
    }
  }

  private async pump() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.onUpdate(true);
    const context = this.canvas.getContext('2d', { alpha: true });
    let errorMessage: string | undefined;
    try {
      if (!context) throw new Error('Canvas indisponivel para cache automatico.');
      await document.fonts.ready;
      while (this.pending.size && !this.disposed) {
        const next = [...this.pending].sort((a, b) => Math.abs(a - this.head) - Math.abs(b - this.head))[0];
        this.pending.delete(next);
        if (this.cache.frames.has(next)) continue;
        const time = next / this.project.fps;
        await prepareMediaFrame(this.project, this.assets, this.pool, time, this.controller.signal);
        const bounds = renderFrameToCanvas(context, this.canvas.width, this.canvas.height, this.project.tracks, this.project.clips, this.assets, this.pool, time, {
          backgroundColor: this.project.backgroundColor,
          transparentBg: this.project.transparentBg,
          fps: this.project.fps,
          compositions: this.project.compositions,
        });
        const blob = await new Promise<Blob>((resolve, reject) => this.canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error('Falha ao criar quadro de cache.')),
          this.project.transparentBg ? 'image/png' : 'image/jpeg', 0.9
        ));
        if (this.disposed) break;
        this.cache.storeAutomatic(next, blob, bounds, this.head);
        this.onUpdate(true);
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
    } catch (error) {
      if (!this.disposed && !this.controller.signal.aborted) errorMessage = error instanceof Error ? error.message : 'Falha no cache automatico.';
    } finally {
      this.running = false;
      if (!this.disposed) this.onUpdate(false, errorMessage);
    }
  }

  dispose() {
    this.disposed = true;
    this.controller.abort();
    if (this.timer) clearTimeout(this.timer);
    this.pending.clear();
    this.pool.dispose();
  }
}