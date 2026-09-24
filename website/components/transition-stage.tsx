'use client';
import { useEffect, useRef, useState } from 'react';
import type { Varyloom } from 'varyloom';
import { photographs, type Effect, type Lang } from '@/lib/catalog';
import { sitePath } from '@/lib/site-path';

type Props = { effect:Effect; options:Record<string,unknown>; duration:number; easing:string; autoplay:boolean; visible:boolean; lang:Lang; index:number; onIndex:(n:number)=>void; onController:(c:Varyloom|null)=>void; onStatus:(s:'loading'|'ready'|'error',actual:string)=>void };
const initKeys = ['particleCount','crystalCount','strandCount','segmentsPerStrand','word'];
type OwnedInstance = { controller:Varyloom; mount:HTMLDivElement; released:boolean };
function releaseInstance(owned:OwnedInstance|null){
 if(!owned||owned.released)return;
 owned.released=true;
 owned.mount.remove();
 // In the published 0.1.0, initialize() can schedule its first RAF after an
 // early destroy(). Detach immediately, but destroy once ready has settled so
 // the late frame, loaded images and GPU resources are all released together.
 const destroy=()=>{try{owned.controller.destroy();}catch(error){console.warn('Preview cleanup failed',error);}};
 void owned.controller.ready.then(destroy,destroy);
}
function localizeHost(container:HTMLDivElement|null,lang:Lang){
 if(!container)return;
 const host=container.querySelector('[data-varyloom]');
 host?.setAttribute('aria-roledescription',lang==='zh'?'影像轮播':'image carousel');
 host?.setAttribute('aria-label',lang==='zh'?'可拖动影像，或使用左右方向键':'Drag the image or use the left and right arrow keys');
 container.querySelectorAll('div').forEach(el=>{
  const text=lang==='zh'?'转印 / 已封存':'TRANSFER / SEALED';
  if(el.childElementCount===0&&['TRANSFER / SEALED','转印 / 已封存'].includes(el.textContent??'')&&el.textContent!==text)el.textContent=text;
 });
 container.querySelectorAll('img').forEach(img=>{
  const photo=photographs.find(p=>img.src.includes(p.file));
  if(photo)img.alt=photo.alt[lang];
 });
}

