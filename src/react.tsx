import {
  forwardRef,
  useEffect,
  useRef,
  type CSSProperties,
  type ForwardedRef,
  type HTMLAttributes,
} from 'react';

import { createVaryloom } from './index';
import type {
  VaryloomController,
  VaryloomEventMap,
  VaryloomOptions,
} from './types';

export interface VaryloomSliderProps<TData = unknown>
  extends Omit<
      HTMLAttributes<HTMLDivElement>,
      'onError' | 'draggable' | 'onTransitionStart' | 'onTransitionEnd'
    >,
    VaryloomOptions<TData> {
  onReady?: (controller: VaryloomController<TData>) => void;
  onIndexChange?: (payload: VaryloomEventMap<TData>['indexchange']) => void;
  onTransitionStart?: (payload: VaryloomEventMap<TData>['transitionstart']) => void;
  onTransitionEnd?: (payload: VaryloomEventMap<TData>['transitionend']) => void;
  onEffectChange?: (payload: VaryloomEventMap<TData>['effectchange']) => void;
  onFallback?: (payload: VaryloomEventMap<TData>['fallback']) => void;
  onError?: (error: Error) => void;
}

function setForwardedRef<TData>(
  ref: ForwardedRef<VaryloomController<TData>>,
  value: VaryloomController<TData> | null,
): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

function VaryloomSliderInner<TData = unknown>(
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
  }: VaryloomSliderProps<TData>,
  forwardedRef: ForwardedRef<VaryloomController<TData>>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<VaryloomController<TData> | null>(null);
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
    let controller: VaryloomController<TData> | undefined;
    const unsubscribe: Array<() => void> = [];

    void createVaryloom(containerRef.current, {
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

export const VaryloomSlider = forwardRef(VaryloomSliderInner) as <TData = unknown>(
  props: VaryloomSliderProps<TData> & { ref?: ForwardedRef<VaryloomController<TData>> },
) => ReturnType<typeof VaryloomSliderInner>;
