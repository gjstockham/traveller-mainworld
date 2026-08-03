/**
 * Diagnostics overlay.
 *
 * Not a debug afterthought: the Spike C exit criteria (no stall over 1 s,
 * ~60 fps target with a 30 fps floor, memory stable over 10 minutes) and the
 * Spike B worker-throughput numbers are all read off this panel. Building it
 * now means those measurements come from the running system rather than a
 * separate harness that might not match.
 */

export interface FrameSample {
  readonly frameMs: number;
  readonly visibleTiles: number;
  readonly triangles: number;
  readonly queued: number;
  readonly inFlight: number;
  readonly workers: number;
  readonly cacheSize: number;
  readonly cacheCapacity: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly generated: number;
  readonly cancelled: number;
  readonly meanGenerateMs: number;
  readonly bytesTransferred: number;
  readonly altitudeKm: number;
  readonly maxDepth: number;
}

/** Rolling window for frame timing, long enough to smooth without hiding stalls. */
const WINDOW = 120;

export class DiagnosticsOverlay {
  private readonly element: HTMLPreElement;
  private readonly frameTimes: number[] = [];
  private worstFrameMs = 0;
  private lastGenerated = 0;
  private lastThroughputAt = 0;
  private tilesPerSecond = 0;
  private lastRenderAt = 0;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('pre');
    this.element.style.cssText = [
      'position:absolute',
      'top:8px',
      'left:8px',
      'margin:0',
      'padding:8px 10px',
      'background:rgba(5,7,13,0.72)',
      'color:#9fb3d0',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'border:1px solid rgba(120,150,190,0.25)',
      'border-radius:4px',
      'pointer-events:none',
      'white-space:pre',
    ].join(';');
    parent.appendChild(this.element);
  }

  update(sample: FrameSample, now: number): void {
    this.frameTimes.push(sample.frameMs);
    if (this.frameTimes.length > WINDOW) {
      this.frameTimes.shift();
    }
    // Worst frame is tracked un-smoothed: a single 1 s stall is exactly what
    // the exit criteria care about, and an average would bury it.
    this.worstFrameMs = Math.max(this.worstFrameMs, sample.frameMs);

    if (now - this.lastThroughputAt >= 1000) {
      const elapsed = (now - this.lastThroughputAt) / 1000;
      this.tilesPerSecond = (sample.generated - this.lastGenerated) / elapsed;
      this.lastGenerated = sample.generated;
      this.lastThroughputAt = now;
    }

    // Repainting the DOM every frame would itself distort the frame time.
    if (now - this.lastRenderAt < 250) {
      return;
    }
    this.lastRenderAt = now;

    const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    const hitRate =
      sample.cacheHits + sample.cacheMisses === 0
        ? 0
        : (100 * sample.cacheHits) / (sample.cacheHits + sample.cacheMisses);

    this.element.textContent = [
      `fps      ${(1000 / mean).toFixed(0).padStart(5)}   (${mean.toFixed(1)} ms mean, ${p95.toFixed(1)} p95)`,
      `worst    ${this.worstFrameMs.toFixed(0).padStart(5)} ms${this.worstFrameMs > 1000 ? '  <-- STALL > 1s' : ''}`,
      `altitude ${formatAltitude(sample.altitudeKm)}`,
      '',
      `tiles    ${String(sample.visibleTiles).padStart(5)} visible, depth ${sample.maxDepth}`,
      `tris     ${formatCount(sample.triangles)}`,
      `queue    ${String(sample.queued).padStart(5)} queued, ${sample.inFlight}/${sample.workers} busy`,
      `gen      ${this.tilesPerSecond.toFixed(1)} tiles/s, ${sample.meanGenerateMs.toFixed(1)} ms/tile`,
      `cancel   ${String(sample.cancelled).padStart(5)} dropped before start`,
      '',
      `cache    ${sample.cacheSize}/${sample.cacheCapacity}  ${hitRate.toFixed(0)}% hit`,
      `xfer     ${formatBytes(sample.bytesTransferred)}`,
    ].join('\n');
  }

  /** Clear the worst-frame high-water mark, e.g. after startup settles. */
  resetWorst(): void {
    this.worstFrameMs = 0;
  }

  dispose(): void {
    this.element.remove();
  }
}

function formatAltitude(km: number): string {
  if (km >= 1000) {
    return `${(km / 1000).toFixed(1)} Mm`;
  }
  if (km >= 1) {
    return `${km.toFixed(1)} km`;
  }
  return `${(km * 1000).toFixed(0)} m`;
}

function formatCount(n: number): string {
  if (n >= 1e6) {
    return `${(n / 1e6).toFixed(2)}M`;
  }
  if (n >= 1e3) {
    return `${(n / 1e3).toFixed(1)}k`;
  }
  return String(n);
}

function formatBytes(n: number): string {
  if (n >= 1 << 30) {
    return `${(n / (1 << 30)).toFixed(2)} GiB`;
  }
  if (n >= 1 << 20) {
    return `${(n / (1 << 20)).toFixed(1)} MiB`;
  }
  return `${(n / 1024).toFixed(0)} KiB`;
}
