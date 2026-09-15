import { inkRevealTransition } from './ink-reveal';
import { meltTransition } from './melt';
import { particleShiftTransition } from './particle-shift';
import { prismaticGlassTransition } from './prismatic-glass';
import { silkRibbonsTransition } from './silk-ribbons';

export {
  inkRevealTransition,
  meltTransition,
  particleShiftTransition,
  prismaticGlassTransition,
  silkRibbonsTransition,
};
export type { InkRevealOptions } from './ink-reveal';
export type { MeltOptions } from './melt';
export type {
  ParticleEnterDirection,
  ParticleExitDirection,
  ParticleShiftOptions,
} from './particle-shift';
export type {
  PrismaticGlassDirection,
  PrismaticGlassOptions,
} from './prismatic-glass';
export type {
  SilkRibbonsDirection,
  SilkRibbonsOptions,
} from './silk-ribbons';

/** Ordered list used by the default registry and useful when creating a scoped registry. */
export const builtInTransitions = [
  inkRevealTransition,
  particleShiftTransition,
  meltTransition,
  prismaticGlassTransition,
  silkRibbonsTransition,
] as const;
