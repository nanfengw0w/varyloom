'use client';
import {useEffect,type RefObject} from 'react';
import {gsap} from 'gsap';
import {ScrollTrigger} from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
export function useBrandMotion(scope:RefObject<HTMLDivElement|null>,language:string){
 useEffect(()=>{
  const root=scope.current;if(!root)return;
  const media=gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)',()=>{
   const intro=gsap.timeline({defaults:{ease:'power3.out',duration:1.2}});
   intro.from('.hero-kicker',{y:15,opacity:0,duration:.65})
    .from('.headline-line',{yPercent:110,rotation:3,stagger:.12},.1)
    .from('.hero-art-tilt',{y:95,rotation:16,opacity:0,duration:1.6},.15)
    .from('.hero-description,.hero-cta-row,.hero-baseline',{y:24,opacity:0,stagger:.09,duration:.9},.5)
    .from('.hero-bloom',{scale:0,rotation:-100,ease:'back.out(1.5)'},.65);
   const ambient=[gsap.to('.hero-bloom',{rotation:360,duration:42,repeat:-1,ease:'none'}),
    gsap.to('.start-bloom',{rotation:-360,duration:44,repeat:-1,ease:'none'}),
    gsap.to('.hero-orbit',{rotation:-28,duration:15,repeat:-1,yoyo:true,ease:'sine.inOut'})];
   gsap.to('.hero-art-wrap',{yPercent:13,rotation:5,ease:'none',scrollTrigger:{trigger:'.brand-hero',start:'top top',end:'bottom top',scrub:1.1}});
   gsap.to('.ribbon-track',{xPercent:-22,ease:'none',scrollTrigger:{trigger:'.motion-ribbon',start:'top bottom',end:'bottom top',scrub:1.4}});
   root.querySelectorAll('.reveal-heading').forEach(node=>gsap.from(node,{y:60,opacity:0,duration:1.1,ease:'power3.out',scrollTrigger:{trigger:node,start:'top 92%',once:true}}));
   root.querySelectorAll('.reveal-block').forEach(node=>gsap.from(node,{y:45,opacity:0,duration:1,ease:'power3.out',scrollTrigger:{trigger:node,start:'top 94%',once:true}}));
   gsap.from('.expression-card',{y:80,rotation:4,opacity:0,duration:1.2,stagger:.14,ease:'power3.out',scrollTrigger:{trigger:'.expression-grid',start:'top 88%',once:true}});
   gsap.fromTo('.closing-wordmark',{yPercent:20},{yPercent:0,ease:'none',scrollTrigger:{trigger:'.start-section',start:'top bottom',end:'bottom bottom',scrub:1}});
   const onscreen=new Set<Element>();
   const visibility=()=>ambient.forEach(t=>{const target=t.targets()[0];t.paused(document.hidden||!(target instanceof Element)||!onscreen.has(target));});
   const observer=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting)onscreen.add(e.target);else onscreen.delete(e.target);});visibility();});
   ambient.forEach(t=>{const target=t.targets()[0];if(target instanceof Element)observer.observe(target);});
   document.addEventListener('visibilitychange',visibility);
   return()=>{observer.disconnect();document.removeEventListener('visibilitychange',visibility);};
  },root);
  media.add('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',()=>{
   const cleanups:(()=>void)[]=[];
   const artwork=root.querySelector<HTMLElement>('.hero-art-tilt');
   const hero=root.querySelector<HTMLElement>('.brand-hero');
   if(artwork&&hero){
    const rx=gsap.quickTo(artwork,'rotationX',{duration:1,ease:'power3.out'});
    const ry=gsap.quickTo(artwork,'rotationY',{duration:1,ease:'power3.out'});
    const move=(e:PointerEvent)=>{const r=hero.getBoundingClientRect();rx((.5-(e.clientY-r.top)/r.height)*8);ry(((e.clientX-r.left)/r.width-.5)*12);};
    const leave=()=>{rx(0);ry(0);};hero.addEventListener('pointermove',move,{passive:true});hero.addEventListener('pointerleave',leave);cleanups.push(()=>{hero.removeEventListener('pointermove',move);hero.removeEventListener('pointerleave',leave);});
   }
   root.querySelectorAll<HTMLElement>('.magnetic').forEach(button=>{
    const x=gsap.quickTo(button,'x',{duration:.5,ease:'power3.out'}),y=gsap.quickTo(button,'y',{duration:.5,ease:'power3.out'});
    const move=(e:PointerEvent)=>{const r=button.getBoundingClientRect();x((e.clientX-r.left-r.width/2)*.14);y((e.clientY-r.top-r.height/2)*.22);};
    const leave=()=>{x(0);y(0);};button.addEventListener('pointermove',move,{passive:true});button.addEventListener('pointerleave',leave);cleanups.push(()=>{button.removeEventListener('pointermove',move);button.removeEventListener('pointerleave',leave);});
   });
   return()=>cleanups.forEach(clean=>clean());
  },root);
  let active=true;void document.fonts.ready.then(()=>{if(active)ScrollTrigger.refresh();});
  return()=>{active=false;media.revert();};
 },[scope,language]);
}
