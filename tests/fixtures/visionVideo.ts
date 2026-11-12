import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import { setWebmDuration } from '../../src/utils/webmDuration';

export async function encodeVisionVideo(kind: 'point' | 'camera' | 'cutout'): Promise<number[]> {

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'V_VP8', width: 256, height: 144, frameRate: 15 }, firstTimestampBehavior: 'offset' });
    let error: Error | null = null;
    const encoder = new VideoEncoder({ output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata), error: (err) => { error = err; } });
    encoder.configure({ codec: 'vp8', width: 256, height: 144, framerate: 15, bitrate: 1500000 });
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 144;
    const ctx = canvas.getContext('2d')!;
    for (let frame = 0; frame < 30; frame++) {
      if (kind === 'camera') {
        const dx = frame % 2 ? 4 : -4;
        const dy = Math.round(Math.sin(frame * 2) * 3);
        const image = ctx.createImageData(256, 144);
        for (let y = 0; y < 144; y++) for (let x = 0; x < 256; x++) {
          const n = Math.sin((x - dx) * 12.9898 + (y - dy) * 78.233) * 43758.5453;
          const gray = 40 + (n - Math.floor(n)) * 170;
          const i = (y * 256 + x) * 4;
          image.data[i] = image.data[i + 1] = image.data[i + 2] = gray;
          image.data[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      } else {
        ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, 256, 144);
        if (kind === 'cutout') {
          ctx.fillStyle = '#e32138'; ctx.fillRect(99, 46, 43, 31);
        } else {
          const cx = 128 + frame;
          const cy = 72 + Math.round(Math.sin(frame / 6) * 3);
          for (let y = -15; y <= 15; y++) for (let x = -15; x <= 15; x++) {
            const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
            ctx.fillStyle = `rgb(${30 + Math.round((n - Math.floor(n)) * 180)},32,60)`;
            ctx.fillRect(cx + x, cy + y, 1, 1);
          }
        }
      }
      const videoFrame = new VideoFrame(canvas, { timestamp: Math.round(frame / 15 * 1000000), duration: 66667 });
      encoder.encode(videoFrame, { keyFrame: frame % 15 === 0 }); videoFrame.close();
      if (encoder.encodeQueueSize > 5) await encoder.flush();
    }
    await encoder.flush(); encoder.close();
    if (error) throw error;
    muxer.finalize();
    setWebmDuration(target.buffer, 2);
    return Array.from(new Uint8Array(target.buffer));

}
