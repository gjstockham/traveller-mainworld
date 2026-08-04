/**
 * Planet rendering: turning the streamed tile set into Three.js meshes.
 *
 * One mesh per visible tile, sharing a single index buffer per grid resolution
 * (the topology is identical for every tile — only positions differ), and a
 * single material across all of them. Meshes for tiles that leave the cut are
 * kept briefly in a pool rather than disposed, because LOD churn re-requests
 * the same tiles constantly during navigation.
 */
import * as THREE from 'three';

import { buildTileIndices, vertexCount } from '../mesh/tileMesh.js';
import type { ReadyTile } from '../stream/tileStore.js';

export interface PlanetRendererOptions {
  readonly n: number;
  /** Maximum retired meshes kept for reuse. */
  readonly poolSize?: number;
}

export class PlanetRenderer {
  readonly group = new THREE.Group();

  private readonly material: THREE.MeshStandardMaterial;
  /**
   * One index buffer per skirt-edge combination, built once and shared. Sixteen
   * small buffers cost far less than the dark seam grid that drawing every
   * skirt unconditionally produces — see `lod/neighbours.ts`.
   */
  private readonly indexAttributes: THREE.BufferAttribute[];
  private readonly live = new Map<number, THREE.Mesh>();
  private readonly meshMask = new Map<number, number>();
  private readonly pool: THREE.Mesh[] = [];
  private readonly poolSize: number;

  constructor(private readonly options: PlanetRendererOptions) {
    this.poolSize = options.poolSize ?? 256;

    this.indexAttributes = [];
    for (let mask = 0; mask < 16; mask++) {
      this.indexAttributes.push(new THREE.BufferAttribute(buildTileIndices(options.n, mask), 1));
    }

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      // Flat shading is the Phase 0 look, and it comes free: Three derives the
      // facet normal in the fragment shader, so no normal attribute is needed
      // and none is computed or transferred.
      flatShading: true,
      roughness: 1,
      metalness: 0,
      side: THREE.FrontSide,
    });
  }

  /** Number of tile meshes currently in the scene. */
  get visibleCount(): number {
    return this.live.size;
  }

  get triangleCount(): number {
    let total = 0;
    for (const mesh of this.live.values()) {
      total += (mesh.geometry.getIndex()?.count ?? 0) / 3;
    }
    return total;
  }

  /** Retired meshes held for reuse. Bounded by `poolSize`; worth watching. */
  get pooledCount(): number {
    return this.pool.length;
  }

  /**
   * Bytes held in vertex and index buffers, live and pooled.
   *
   * Reported separately from the tile cache because they are separate
   * allocations with separate lifetimes: a tile can leave the cut (mesh pooled,
   * still allocated) while staying cached, or be evicted from the cache while
   * its mesh is live. The Spike C memory criterion needs both, and neither is
   * derivable from a tile count — the pool grows to `poolSize` and then stops,
   * which is exactly the shape a leak would *not* have.
   *
   * The sixteen shared index buffers are counted once, not once per mesh, since
   * that is how they exist.
   */
  get bufferBytes(): { live: number; pooled: number; shared: number } {
    let shared = 0;
    for (const attribute of this.indexAttributes) {
      shared += (attribute.array as ArrayBufferView).byteLength;
    }
    const perMesh = vertexCount(this.options.n) * 3 * Float32Array.BYTES_PER_ELEMENT * 2;
    return { live: this.live.size * perMesh, pooled: this.pool.length * perMesh, shared };
  }

  /**
   * Add or update the mesh for a generated tile.
   *
   * @param skirtMask Which edges need a skirt wall this frame. Changing it
   *                  swaps the shared index buffer — no vertex data is touched.
   */
  upsert(tile: ReadyTile, skirtMask = 0b1111): void {
    let mesh = this.live.get(tile.tileId);
    if (mesh === undefined) {
      mesh = this.pool.pop() ?? this.createMesh();
      mesh.visible = true;
      this.live.set(tile.tileId, mesh);
      this.group.add(mesh);
      this.meshMask.set(tile.tileId, -1);
    }

    if (this.meshMask.get(tile.tileId) !== skirtMask) {
      mesh.geometry.setIndex(this.indexAttributes[skirtMask]!);
      this.meshMask.set(tile.tileId, skirtMask);
    }

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colour = geometry.getAttribute('color') as THREE.BufferAttribute;

    (position.array as Float32Array).set(tile.positions);
    (colour.array as Float32Array).set(tile.colours);
    position.needsUpdate = true;
    colour.needsUpdate = true;

    // Needed for frustum culling to work; without it Three draws every tile
    // regardless of where the camera is looking.
    geometry.computeBoundingSphere();
  }

  /**
   * Retire every mesh whose tile is not in `keep`.
   *
   * Called after the ready tiles are applied, so a tile that has just arrived
   * is never retired in the same frame it appeared.
   */
  retainOnly(keep: ReadonlySet<number>): void {
    for (const [tileId, mesh] of this.live) {
      if (keep.has(tileId)) {
        continue;
      }
      this.live.delete(tileId);
      this.meshMask.delete(tileId);
      this.group.remove(mesh);
      if (this.pool.length < this.poolSize) {
        mesh.visible = false;
        this.pool.push(mesh);
      } else {
        mesh.geometry.dispose();
      }
    }
  }

  has(tileId: number): boolean {
    return this.live.has(tileId);
  }

  dispose(): void {
    for (const mesh of this.live.values()) {
      mesh.geometry.dispose();
    }
    for (const mesh of this.pool) {
      mesh.geometry.dispose();
    }
    this.live.clear();
    this.meshMask.clear();
    this.pool.length = 0;
    this.material.dispose();
    this.group.clear();
  }

  private createMesh(): THREE.Mesh {
    const verts = vertexCount(this.options.n);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    // Shared across every tile with the same skirt mask, so at most sixteen
    // index buffers exist on the GPU regardless of tile count.
    geometry.setIndex(this.indexAttributes[0b1111]!);
    return new THREE.Mesh(geometry, this.material);
  }
}

/**
 * Scene, camera, renderer and lighting for an airless world.
 *
 * One directional light and almost no ambient: a vacuum world has no
 * atmospheric scattering to fill its shadows, so the terminator is hard and
 * the night side is essentially black. The small ambient term is a concession
 * to being able to see what one is debugging.
 */
export function createScene(
  canvas: HTMLCanvasElement,
  options: { readonly preserveDrawingBuffer?: boolean } = {},
): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
} {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // Off by default — preserving costs a full-buffer copy every frame. The
    // smoke tests need it to read pixels back, since the drawing buffer is
    // cleared once composited.
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);

  const camera = new THREE.PerspectiveCamera(50, 1, 1e-4, 100);

  const sun = new THREE.DirectionalLight(0xfff4e8, 3.0);
  sun.position.set(1, 0.35, 0.6).normalize();
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x2a3244, 0.35));

  return { scene, camera, renderer, sun };
}
