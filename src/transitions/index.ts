import { inkRevealTransition } from './ink-reveal';
import { meltTransition } from './melt';
import { particleShiftTransition } from './particle-shift';

export { inkRevealTransition, meltTransition, particleShiftTransition };
export type { InkRevealOptions } from './ink-reveal';
export type { MeltOptions } from './melt';
export type {
  ParticleEnterDirection,
  ParticleExitDirection,
  ParticleShiftOptions,
} from './particle-shift';

/** Ordered list used by the default registry and useful when creating a scoped registry. */
export const builtInTransitions = [
  inkRevealTransition,
  particleShiftTransition,
  meltTransition,
] as const;
