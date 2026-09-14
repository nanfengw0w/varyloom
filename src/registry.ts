import type { TransitionDefinition, TransitionName, TransitionRegistryLike } from './types';

export class TransitionRegistry implements TransitionRegistryLike {
  private readonly definitions = new Map<TransitionName, TransitionDefinition>();

  register(definition: TransitionDefinition): this {
    if (!definition.name) throw new Error('A transition definition requires a name.');
    if (this.definitions.has(definition.name)) {
      throw new Error(`Transition "${definition.name}" is already registered.`);
    }
    this.definitions.set(definition.name, definition);
    return this;
  }

  replace(definition: TransitionDefinition): this {
    this.definitions.set(definition.name, definition);
    return this;
  }

  get(name: TransitionName): TransitionDefinition | undefined {
    return this.definitions.get(name);
  }

  has(name: TransitionName): boolean {
    return this.definitions.has(name);
  }

  unregister(name: TransitionName): boolean {
    return this.definitions.delete(name);
  }

  list(): TransitionDefinition[] {
    return [...this.definitions.values()];
  }

  clone(): TransitionRegistry {
    const registry = new TransitionRegistry();
    this.definitions.forEach((definition) => registry.register(definition));
    return registry;
  }
}

export const transitionRegistry = new TransitionRegistry();

export function defineTransition(definition: TransitionDefinition): TransitionDefinition {
  return definition;
}

export function registerTransition(definition: TransitionDefinition): () => void {
  transitionRegistry.replace(definition);
  return () => {
    if (transitionRegistry.get(definition.name) === definition) {
      transitionRegistry.unregister(definition.name);
    }
  };
}
