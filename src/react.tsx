import {
  forwardRef,
  useEffect,
  useRef,
  type CSSProperties,
  type ForwardedRef,
  type HTMLAttributes,
} from 'react';

import { createPrismorph } from './index';
import type {
  PrismorphController,
  PrismorphEventMap,
  PrismorphOptions,
} from './types';

export interface PrismorphSliderProps<TData = unknown>
  extends Omit<
      HTMLAttributes<HTMLDivElement>,
      'onError' | 'draggable' | 'onTransitionStart' | 'onTransitionEnd'
    >,
    PrismorphOptions<TData> {
  onReady?: (controller: PrismorphController<TData>) => void;
  onIndexChange?: (payload: PrismorphEventMap<TData>['indexchange']) => void;
  onTransitionStart?: (payload: PrismorphEventMap<TData>['transitionstart']) => void;
  onTransitionEnd?: (payload: PrismorphEventMap<TData>['transitionend']) => void;
  onEffectChange?: (payload: PrismorphEventMap<TData>['effectchange']) => void;
  onFallback?: (payload: PrismorphEventMap<TData>['fallback']) => void;
  onError?: (error: Error) => void;
}

function setForwardedRef<TData>(
  ref: ForwardedRef<PrismorphController<TData>>,
  value: PrismorphController<TData> | null,
): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

function PrismorphSliderInner<TData = unknown>(
  {
    items,
    effect,
    duration,
    easing,
    startIndex,
    autoplay,
    autoplayDelay,
    loop,
    draggable,
    keyboard,
    pauseOnHover,
    preload,
    crossOrigin,
    dpr,
    fallbackEffect,
    effectOptions,
    registry,
    onReady,
    onIndexChange,
    onTransitionStart,
    onTransitionEnd,
    onEffectChange,
    onFallback,
    onError,
    className,
    style,
    ...elementProps
  }: PrismorphSliderProps<TData>,
  forwardedRef: ForwardedRef<PrismorphController<TData>>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PrismorphController<TData> | null>(null);
  const callbacksRef = useRef({
    onReady,
    onIndexChange,
    onTransitionStart,
    onTransitionEnd,
    onEffectChange,
    onFallback,
    onError,
  });
  callbacksRef.current = {
    onReady,
    onIndexChange,
    onTransitionStart,
    onTransitionEnd,
    onEffectChange,
    onFallback,
    onError,
  };

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;
    let controller: PrismorphController<TData> | undefined;
    const unsubscribe: Array<() => void> = [];

    void createPrismorph(containerRef.current, {
      items,
      effect,
      duration,
      easing,
      startIndex,
      autoplay,
      autoplayDelay,
      loop,
      draggable,
      keyboard,
      pauseOnHover,
      preload,
      crossOrigin,
      dpr,
      fallbackEffect,
      effectOptions,
      registry,
    }).then((created) => {
      if (disposed) {
        created.destroy();
        return;
      }
      controller = created;
      controllerRef.current = created;
      setForwardedRef(forwardedRef, created);
      unsubscribe.push(
        created.on('indexchange', (payload) => callbacksRef.current.onIndexChange?.(payload)),
        created.on('transitionstart', (payload) => callbacksRef.current.onTransitionStart?.(payload)),
        created.on('transitionend', (payload) => callbacksRef.current.onTransitionEnd?.(payload)),
        created.on('effectchange', (payload) => callbacksRef.current.onEffectChange?.(payload)),
        created.on('fallback', (payload) => callbacksRef.current.onFallback?.(payload)),
        created.on('error', ({ error }) => callbacksRef.current.onError?.(error)),
      );
      callbacksRef.current.onReady?.(created);
    }).catch((cause) => {
      callbacksRef.current.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
    });

    return () => {
      disposed = true;
      unsubscribe.forEach((remove) => remove());
      controller?.destroy();
      controllerRef.current = null;
      setForwardedRef(forwardedRef, null);
    };
  }, [items, registry, startIndex]);

  useEffect(() => {
    controllerRef.current?.setOptions({
      effect,
      duration,
      easing,
      autoplay,
      autoplayDelay,
      loop,
      draggable,
      keyboard,
      pauseOnHover,
      preload,
      crossOrigin,
      dpr,
      fallbackEffect,
      effectOptions,
    });
  }, [
    effect,
    duration,
    easing,
    autoplay,
    autoplayDelay,
    loop,
    draggable,
    keyboard,
    pauseOnHover,
    preload,
    crossOrigin,
    dpr,
    fallbackEffect,
    effectOptions,
  ]);

  const mergedStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    ...style,
  };

  return <div ref={containerRef} className={className} style={mergedStyle} {...elementProps} />;
}

export const PrismorphSlider = forwardRef(PrismorphSliderInner) as <TData = unknown>(
  props: PrismorphSliderProps<TData> & { ref?: ForwardedRef<PrismorphController<TData>> },
) => ReturnType<typeof PrismorphSliderInner>;