export default function TransitionStage(props:Props) {
 const container=useRef<HTMLDivElement>(null);
 const latest=useRef(props); latest.current=props;
 const controller=useRef<Varyloom|null>(null);
 const [epoch,setEpoch]=useState(0);
 const [progress,setProgress]=useState(0);
 const [active,setActive]=useState(false);
 const [pageVisible,setPageVisible]=useState(()=>typeof document==='undefined'||!document.hidden);
 const [inViewport,setInViewport]=useState(false);
 const renderEnabled=props.visible&&pageVisible&&inViewport;
 const previousOptions=useRef<Record<string,unknown>>(props.options);
 const sequence=useRef(0);
 const pendingRemount=useRef(false);
 const lastMountedEffect=useRef<string|null>(null);
 useEffect(()=>{
  const sync=()=>setPageVisible(!document.hidden);
  sync();
  document.addEventListener('visibilitychange',sync);
  return()=>document.removeEventListener('visibilitychange',sync);
 },[]);
 useEffect(()=>{
  if(typeof IntersectionObserver==='undefined'){setInViewport(true);return;}
  const observer=new IntersectionObserver(entries=>setInViewport(entries[0].isIntersecting),{threshold:0});
  if(container.current)observer.observe(container.current);
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  pendingRemount.current=false;
  latest.current.onController(null);setActive(false);setProgress(0);
  // pause() only stops autoplay in varyloom 0.1.0. Continuous GPU effects
  // must release their controller while hidden, then resume at the saved frame.
  if(!renderEnabled)return;
  let cancelled=false; let owned:Varyloom|null=null; let ownership:OwnedInstance|null=null;
  const localize=()=>localizeHost(container.current,latest.current.lang);
  const observer=new MutationObserver(localize);
  if(container.current) observer.observe(container.current,{childList:true,subtree:true});
  latest.current.onStatus('loading',props.effect.id);
  void (async()=>{
   try {
    const {Varyloom}=await import('varyloom');
    if(cancelled||!container.current)return;
    const make=(id:string,options:Record<string,unknown>)=>{
     const mount=document.createElement('div');
     mount.style.cssText='position:relative;width:100%;height:100%';
     mount.dataset.transitionInstance='';
     container.current!.appendChild(mount);
     try{
      const instance=new Varyloom(mount,{items:photographs.map(p=>({image:sitePath('/images/'+p.file),alt:p.alt[latest.current.lang]})),effect:id,duration:latest.current.duration,easing:latest.current.easing,effectOptions:options,startIndex:latest.current.index,autoplay:false,fallbackEffect:false,keyboard:true,draggable:true,dpr:1.5});
      ownership={controller:instance,mount,released:false};
      return instance;
     }catch(error){mount.remove();throw error;}
    };
    const mountedOptions=latest.current.options;
    owned=make(props.effect.id,mountedOptions);
    try { await owned.ready; }
    catch(error){
     if(cancelled)return;
     console.warn('Requested transition could not initialize',props.effect.id,error);
     releaseInstance(ownership);
     // Fallback is explicit in the UI and uses the published library too.
     owned=make('melt',{imageFit:latest.current.options.imageFit});
     await owned.ready;
    }
    if(cancelled){releaseInstance(ownership);return;}
    controller.current=owned;
    previousOptions.current=mountedOptions;
    const isCurrent=()=>!cancelled&&controller.current===owned;
    owned.on('indexchange',({index})=>{if(isCurrent()){latest.current.onIndex(index);localize();}});
    owned.on('transitionstart',()=>{if(isCurrent()){setActive(true);setProgress(0);}});
    owned.on('progress',({progress:p})=>{if(isCurrent())setProgress(p);});
    owned.on('transitionend',()=>{if(isCurrent()){setActive(false);setProgress(1);}});
    owned.on('error',({error})=>{if(isCurrent()){console.warn('Transition runtime error',error);latest.current.onStatus('error',owned!.effect);}});
    localize();
    latest.current.onController(owned);
    latest.current.onStatus('ready',owned.effect);
    setEpoch(n=>n+1);
    if(lastMountedEffect.current!==null&&lastMountedEffect.current!==props.effect.id)owned.next();
    lastMountedEffect.current=props.effect.id;
   }catch(error){
    if(!cancelled){releaseInstance(ownership);console.warn('Preview unavailable',error);latest.current.onStatus('error',props.effect.id);}
   }
  })();
  return ()=>{cancelled=true;sequence.current++;observer.disconnect();releaseInstance(ownership);controller.current=null;latest.current.onController(null);};
 // Visibility and effect selection own the lifetime; settings update the live instance.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[props.effect.id,renderEnabled]);
 useEffect(()=>{
  const c=controller.current;if(!c||!renderEnabled)return;
  c.setOptions({duration:props.duration,easing:props.easing,autoplay:props.autoplay,autoplayDelay:2.6});
  c.play();
 },[epoch,props.duration,props.easing,props.autoplay,renderEnabled]);
 useEffect(()=>{
  const c=controller.current;
  if(!c||!renderEnabled||previousOptions.current===props.options)return;
  if(c.effect!==props.effect.id){
   c.setOptions({effectOptions:{imageFit:props.options.imageFit}});
   previousOptions.current=props.options;
   if(props.visible)c.next();
   return;
  }
  const generation=++sequence.current;
  const timer=setTimeout(async()=>{
   const before=previousOptions.current;
   const remount=pendingRemount.current || initKeys.some(k=>before[k]!==props.options[k]) || props.effect.id==='type-aperture';
   try{
    if(remount){pendingRemount.current=true;latest.current.onStatus('loading',c.effect);await c.setEffect(props.effect.id,props.options);}
    else c.setOptions({effectOptions:props.options});
    if(generation!==sequence.current||controller.current!==c)return;
    previousOptions.current=props.options;
    pendingRemount.current=false;
    latest.current.onStatus('ready',c.effect);
    if(latest.current.visible)c.next();
   }catch(error){if(generation===sequence.current){pendingRemount.current=false;console.warn(error);latest.current.onStatus('error',c.effect);}}
  },180);
  return()=>{clearTimeout(timer);sequence.current++;};
 },[epoch,props.options,props.effect.id,renderEnabled]);
 useEffect(()=>{
  localizeHost(container.current,props.lang);
 },[props.lang]);
 return <><div ref={container} className="transition-host" data-effect={props.effect.id} data-transitioning={active} data-suspended={!renderEnabled}/><div className="transition-progress" aria-hidden="true"><span style={{transform:`scaleX(${active?progress:0})`}}/></div><span className="sr-only" role="status">{photographs[props.index].alt[props.lang]}</span></>;
}
