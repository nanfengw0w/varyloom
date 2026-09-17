import { Prismorph } from './core/Prismorph';
import { transitionRegistry } from './registry';
import { builtInTransitions } from './transitions';
import type { PrismorphOptions } from './types';

builtInTransitions.forEach((definition) => {
  transitionRegistry.replace(definition);
});

export async function createPrismorph<TData = unknown>(
  container: HTMLElement,
  options: PrismorphOptions<TData>,
): Promise<Prismorph<TData>> {
  const instance = new Prismorph(container, options);
  await instance.ready;
  return instance;
}

export { Prismorph } from './core/Prismorph';
export {
  TransitionRegistry,
  defineTransition,
  registerTransition,
  transitionRegistry,
} from './registry';
export {
  builtInTransitions,
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
} from './transitions';
export type {
  BurnOrigin,
  BurnThroughOptions,
  ChromaticDustDirection,
  ChromaticDustOptions,
  FiberFlowDirection,
  FiberFlowOptions,
  InkRevealOptions,
  LiquidLensOptions,
  LiquidLensOrigin,
  MeltOptions,
  MisregistrationOptions,
  ParticleEnterDirection,
  ParticleExitDirection,
  ParticleShiftOptions,
  PrismaticGlassDirection,
  PrismaticGlassOptions,
  RackFocusOptions,
  RackFocusPoint,
  SilkRibbonsDirection,
  SilkRibbonsOptions,
  TornPaperDirection,
  TornPaperOptions,
} from './transitions';
export type * from './types';
