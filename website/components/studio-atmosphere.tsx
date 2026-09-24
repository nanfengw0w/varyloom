'use client';

import {useEffect, useId, type RefObject} from 'react';
import {gsap} from 'gsap';

/** Decorative layers never intercept the playground's image or control events. */
export function StudioAtmosphere() {
 return <div className="studio-atmosphere" aria-hidden="true">
  <div className="ambient-cloud ambient-cloud-a"/>
  <div className="ambient-cloud ambient-cloud-b"/>
  <div className="ambient-cursor"/>
  <div className="paper-grain"/>
 </div>;
}

export function HeaderWeave() {
 const id=useId().replace(/:/g,'');
 return <div className="header-weave" aria-hidden="true">
  <svg viewBox="0 0 1000 280" preserveAspectRatio="xMidYMid slice" fill="none">
   <defs>
    <linearGradient id={id+'-thread'} x1="70" y1="210" x2="930" y2="55" gradientUnits="userSpaceOnUse">
     <stop stopColor="#b4c752" stopOpacity="0"/>
     <stop offset=".25" stopColor="#8d9e3f"/>
     <stop offset=".57" stopColor="#9c85b8"/>
     <stop offset=".82" stopColor="#488d80"/>
     <stop offset="1" stopColor="#b6d665" stopOpacity=".2"/>
    </linearGradient>
    <linearGradient id={id+'-echo'} x1="200" y1="260" x2="950" y2="35" gradientUnits="userSpaceOnUse">
     <stop stopColor="#c5d59e" stopOpacity="0"/>
     <stop offset=".5" stopColor="#748d84"/>
     <stop offset="1" stopColor="#c6cf8e" stopOpacity=".1"/>
    </linearGradient>
   </defs>
   <g className="weave-primary" stroke={'url(#'+id+'-thread)'} strokeWidth=".8">
    {Array.from({length:30},(_,i)=><path key={i} d={`M -80 ${212+i*3.7} C ${200+i*2} ${280-i*8.1}, ${292+i*3.3} ${-128+i*8.2}, ${600+i*4} ${66+i*2.9} S 900 ${330-i*6}, 1080 ${40+i*6.3}`}/>)}
   </g>
   <g className="weave-echo" stroke={'url(#'+id+'-echo)'} strokeWidth=".65">
    {Array.from({length:19},(_,i)=><path key={i} d={`M 90 ${330-i*4} C 430 ${-170+i*8}, 530 ${340-i*5}, 1050 ${20+i*5.3}`}/>)}
   </g>
   <g className="weave-orbit" stroke="#83977a" strokeWidth=".8" opacity=".55">
    <circle cx="815" cy="112" r="67" strokeDasharray="1 7"/>
    <path d="M807 112h16M815 104v16"/>
   </g>
  </svg>
 </div>;
}

export function useStudioMotion(scope:RefObject<HTMLDivElement|null>,effect:string,photo:number,tab:string) {
 useEffect(()=>{
  const root=scope.current;
  if(!root)return;
  const media=gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)',()=>{
   gsap.fromTo('.heading-copy > *',{y:12,opacity:0},{y:0,opacity:1,duration:.65,stagger:.055,ease:'power3.out',clearProps:'transform,opacity'});
   gsap.fromTo('.study-number',{y:18,opacity:0},{y:0,opacity:1,duration:.85,ease:'power3.out',clearProps:'transform,opacity'});
   gsap.fromTo('.parameter-panel',{y:8,opacity:.35},{y:0,opacity:1,duration:.55,ease:'power2.out',clearProps:'transform,opacity'});
  },root);
  return()=>media.revert();
 },[scope,effect]);

 useEffect(()=>{
  const root=scope.current;
  if(!root)return;
  const media=gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)',()=>{
   gsap.fromTo('.photo-title strong',{y:7,opacity:.25},{y:0,opacity:1,duration:.6,ease:'power2.out',clearProps:'transform,opacity'});
  },root);
  return()=>media.revert();
 },[scope,photo]);

 useEffect(()=>{
  if(tab!=='code'||!scope.current)return;
  const root=scope.current;
  const media=gsap.matchMedia();
  // Radix Presence may mount the panel after the parent's passive effect.
  const frame=requestAnimationFrame(()=>{
   const content=root.querySelectorAll('.code-panel > *');
   if(!content.length)return;
   media.add('(prefers-reduced-motion: no-preference)',()=>{
    gsap.fromTo(content,{y:9,opacity:0},{y:0,opacity:1,duration:.5,stagger:.04,ease:'power2.out',clearProps:'transform,opacity'});
   },root);
  });
  return()=>{cancelAnimationFrame(frame);media.revert();};
 },[scope,tab]);
}
