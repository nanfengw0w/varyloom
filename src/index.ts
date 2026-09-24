import { Varyloom } from './core/Varyloom';
import { transitionRegistry } from './registry';
import { builtInTransitions } from './transitions';
import type { VaryloomOptions } from './types';

builtInTransitions.forEach((definition) => {
  transitionRegistry.replace(definition);
});

export async function createVaryloom<TData = unknown>(
  container: HTMLElement,
  options: VaryloomOptions<TData>,
): Promise<Varyloom<TData>> {
  const instance = new Varyloom(container, options);
  await instance.ready;
  return instance;
}

export { Varyloom } from './core/Varyloom';
export {
  TransitionRegistry,
  defineTransition,
  registerTransition,
  transitionRegistry,
} from './registry';
export {
  archiveSealTransition,
  builtInTransitions,
  burnThroughTransition,
  chromaticDustTransition,
  contourRevealTransition,
  contactSheetTransition,
  darkroomDevelopTransition,
  depthFlipTransition,
  drowsyBlindsTransition,
  fiberFlowTransition,
  flowMorphTransition,
  frequencyHandoffTransition,
  gummySqueezeTransition,
  holoFoilTransition,
  inkRevealTransition,
  irisShutterTransition,
  impastoStrokeTransition,
  lenticularShiftTransition,
  liquidLensTransition,
  meteorWakeTransition,
  meltTransition,
  memoryMosaicTransition,
  misregistrationTransition,
  particleShiftTransition,
  postcardRelayTransition,
  prismaticGlassTransition,
  rackFocusTransition,
  silkRibbonsTransition,
  tornPaperTransition,
  typeApertureTransition,
  vortexPortalTransition,
  zipperClothTransition,
} from './transitions';
export type {
  ArchiveSealOptions,
  BurnOrigin,
  BurnThroughOptions,
  ChromaticDustDirection,
  ChromaticDustOptions,
  ContourRevealOptions,
  ContactSheetOptions,
  DarkroomDevelopOptions,
  DepthFlipDirection,
  DepthFlipOptions,
  DrowsyBlindsOptions,
  FiberFlowDirection,
  FiberFlowOptions,
  FlowMorphOptions,
  FrequencyHandoffOptions,
  GummySqueezeOptions,
  HoloFoilOptions,
  InkRevealOptions,
  IrisShutterOptions,
  ImpastoStrokeOptions,
  LenticularShiftOptions,
  LiquidLensOptions,
  LiquidLensOrigin,
  MeteorWakeOptions,
  MeltOptions,
  MemoryMosaicOptions,
  MisregistrationOptions,
  ParticleEnterDirection,
  ParticleExitDirection,
  ParticleShiftOptions,
  PostcardRelayOptions,
  PrismaticGlassDirection,
  PrismaticGlassOptions,
  RackFocusOptions,
  RackFocusPoint,
  SilkRibbonsDirection,
  SilkRibbonsOptions,
  TornPaperDirection,
  TornPaperOptions,
  TypeApertureOptions,
  VortexPortalOptions,
  ZipperClothOptions,
} from './transitions';
export type * from './types';
