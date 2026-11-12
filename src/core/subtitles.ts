import type { TimelineClip } from '../types/editor';
import { DEFAULT_FILTERS, uid } from '../utils/mediaHelpers';

export interface SubtitleCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

function parseTimestampToSec(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]) || 0;
    const m = Number(parts[1]) || 0;
    const s = Number(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]) || 0;
    const s = Number(parts[1]) || 0;
    return m * 60 + s;
  }
  return 0;
}

function formatSecToSrt(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatSecToVtt(sec: number): string {
  return formatSecToSrt(sec).replace(',', '.');
}

/**
 * Parses .srt or .vtt subtitle text into normalized cues.
 */
export function parseSubtitles(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines[0].toUpperCase().startsWith('WEBVTT') || lines[0].startsWith('NOTE')) continue;

    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;

    const timeLine = lines[arrowIdx];
    const [startRaw, endWithSettings] = timeLine.split('-->');
    const endRaw = (endWithSettings || '').trim().split(/\s+/)[0];
    const startTime = parseTimestampToSec(startRaw);
    const endTime = Math.max(startTime + 0.25, parseTimestampToSec(endRaw));

    const textLines = lines
      .slice(arrowIdx + 1)
      .map((l) => l.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    if (textLines.length === 0) continue;

    cues.push({
      id: uid('cue'),
      startTime: Number(startTime.toFixed(3)),
      endTime: Number(endTime.toFixed(3)),
      text: textLines.join('\n'),
    });
  }

  return cues;
}

/**
 * Converts parsed subtitle cues into TimelineClip text layers on `trackId`.
 */
export function buildSubtitleClips(cues: SubtitleCue[], trackId: string): TimelineClip[] {
  return cues.map((cue, idx) => {
    const duration = Math.max(0.25, Number((cue.endTime - cue.startTime).toFixed(3)));
    return {
      id: uid('sub'),
      name: `Legenda #${idx + 1}`,
      trackId,
      type: 'text',
      startTime: cue.startTime,
      duration,
      trimStart: 0,
      maxDuration: 300,
      speed: 1,
      volume: 100,
      muted: true,
      fadeIn: 0.08,
      fadeOut: 0.08,
      opacity: 100,
      scale: 100,
      rotation: 0,
      x: 0,
      y: 36,
      flipH: false,
      flipV: false,
      fitMode: 'contain',
      blendMode: 'source-over',
      transitionIn: 'fade',
      transitionOut: 'fade',
      transitionInDuration: 0.1,
      transitionOutDuration: 0.1,
      motionPreset: 'none',
      filters: { ...DEFAULT_FILTERS },
      textStyle: {
        text: cue.text,
        fontFamily: 'Inter',
        fontSize: 34,
        fontWeight: 700,
        color: '#ffffff',
        strokeColor: '#09090b',
        strokeWidth: 2,
        backgroundColor: '#09090b',
        backgroundOpacity: 65,
        textAlign: 'center',
        animation: 'fade-up',
        letterSpacing: 0.5,
        lineHeightMultiplier: 1.22,
        borderRadius: 10,
        shadowBlur: 10,
        uppercase: false,
      },
    };
  });
}

/**
 * Exports all active text clips in chronological order to .srt or .vtt format.
 */
export function serializeClipsToSubtitles(
  clips: TimelineClip[],
  format: 'srt' | 'vtt' = 'srt'
): string {
  const textClips = clips
    .filter((c) => c.enabled !== false && c.type === 'text' && c.textStyle?.text.trim())
    .sort((a, b) => a.startTime - b.startTime);

  if (format === 'vtt') {
    const lines = ['WEBVTT', ''];
    textClips.forEach((c, idx) => {
      const s = formatSecToVtt(c.startTime);
      const e = formatSecToVtt(c.startTime + c.duration);
      lines.push(`${idx + 1}`);
      lines.push(`${s} --> ${e}`);
      lines.push(c.textStyle!.text.trim());
      lines.push('');
    });
    return lines.join('\n');
  }

  const lines: string[] = [];
  textClips.forEach((c, idx) => {
    const s = formatSecToSrt(c.startTime);
    const e = formatSecToSrt(c.startTime + c.duration);
    lines.push(`${idx + 1}`);
    lines.push(`${s} --> ${e}`);
    lines.push(c.textStyle!.text.trim());
    lines.push('');
  });
  return lines.join('\n');
}
