/**
 * Diagnostics overlay.
 *
 * Not a debug afterthought: the Spike C exit criteria (no stall over 1 s,
 * ~60 fps target with a 30 fps floor, memory stable over 10 minutes) and the
 * Spike B worker-throughput numbers are all read off this panel. Building it
 * now means those measurements come from the running system rather than a
 * separate harness that might not match.
 *
 * **What the memory readout can and cannot see.** Two independent numbers, for
 * a reason:
 *
 * - `performance.memory` is the main thread's JS heap. It is **non-standard and
 *   Chrome-only** — the panel says so where it is missing rather than showing a
 *   zero that reads like a measurement — its values are quantised, and it does
 *   **not** include worker heaps. Tile generation happens in workers, so the
 *   number that looks most like "how much memory is this using" is precisely
 *   the one that cannot see the generator.
 * - Resident bytes are counted, not sampled: the tile cache sums what it holds,
 *   the renderer sums its vertex and index buffers. Those cover the allocations
 *   a streaming viewer would leak, and they are exact.
 *
 * Neither alone answers "memory stable over a 10-minute session". Together, a
 * flat resident count with a rising heap points at the main thread, and a rising
 * resident count points at the cache or the mesh pool. That is why both are
 * here, and why the drift figure is against a baseline taken *after* startup
 * rather than against zero.
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
  /** Bytes held by cached tiles. */
  readonly cacheBytes: number;
  /** Vertex-buffer bytes for meshes currently drawn. */
  readonly meshLiveBytes: number;
  /** Vertex-buffer bytes for retired meshes held for reuse. */
  readonly meshPooledBytes: number;
  /** Index buffers, shared across every mesh and counted once. */
  readonly meshSharedBytes: number;
  /** Retired meshes in the pool. Bounded — an unbounded rise is the bug. */
  readonly pooledMeshes: number;
}

/**
 * What a pasted session block has to identify about itself.
 *
 * The same problem WP4's evidence blocks solve: a panel screenshot says what the
 * numbers were and nothing about what produced them, and "it flew fine" is not
 * something Phase 0 can exit on. A block that cannot be tied to a fixture, a
 * build and a machine is an anecdote.
 */
export interface EvidenceStamp {
  /** Full world description — what the block records. */
  readonly world: string;
  /** Fixture id, or `default world`. What the panel has room for. */
  readonly worldShort: string;
  /** Commit the bundle was built from, or `local build`. */
  readonly build: string;
  /** Mesh grid parameter. 64 means a 65² mesh — open question 1. */
  readonly tileN: number;
  /**
   * Vertical exaggeration in force. 1 is true scale; anything else means the
   * session was flown through an inspection override, which is worth knowing
   * before reading a frame rate off it.
   */
  readonly exaggeration: number;
}

/** Browser-supplied facts, passed in so the block can be built and tested. */
export interface StampEnvironment {
  readonly userAgent: string;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | undefined;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly devicePixelRatio: number;
  readonly at: Date;
}

/**
 * The identification half of a session block.
 *
 * Deliberately the same label-and-value shape as WP4's evidence blocks, so the
 * two evidence files read alike and a reader who knows one knows the other.
 */
export function stampLines(stamp: EvidenceStamp, env: StampEnvironment): string[] {
  const pairs: [string, string][] = [
    ['world', stamp.world],
    ['tile mesh', `${String(stamp.tileN + 1)}² (TILE_N ${String(stamp.tileN)})`],
    [
      'exaggeration',
      stamp.exaggeration === 1 ? '1 (true scale)' : `${String(stamp.exaggeration)} (OVERRIDE)`,
    ],
    ['user agent', env.userAgent],
    [
      'hardware',
      `cores ${String(env.hardwareConcurrency)}, memory ${
        env.deviceMemoryGb === undefined ? 'not reported' : `${String(env.deviceMemoryGb)} GB`
      }`,
    ],
    [
      'screen',
      `${String(env.screenWidth)}×${String(env.screenHeight)} @ ${String(env.devicePixelRatio)}`,
    ],
    ['run at', env.at.toISOString()],
    ['build', stamp.build],
  ];
  const width = Math.max(...pairs.map(([label]) => label.length));
  return pairs.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
}

/** The Chrome-only shape of `performance.memory`. */
interface JsHeapInfo {
  readonly usedJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
}

/**
 * Main-thread JS heap, or `undefined` where the browser does not expose it.
 *
 * Feature-detected on the property rather than the browser: Firefox and Safari
 * have no `performance.memory` at all, and a build that gains one later should
 * start reporting without a code change.
 */
