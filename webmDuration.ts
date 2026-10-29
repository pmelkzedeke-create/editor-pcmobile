interface ElementInfo { id: number; data: number; end: number; size: number }

function elementAt(bytes: Uint8Array, offset: number, limit: number): ElementInfo | null {
  if (offset >= limit || !bytes[offset]) return null;
  let idLength = 1;
  for (let mask = 128; idLength <= 4 && !(bytes[offset] & mask); mask >>= 1) idLength++;
  if (idLength > 4 || offset + idLength >= limit) return null;
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + bytes[offset + i];
  const sizeOffset = offset + idLength;
  let sizeLength = 1;
  let marker = 128;
  while (sizeLength <= 8 && !(bytes[sizeOffset] & marker)) { sizeLength++; marker >>= 1; }
  if (sizeLength > 8 || sizeOffset + sizeLength > limit) return null;
  let size = BigInt(bytes[sizeOffset] & (marker - 1));
  for (let i = 1; i < sizeLength; i++) size = size * 256n + BigInt(bytes[sizeOffset + i]);
  const data = sizeOffset + sizeLength;
  const unknown = size === (1n << BigInt(sizeLength * 7)) - 1n;
  const payloadSize = unknown ? limit - data : Number(size);
  if (!Number.isSafeInteger(payloadSize) || payloadSize < 0 || data + payloadSize > limit) return null;
  return { id, data, size: payloadSize, end: data + payloadSize };
}

/**
 * webm-muxer 5.x writes the LAST timestamp as Duration, omitting its frame span.
 * Update only the existing Info/Duration float, in TimestampScale units. No media
 * bytes, offsets, cues or timestamps are changed. WebM container specification:
 * https://www.webmproject.org/docs/container/
 */
export function setWebmDuration(buffer: ArrayBuffer, seconds: number): boolean {
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  const bytes = new Uint8Array(buffer);
  let segment: ElementInfo | null = null;
  for (let p = 0; p < bytes.length;) {
    const el = elementAt(bytes, p, bytes.length);
    if (!el || el.end <= p) return false;
    if (el.id === 0x18538067) { segment = el; break; }
    p = el.end;
  }
  if (!segment) return false;
  for (let p = segment.data; p < segment.end;) {
    const el = elementAt(bytes, p, segment.end);
    if (!el || el.end <= p) return false;
    if (el.id === 0x1549a966) {
      let scale = 1000000;
      let duration: ElementInfo | null = null;
      for (let q = el.data; q < el.end;) {
        const child = elementAt(bytes, q, el.end);
        if (!child || child.end <= q) return false;
        if (child.id === 0x2ad7b1 && child.size <= 8) {
          scale = 0;
          for (let i = child.data; i < child.end; i++) scale = scale * 256 + bytes[i];
        }
        if (child.id === 0x4489) duration = child;
        q = child.end;
      }
      if (!duration || scale <= 0) return false;
      const view = new DataView(buffer);
      const ticks = seconds * 1e9 / scale;
      if (duration.size === 8) view.setFloat64(duration.data, ticks, false);
      else if (duration.size === 4) view.setFloat32(duration.data, ticks, false);
      else return false;
      return true;
    }
    p = el.end;
  }
  return false;
}