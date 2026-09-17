import { burnThroughTransition } from './burn-through';
import { chromaticDustTransition } from './chromatic-dust';
import { fiberFlowTransition } from './fiber-flow';
import { inkRevealTransition } from './ink-reveal';
import { liquidLensTransition } from './liquid-lens';
import { meltTransition } from './melt';
import { misregistrationTransition } from './misregistration';
import { particleShiftTransition } from './particle-shift';
import { prismaticGlassTransition } from './prismatic-glass';
import { rackFocusTransition } from './rack-focus';
import { silkRibbonsTransition } from './silk-ribbons';
import { tornPaperTransition } from './torn-paper';

export {
  burnThroughTransition,
  chromaticDustTransition,
  fiberFlowTransition,
  inkRevealTransition,
  liquidLensTransition,
  meltTransition,
  misregistrationTransition,
  particleShiftTransition,
  prismaticGlassTransition,
  rackFocusTransition,
  silkRibbonsTransition,
  tornPaperTransition,
};
export type { BurnOrigin, BurnThroughOptions } from './burn-through';
export type { ChromaticDustDirection, ChromaticDustOptions } from './chromatic-dust';
export type { FiberFlowDirection, FiberFlowOptions } from './fiber-flow';
export type { InkRevealOptions } from './ink-reveal';
export type { LiquidLensOptions, LiquidLensOrigin } from './liquid-lens';
export type { MeltOptions } from './melt';
export type { MisregistrationOptions } from './misregistration';
export type {
  ParticleEnterDirection,
  ParticleExitDirection,
  ParticleShiftOptions,
} from './particle-shift';
export type {
  PrismaticGlassDirection,
  PrismaticGlassOptions,
} from './prismatic-glass';
export type { RackFocusOptions, RackFocusPoint } from './rack-focus';
export type {
  SilkRibbonsDirection,
  SilkRibbonsOptions,
} from './silk-ribbons';
export type { TornPaperDirection, TornPaperOptions } from './torn-paper';

/** Ordered list used by the default registry and useful when creating a scoped registry. */
export const builtInTransitions = [
  inkRevealTransition,
  particleShiftTransition,
  meltTransition,
  prismaticGlassTransition,
  silkRibbonsTransition,
  misregistrationTransition,
  burnThroughTransition,
  rackFocusTransition,
  liquidLensTransition,
  tornPaperTransition,
  chromaticDustTransition,
  fiberFlowTransition,
] as const;
