'use client';
import {useEffect,useState} from 'react';
import {effects,type Lang} from '@/lib/catalog';
import {readLanguage} from '@/lib/language';
import {sitePath} from '@/lib/site-path';
import Playground from './playground';
export default function PlaygroundEntry(){
 const [initial,setInitial]=useState<{effect:string;lang:Lang;tab:string}|null>(null);
 useEffect(()=>{const params=new URLSearchParams(window.location.search);const requested=params.get('effect');setInitial({effect:effects.some(e=>e.id===requested)?requested!:'ink-reveal',lang:readLanguage(),tab:params.get('tab')==='code'?'code':'preview'});},[]);
 return initial?<Playground initialEffect={initial.effect} initialLang={initial.lang} initialTab={initial.tab}/>:<div className="route-loading" aria-busy="true"><img src={sitePath('/favicon.svg')} alt="varyloom" width="48" height="48"/></div>;
}