function readJsHeap(): JsHeapInfo | undefined {
  if (typeof performance === 'undefined') {
    return undefined;
  }
  const memory = (performance as Performance & { memory?: Partial<JsHeapInfo> }).memory;
  if (typeof memory?.usedJSHeapSize !== 'number' || typeof memory.jsHeapSizeLimit !== 'number') {
    return undefined;
  }
  return { usedJSHeapSize: memory.usedJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit };
}

/** Rolling window for frame timing, long enough to smooth without hiding stalls. */
const WINDOW = 120;

/** Heap reading and the moment it was taken, for the drift figure. */
export interface HeapBaseline {
  readonly usedBytes: number;
  readonly atMs: number;
}

/** Wall-clock elapsed, and how much of it the tab spent hidden. */
export interface SessionSpan {
  readonly totalMs: number;
  readonly hiddenMs: number;
  readonly hiddenGaps: number;
}

/**
 * Elapsed time, split by whether anyone was looking.
 *
 * `requestAnimationFrame` does not run in a hidden tab, so the first frame after
 * one returns carries the entire hidden period in its delta. Recorded as a frame
 * time that is indistinguishable from a stall — and it is not a hypothetical:
 * the first real ten-minute session reported a 58,532 ms "stall" with an empty
 * queue, an idle worker pool and a 16.9 ms p95, which is what a backgrounded tab
 * looks like and nothing like what a stall looks like.
 *
 * The criterion it broke is "no stall > 1 s", so an instrument that cannot tell
 * those apart cannot answer the question it exists for. This separates them: the
 * resumed frame is discarded from the timing statistics, and the hidden time is
 * reported rather than hidden — a ten-minute session that spent nine of them in
 * the background is not a ten-minute session.
 */
export class SessionClock {
  private hiddenSince: number | undefined;
  private hiddenTotal = 0;
  private gaps = 0;
  private pendingResume = false;

  /** The tab went away at `now`. */
  hide(now: number): void {
    this.hiddenSince ??= now;
  }

  /** The tab came back at `now`. */
  show(now: number): void {
    if (this.hiddenSince === undefined) {
      return;
    }
    this.hiddenTotal += Math.max(0, now - this.hiddenSince);
    this.hiddenSince = undefined;
    this.gaps++;
    this.pendingResume = true;
  }

  /**
   * Whether the next frame sample spans a hidden period, and must not be
   * counted as a frame time. Answers true exactly once per gap.
   */
  consumeResume(): boolean {
    const resumed = this.pendingResume;
    this.pendingResume = false;
    return resumed;
  }

  /** Hidden time so far, including a gap still in progress. */
  hiddenMsAt(now: number): number {
    return this.hiddenSince === undefined
      ? this.hiddenTotal
      : this.hiddenTotal + Math.max(0, now - this.hiddenSince);
  }

  get hiddenGaps(): number {
    return this.gaps;
  }
}

/**
 * The memory block, as pure text.
 *
 * Separated from the DOM so the thing the exit criteria are read off can be
 * tested directly — in particular that a browser without `performance.memory`
 * produces a sentence saying so, and never a zero.
 */
export function memoryLines(
  sample: Pick<
    FrameSample,
    | 'cacheBytes'
    | 'cacheSize'
    | 'meshLiveBytes'
    | 'meshPooledBytes'
    | 'meshSharedBytes'
    | 'pooledMeshes'
  >,
  heap: JsHeapInfo | undefined,
  baseline: HeapBaseline | undefined,
  session: SessionSpan,
): string[] {
  const sessionMs = session.totalMs;
  let heapLine: string;
  if (heap === undefined) {
    heapLine = 'not reported — performance.memory is Chrome-only';
  } else {
    const drift =
      baseline === undefined
        ? ''
        : `  ${formatSigned(heap.usedJSHeapSize - baseline.usedBytes)} over ${formatDuration(sessionMs - baseline.atMs)}`;
    heapLine = `${formatBytes(heap.usedJSHeapSize)} / ${formatBytes(heap.jsHeapSizeLimit)} main thread only${drift}`;
  }

  return [
    `heap     ${heapLine}`,
    `resident ${formatBytes(sample.cacheBytes)} tiles (${sample.cacheSize}), ` +
      `${formatBytes(sample.meshLiveBytes)} mesh live, ` +
      `${formatBytes(sample.meshPooledBytes)} pooled (${sample.pooledMeshes}), ` +
      `${formatBytes(sample.meshSharedBytes)} shared`,
    `session  ${formatSession(session)}`,
  ];
}

/**
 * Elapsed, and what fraction of it was real.
 *
 * A bare total would let a session that spent most of its length in another tab
 * be read as ten minutes of use. Silence here is meaningful — no hidden clause
 * means the tab never went away — so the clause only appears when it applies.
 */
