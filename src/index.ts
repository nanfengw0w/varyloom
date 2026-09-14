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
  inkRevealTransition,
  meltTransition,
  particleShiftTransition,
} from './transitions';
export type {
  InkRevealOptions,
  MeltOptions,
  ParticleEnterDirection,
  ParticleExitDirection,
  ParticleShiftOptions,
} from './transitions';
export type * from './types';
