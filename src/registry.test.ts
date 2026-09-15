import { describe, expect, it } from 'vitest';

import { TransitionRegistry, defineTransition, registerTransition, transitionRegistry } from './registry';
import { builtInTransitions } from './transitions';

const makeDefinition = (name: string) => defineTransition({
  name,
  backend: 'custom',
  create: () => ({}) as never,
});

describe('TransitionRegistry', () => {
  it('registers, lists and unregisters definitions', () => {
    const registry = new TransitionRegistry();
    const transition = makeDefinition('test-transition');

    registry.register(transition);
    expect(registry.get('test-transition')).toBe(transition);
    expect(registry.list()).toEqual([transition]);
    expect(registry.unregister('test-transition')).toBe(true);
    expect(registry.get('test-transition')).toBeUndefined();
  });

  it('protects against accidental duplicate registration', () => {
    const registry = new TransitionRegistry();
    registry.register(makeDefinition('duplicate'));
    expect(() => registry.register(makeDefinition('duplicate'))).toThrow(/already registered/);
  });

  it('clones without sharing later mutations', () => {
    const registry = new TransitionRegistry();
    registry.register(makeDefinition('first'));
    const clone = registry.clone();

    registry.register(makeDefinition('second'));
    expect(clone.list().map(({ name }) => name)).toEqual(['first']);
  });
});

describe('built-in transitions', () => {
  it('exposes all five stable transition names', () => {
    expect(builtInTransitions.map(({ name }) => name)).toEqual([
      'ink-reveal',
      'particle-shift',
      'melt',
      'prismatic-glass',
      'silk-ribbons',
    ]);
  });

  it('keeps the particle simulation phase linear', () => {
    const particle = builtInTransitions.find(({ name }) => name === 'particle-shift');
    expect(particle?.phaseEasing).toBe('none');
  });

  it('returns an unregister function for custom global transitions', () => {
    const transition = makeDefinition('temporary-transition');
    const unregister = registerTransition(transition);
    expect(transitionRegistry.get(transition.name)).toBe(transition);
    unregister();
    expect(transitionRegistry.get(transition.name)).toBeUndefined();
  });
});
