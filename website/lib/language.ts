'use client';
import {useEffect,useState} from 'react';
import type {Lang} from './catalog';

export function readLanguage():Lang {
 const query=new URLSearchParams(window.location.search).get('lang');
 if(query==='zh'||query==='en')return query;
 try{const saved=localStorage.getItem('varyloom-language');if(saved==='zh'||saved==='en')return saved;}catch{}
 return 'zh';
}
export function useLanguage(initial?:Lang){
 const [lang,setState]=useState<Lang>(initial??'zh');
 useEffect(()=>{if(!initial)setState(readLanguage());},[initial]);
 const setLang=(value:Lang)=>{setState(value);try{localStorage.setItem('varyloom-language',value);}catch{}const url=new URL(window.location.href);url.searchParams.set('lang',value);window.history.replaceState(window.history.state,'',url);};
 return [lang,setLang] as const;
}
