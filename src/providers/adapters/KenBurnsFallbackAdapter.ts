import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';
import { ProviderManager } from '../registry/Manager';
import { SmartRouter } from '../Router';

interface Waypoint {
  scale: number;
  fx: number;
  fy: number;
}

const WAYPOINTS: Waypoint[] = [
  { scale: 1.0, fx: 0.5, fy: 0.5 },
  { scale: 1.22, fx: 0.38, fy: 0.42 },
  { scale: 1.12, fx: 0.6, fy: 0.55 },
];

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function sampleWaypoints(t: number): Waypoint {
  const seg = t * (WAYPOINTS.length - 1);
  const i = Math.min(Math.floor(seg), WAYPOINTS.length - 2);
  const localT = easeInOutQuad(seg - i);
  const a = WAYPOINTS[i];
  const b = WAYPOINTS[i + 1];
  return { scale: lerp(a.scale, b.scale, localT), fx: lerp(a.fx, b.fx, localT), fy: lerp(a.fy, b.fy, localT) };
}

/**
 * Not real AI video — an animated still image, used only when every real video
 * provider fails or isn't configured. It first generates a still image through the
 * normal image provider fallback chain, then pans/zooms across it into a recorded
 * WebM clip via canvas + MediaRecorder, exactly like the legacy monolith's
 * fallbackKenBurnsVideo. Ships as the lowest-priority (95) video provider so it is
 * only ever reached after every real video generator has failed.
 */
export class KenBurnsFallbackAdapter extends BaseAdapter {
  label = 'Pan/Zoom Still Fallback';
  browserSafe = true;
  supportsModelDiscovery = false;

  constructor(private providerManager: ProviderManager, private router: SmartRouter) {
    super();
  }

  async call(_provider: ProviderConfig, input: any, options?: any): Promise<{ url: string; isFallback: boolean }> {
    const prompt = input?.prompt ?? input;
    const log = options?.log as ((msg: string, level?: 'info' | 'warn' | 'error') => void) | undefined;
    log?.('No real video model responded — building a panned still-image animation instead. This is NOT real video motion.', 'warn');

    const aspect: string = options?.aspect || '16:9';
    const height = aspect === '9:16' ? 1820 : aspect === '1:1' ? 1024 : 576;
    const imgUrl = await this.providerManager.callWithFallback(
      'image',
      this.router,
      { prompt },
      { width: 1024, height },
      log
    );

    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load fallback still image.'));
      img.src = imgUrl;
    });

    let cw = 960, ch = 540;
    if (aspect === '9:16') { cw = 540; ch = 960; }
    if (aspect === '1:1') { cw = 720; ch = 720; }

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is not available.');

    const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(30);
    const candidateMimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const supportedMime = candidateMimes.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    if (!supportedMime) throw new Error("This browser can't record canvas video (no supported MediaRecorder codec).");

    const recorder = new MediaRecorder(stream, { mimeType: supportedMime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    const durationMs = (options?.duration || 4) * 1000;
    const startTime = performance.now();
    const recordedBlobPromise = new Promise<Blob>(resolve => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: supportedMime.split(';')[0] }));
    });
    recorder.start();

    const drawFrame = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / durationMs, 1);
      const { scale, fx, fy } = sampleWaypoints(t);
      const drawW = cw * scale, drawH = ch * scale;
      const srcRatio = img.width / img.height;
      const dstRatio = cw / ch;
      let baseSw: number, baseSh: number;
      if (srcRatio > dstRatio) { baseSh = img.height; baseSw = baseSh * dstRatio; }
      else { baseSw = img.width; baseSh = baseSw / dstRatio; }
      const sx = Math.max(0, Math.min(img.width - baseSw, (img.width - baseSw) * fx));
      const sy = Math.max(0, Math.min(img.height - baseSh, (img.height - baseSh) * fy));
      ctx.clearRect(0, 0, cw, ch);
      const offX = (cw - drawW) / 2, offY = (ch - drawH) / 2;
      ctx.drawImage(img, sx, sy, baseSw, baseSh, offX, offY, drawW, drawH);

      ctx.save();
      ctx.font = 'bold ' + Math.max(11, Math.floor(cw / 55)) + 'px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.textBaseline = 'bottom';
      ctx.fillText('STILL-IMAGE PAN — NOT AI VIDEO', 10, ch - 8);
      ctx.restore();

      if (elapsed < durationMs) requestAnimationFrame(drawFrame);
      else recorder.stop();
    };
    requestAnimationFrame(drawFrame);

    const blob = await recordedBlobPromise;
    return { url: URL.createObjectURL(blob), isFallback: true };
  }
}