function formatSession(session: SessionSpan): string {
  if (session.hiddenGaps === 0) {
    return formatDuration(session.totalMs);
  }
  const active = Math.max(0, session.totalMs - session.hiddenMs);
  const gaps = session.hiddenGaps === 1 ? '1 gap' : `${String(session.hiddenGaps)} gaps`;
  return (
    `${formatDuration(session.totalMs)} total — ${formatDuration(active)} active, ` +
    `${formatDuration(session.hiddenMs)} hidden in ${gaps}`
  );
}

export class DiagnosticsOverlay {
  private readonly container: HTMLDivElement;
  private readonly element: HTMLPreElement;
  private readonly button: HTMLButtonElement;
  private readonly fallback: HTMLTextAreaElement;
  private readonly frameTimes: number[] = [];
  private worstFrameMs = 0;
  private lastGenerated = 0;
  private lastThroughputAt = 0;
  private tilesPerSecond = 0;
  private lastRenderAt = 0;
  private startedAt: number | undefined;
  private heapBaseline: HeapBaseline | undefined;
  private labelTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly clock = new SessionClock();
  private readonly onVisibility: () => void;
  private skippedResumes = 0;

  constructor(
    parent: HTMLElement,
    private readonly stamp: EvidenceStamp,
  ) {
    // The container carries the positioning and stays transparent to the
    // pointer, so the panel never swallows a drag meant for the camera. Only
    // the button opts back in.
    this.container = document.createElement('div');
    this.container.style.cssText = [
      'position:absolute',
      'top:8px',
      'left:8px',
      'pointer-events:none',
      'display:flex',
      'flex-direction:column',
      'align-items:flex-start',
      'gap:6px',
    ].join(';');

    this.element = document.createElement('pre');
    // Named, because WP12 put a second `pre` and several more buttons on the
    // page. Every selector that reads this panel — the Playwright specs, and
    // anyone reading a session block off it — has to find *this* element, and a
    // structural locator stopped being unambiguous the moment the input UI
    // landed.
    this.element.setAttribute('data-role', 'diagnostics');
    this.element.style.cssText = [
      'margin:0',
      'padding:8px 10px',
      'background:rgba(5,7,13,0.72)',
      'color:#9fb3d0',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'border:1px solid rgba(120,150,190,0.25)',
      'border-radius:4px',
      'white-space:pre',
    ].join(';');

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.setAttribute('data-role', 'copy-evidence');
    this.button.textContent = 'Copy evidence';
    this.button.style.cssText = [
      'pointer-events:auto',
      'padding:4px 9px',
      'background:rgba(5,7,13,0.72)',
      'color:#9fb3d0',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'border:1px solid rgba(120,150,190,0.35)',
      'border-radius:4px',
      'cursor:pointer',
    ].join(';');
    this.button.addEventListener('click', () => {
      this.copyEvidence();
    });

    // Hidden until the clipboard refuses. A `pre` cannot be selected by hand
    // here (the panel is pointer-events:none, and making it selectable would
    // cost every camera drag), so the fallback needs something that can be.
    this.fallback = document.createElement('textarea');
    this.fallback.readOnly = true;
    this.fallback.hidden = true;
    this.fallback.style.cssText = [
      'pointer-events:auto',
      'width:44ch',
      'height:12em',
      'background:rgba(5,7,13,0.92)',
      'color:#9fb3d0',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'border:1px solid rgba(120,150,190,0.35)',
      'border-radius:4px',
    ].join(';');

    this.container.append(this.element, this.button, this.fallback);
    parent.appendChild(this.container);

    this.onVisibility = (): void => {
      const now = performance.now();
      if (document.visibilityState === 'hidden') {
        this.clock.hide(now);
      } else {
        this.clock.show(now);
      }
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * The pasteable block: what produced these numbers, then the numbers.
   *
   * Built on demand rather than kept up to date, so it can never be stale
   * relative to the panel it is read from.
   */
  evidenceText(): string {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const lines = stampLines(this.stamp, {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGb: nav.deviceMemory,
      screenWidth: screen.width,
      screenHeight: screen.height,
      devicePixelRatio: devicePixelRatio,
      at: new Date(),
    });
    return `${lines.join('\n')}\n\n${this.element.textContent ?? ''}`;
  }

  /**
   * Copy, or fall back to something the reader can select, and say which.
   *
   * `navigator.clipboard` is secure-context only. Served over plain HTTP from a
   * LAN address — the obvious way to reach a laptop or a phone that is not this
   * machine — it is `undefined`. The same trap `verify.html` hit: a button that
   * silently does nothing is worse than no button, because the instructions
   * elsewhere say to press it.
   */
  private copyEvidence(): void {
    const text = this.evidenceText();
    const { clipboard } = navigator;
    if (clipboard === undefined) {
      this.offerSelection(text, 'the clipboard API needs HTTPS');
      return;
    }
    void clipboard.writeText(text).then(
      () => {
        this.fallback.hidden = true;
        this.flash('Copied');
      },
      (error: unknown) => {
        // Chrome rejects with NotAllowedError when the document is not focused,
        // which is a different problem from a refused permission and has a
        // different fix. Saying "refused" for both sent someone looking in the
        // wrong place.
        const why =
          error instanceof Error && /focus/i.test(error.message)
            ? 'the window was not focused'
            : 'the clipboard was refused';
        this.offerSelection(text, why);
      },
    );
  }

  /**
   * Say something on the button, then put the label back.
   *
   * A label that latches on 'Copied' is indistinguishable from a button that
   * stopped working: the second press of a session produces no visible change,
   * which is exactly how a ten-minute run ends with nothing recorded. Every
   * press has to acknowledge itself.
   */
  private flash(message: string): void {
    this.button.textContent = message;
    if (this.labelTimer !== undefined) {
      clearTimeout(this.labelTimer);
    }
    this.labelTimer = setTimeout(() => {
      this.button.textContent = 'Copy evidence';
      this.labelTimer = undefined;
    }, 1500);
  }

  private offerSelection(text: string, why: string): void {
    this.fallback.value = text;
    this.fallback.hidden = false;
    // Focus as well as select: `select()` alone does not reliably move focus,
    // and an unfocused selection is one a Ctrl+C cannot copy — a fallback that
    // does not fall back.
    this.fallback.focus();
    this.fallback.setSelectionRange(0, text.length);
    this.button.textContent = `Selected — press Ctrl+C (${why})`;
  }

  update(sample: FrameSample, now: number): void {
    this.startedAt ??= now;

    // A frame that spans a hidden tab is not a frame time. rAF stops while the
    // tab is away, so the first frame back carries the whole gap in its delta —
    // and recorded as a stall it is the one number that could falsify C3 while
    // meaning nothing. Discarded from both statistics, and the gap is reported
    // on the session line instead of being quietly dropped.
    if (this.clock.consumeResume()) {
      this.skippedResumes++;
    } else {
      this.frameTimes.push(sample.frameMs);
      if (this.frameTimes.length > WINDOW) {
        this.frameTimes.shift();
      }
      // Worst frame is tracked un-smoothed: a single 1 s stall is exactly what
      // the exit criteria care about, and an average would bury it.
      this.worstFrameMs = Math.max(this.worstFrameMs, sample.frameMs);
    }

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
      // Identity first, so a screenshot of the panel is at least traceable even
      // though the copied block is what the evidence file wants.
      `world    ${this.stamp.worldShort}  ·  build ${shortBuild(this.stamp.build)}`,
      '',
      `fps      ${(1000 / mean).toFixed(0).padStart(5)}   (${mean.toFixed(1)} ms mean, ${p95.toFixed(1)} p95)`,
      `worst    ${this.worstFrameMs.toFixed(0).padStart(5)} ms${this.worstFrameMs > 1000 ? '  <-- STALL > 1s' : ''}` +
        (this.skippedResumes === 0
          ? ''
          : `  (${String(this.skippedResumes)} resumed frame(s) excluded)`),
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
      '',
      ...memoryLines(sample, readJsHeap(), this.heapBaseline, {
        totalMs: now - (this.startedAt ?? now),
        hiddenMs: this.clock.hiddenMsAt(now),
        hiddenGaps: this.clock.hiddenGaps,
      }),
    ].join('\n');
  }

  /**
   * Startup is over: clear the worst-frame high-water mark and take the heap
   * baseline the drift figure is measured against.
   *
   * Both belong to the same moment. A worst-frame mark that includes the first
   * few seconds reports shader compilation, and a heap baseline taken at zero
   * reports the cost of loading the page rather than the cost of running it —
   * which is the question the 10-minute criterion asks.
   */
  markSettled(now: number): void {
    this.worstFrameMs = 0;
    const heap = readJsHeap();
    if (heap !== undefined) {
      this.heapBaseline = { usedBytes: heap.usedJSHeapSize, atMs: now - (this.startedAt ?? now) };
    }
  }

  dispose(): void {
    if (this.labelTimer !== undefined) {
      clearTimeout(this.labelTimer);
    }
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.container.remove();
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

/**
 * Abbreviate a commit for the panel only.
 *
 * The copied block carries the full value: an abbreviation is for reading, not
 * for citing, and `local build` must survive untouched because a block from a
 * working tree is not reproducible by anyone else — which is itself evidence.
 */
function shortBuild(build: string): string {
  return /^[0-9a-f]{40}$/.test(build) ? build.slice(0, 7) : build;
}

/** Byte delta with an explicit sign — the sign is the finding. */
function formatSigned(n: number): string {
  return `${n < 0 ? '-' : '+'}${formatBytes(Math.abs(n))}`;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
