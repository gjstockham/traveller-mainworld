/**
 * The projection registry.
 *
 * Adding one is a module and a row here. The refusal names every id it knows,
 * for the reason `chooseWorld` gives for doing the same with fixtures: quietly
 * rendering something else is how you convince yourself you have exported a
 * Mercator when you have not, and an export is expensive enough that finding out
 * afterwards is a real cost.
 */
import { EQUIRECTANGULAR_ID, equirectangular } from './equirectangular.js';
import { MERCATOR_ID, WEB_MERCATOR_CLIP_DEG, mercator } from './mercator.js';
import type { Projection } from './projection.js';

export * from './equirectangular.js';
export * from './mercator.js';
export * from './projection.js';

/** Parameters a projection may take. Ignored by projections that take none. */
export interface ProjectionOptions {
  /** Mercator's clip latitude in degrees. Defaults to {@link WEB_MERCATOR_CLIP_DEG}. */
  readonly clipDeg?: number;
}

/** Every projection id, in the order the CLI and the UI list them. */
export function projectionIds(): string[] {
  return [EQUIRECTANGULAR_ID, MERCATOR_ID];
}

/**
 * Build a projection by id.
 *
 * @throws naming every id it knows, rather than falling back to the default.
 */
export function requireProjection(id: string, options: ProjectionOptions = {}): Projection {
  switch (id) {
    case EQUIRECTANGULAR_ID:
      return equirectangular();
    case MERCATOR_ID:
      return mercator(options.clipDeg ?? WEB_MERCATOR_CLIP_DEG);
    default:
      throw new Error(
        `unknown projection '${id}'. Available: ${projectionIds().join(', ')}`,
      );
  }
}
