'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import type {Varyloom} from 'varyloom';
import {ArrowUpRight,ArrowRight,ArrowDown,Play,Pause,Copy,Check,Globe2} from 'lucide-react';
import {effects,initialOptions,photographs,type Lang} from '@/lib/catalog';
import {useLanguage} from '@/lib/language';
import {sitePath} from '@/lib/site-path';
import {apiUrl,repositoryUrl,npmUrl} from '@/lib/project-links';
import TransitionStage from './transition-stage';
import {useBrandMotion} from './brand-motion';

function Bloom({className=''}:{className?:string}){
 return <div className={'kinetic-bloom '+className} aria-hidden="true">{Array.from({length:12},(_,i)=><i key={i} style={{transform:`rotate(${i*30}deg)`}}/>)}</div>;
}

function LiveArtwork({lang,effectId,hero=false}:{lang:Lang;effectId:string;hero?:boolean}){
 const root=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false);
 const [playing,setPlaying]=useState(true);
 const [reduced,setReduced]=useState(false);
 const [index,setIndex]=useState(hero?3:0);
 const [controller,setController]=useState<Varyloom|null>(null);
 const [status,setStatus]=useState('loading');
 const [actual,setActual]=useState(effectId);
 const effect=effects.find(e=>e.id===effectId)!;
 const options=useMemo(()=>initialOptions(effect,'zh'),[effect]);
 const t=(zh:string,en:string)=>lang==='zh'?zh:en;
 useEffect(()=>{
  let inView=false;
  const sync=()=>setVisible(inView&&!document.hidden);
  const observer=new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;sync();},{threshold:.08});
  if(root.current)observer.observe(root.current);
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const motion=()=>setReduced(preference.matches);motion();preference.addEventListener('change',motion);
  document.addEventListener('visibilitychange',sync);
  return()=>{observer.disconnect();document.removeEventListener('visibilitychange',sync);preference.removeEventListener('change',motion);};
 },[]);
 return <div ref={root} className={'live-artwork '+(hero?'hero-artwork':'feature-artwork')} data-status={status} data-active-effect={actual}>
  <img className="artwork-placeholder" src={sitePath('/images/'+photographs[hero?3:0].file)} alt=""/>
  <TransitionStage effect={effect} options={options} duration={hero?2.1:3} easing="power2.inOut" autoplay={playing&&!reduced} visible={visible} lang={lang} index={index} onIndex={setIndex} onController={setController} onStatus={(s,a)=>{setStatus(s);setActual(a);}}/>
  <div className="artwork-meta"><span><i/>{actual===effectId?effect.name[lang]:t('液态融化 · 兼容模式','Melt · compatibility mode')}</span><span>0{index+1} / 04</span></div>
  <div className="artwork-actions">
   <button className="artwork-next" disabled={status!=='ready'} onClick={()=>controller?.next()} aria-label={t('切换主视觉图片','Change artwork image')}><ArrowUpRight size={25}/></button>
   <button className="artwork-pause" disabled={reduced} onClick={()=>setPlaying(!playing)} aria-label={playing?t('暂停自动转场','Pause automatic transitions'):t('继续自动转场','Resume automatic transitions')}>{playing&&!reduced?<Pause size={14}/>:<Play size={14}/>}</button>
  </div>
  {status==='error'&&<div className="artwork-error">{t('当前浏览器无法显示实时转场','Live transitions are unavailable in this browser')}</div>}
 </div>;
}

const featured=['particle-shift','meteor-wake','memory-mosaic'];
export default function Landing(){
 const root=useRef<HTMLDivElement>(null);
 const [lang,setLang]=useLanguage();
 const [selected,setSelected]=useState(featured[0]);
 const [copied,setCopied]=useState(false);
 const [copyError,setCopyError]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const t=(zh:string,en:string)=>lang==='zh'?zh:en;
 const lab=(effect?:string)=>sitePath('/playground?lang='+lang+(effect?'&effect='+effect:''));
 useBrandMotion(root,lang);
 useEffect(()=>{document.documentElement.lang=lang==='zh'?'zh-CN':'en';document.title=t('varyloom — 让影像，生动起来。','varyloom — Images into motion.');document.querySelector('meta[name="description"]')?.setAttribute('content',t('31 种转场，让每一次变化都有自己的表达。探索 varyloom 的动态影像世界。','31 expressive image transitions. Explore the world of varyloom and make your next frame move.'));},[lang]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 const copy=async()=>{
  let success=false;try{await navigator.clipboard.writeText('npm install varyloom@0.1.1');success=true;}catch{const field=document.createElement('textarea');field.value='npm install varyloom@0.1.1';field.style.cssText='position:fixed;left:-9999px';document.body.appendChild(field);field.select();try{success=document.execCommand('copy');}catch{}field.remove();}
  setCopied(success);setCopyError(!success);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),2400);
 };
 return <div ref={root} id="top" className="brand-site" data-language={lang} onClick={event=>{
  if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!(event.target instanceof Element))return;
  const link=event.target.closest<HTMLAnchorElement>('a[href^="#"]');
  const id=link?.getAttribute('href')?.slice(1);if(!id)return;
  const target=document.getElementById(id);if(!target)return;
  event.preventDefault();
  const position=id==='top'?0:window.scrollY+target.getBoundingClientRect().top-30;
  window.scrollTo({top:Math.max(0,position),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  const url=new URL(window.location.href);url.hash=id;window.history.replaceState(window.history.state,'',url);
 }}>
  <a className="skip-content" href="#experiments">{t('跳转到效果精选','Skip to selected effects')}</a>
  <header className="brand-header">
   <a className="brand-wordmark" href={sitePath('/?lang='+lang)} aria-label={t('varyloom 首页','varyloom home')}><img src={sitePath('/favicon.svg')} alt="" width="30" height="30"/>varyloom<span aria-hidden="true">✳</span></a>
   <nav aria-label={t('主要导航','Main navigation')}><a className="header-section-link" href="#experiments">{t('效果精选','Explore')}</a><a href={lab()}>{t('实验室','Playground')}</a><a className="header-section-link" href="#start">{t('开始创作','Get started')}</a><a className="header-resource" href={apiUrl(lang)} target="_blank" rel="noreferrer">{t('文档','Docs')}</a><a className="header-resource" href={repositoryUrl} target="_blank" rel="noreferrer">GitHub</a><a className="header-resource" href={npmUrl} target="_blank" rel="noreferrer">npm</a></nav>
   <div className="brand-header-actions"><button className="brand-language" onClick={()=>setLang(lang==='zh'?'en':'zh')} aria-label={t('切换为英文','Switch to Chinese')}><Globe2 size={15}/>{t('中文','English')}</button><a href={lab()} className="header-lab">{t('进入实验室','Open playground')}<ArrowUpRight size={18}/></a></div>
  </header>

  <main>
   <section className="brand-hero" aria-labelledby="hero-title">
    <div className="hero-guideline" aria-hidden="true"/>
    <div className="hero-kicker"><span className="status-dot"/>{t('为下一幕，创造惊喜。','A little unexpected. A lot of possibility.')}<span className="hero-version">v0.1.1</span></div>
    <div className="hero-copy">
     <h1 id="hero-title"><span className="headline-mask"><span className="headline-line">{t('让影像，','Images into')}</span></span><span className="headline-mask"><span className="headline-line hero-accent">{t('生动起来。','motion.')}<span className="headline-spark" aria-hidden="true">✳</span></span></span></h1>
     <p className="hero-description">{t('在两帧之间，留一点想象。','Make something happen between frames.')}<br/>{t('用 31 种转场，编织属于你的视觉语言。','31 expressive transitions. An infinite space to play.')}</p>
     <div className="hero-cta-row"><a className="pill-button lime-button magnetic" href={lab()}><span>{t('探索所有效果','Explore effects')}</span><ArrowUpRight size={23}/></a><a className="hero-secondary" href="#experiments">{t('先感受一下','See it move')}<ArrowDown size={16}/></a></div>
    </div>
    <div className="hero-art-wrap">
     <div className="hero-orbit" aria-hidden="true"/>
     <div className="hero-art-tilt">
      <div className="hero-backplate" aria-hidden="true"/>
      <LiveArtwork lang={lang} effectId={featured[0]} hero/>
      <div className="art-sticker"><span>{t('触碰','FEEL')}</span><span>{t('变化','THE SHIFT')}</span><ArrowUpRight size={22}/></div>
     </div>
     <Bloom className="hero-bloom"/>
     <span className="hero-art-note">{t('实时生成 · 点击箭头，换个风景','LIVE RENDERED · CLICK THE ARROW TO SHIFT')}</span>
    </div>
    <div className="hero-baseline"><span>{t('由代码生长，由感受定义。','Built with code. Made to be felt.')}</span><a href="#experiments">{t('向下探索','Scroll to discover')}<ArrowDown size={14}/></a><span>01 — 31</span></div>
   </section>

   <div className="motion-ribbon" aria-hidden="true"><div className="ribbon-track">{Array.from({length:4},(_,i)=><span key={i}>{t('让变化，自成一景','MAKE ROOM FOR THE UNEXPECTED')}<span>✳</span>{t('每一帧，都有新可能','EVERY FRAME. A NEW POSSIBILITY.')}<span>↗</span></span>)}</div></div>

   <section id="experiments" className="brand-experiments">
    <div className="section-topline"><span>01 / {t('感受变化','FEEL THE SHIFT')}</span><span>{t('不只是过渡，更是表达。','A transition with a point of view.')}</span></div>
    <div className="experiment-heading"><h2 className="reveal-heading">{t('好看的变化，','Beautiful things')}<br/><em>{t('是有性格的。','happen in between.')}</em></h2><p className="reveal-block">{t('粒子的迁移，流星的尾迹，记忆的拼图。让影像在消散与重组之间，展开新的可能。','Particles drift. Meteors leave a trail. Memories come together. Let your images find new possibilities as they scatter and reform.')}</p></div>
    <div className="featured-stage reveal-block">
     <div className="featured-copy"><span className="featured-index">{String(featured.indexOf(selected)+1).padStart(2,'0')}<span>/ 03</span></span><div className="feature-picker" role="group" aria-label={t('精选转场','Selected transitions')}>{featured.map((id,i)=>{const effect=effects.find(e=>e.id===id)!;return <button key={id} aria-pressed={id===selected} onClick={()=>setSelected(id)}><span>0{i+1}</span>{effect.name[lang]}<ArrowUpRight size={22}/></button>;})}</div><p>{effects.find(e=>e.id===selected)!.description[lang]}</p><a className="text-link" href={lab(selected)}>{t('调出你的感觉','Make it your own')}<ArrowUpRight size={20}/></a></div>
     <div className="featured-visual"><LiveArtwork lang={lang} effectId={selected}/><span className="feature-footnote">{t('真实转场，直接在浏览器发生。','Real transitions, happening right in your browser.')}</span></div>
    </div>
   </section>

   <section className="possibility-section" aria-labelledby="possibility-title">
    <div className="section-topline"><span>02 / {t('不设边界','OPEN POSSIBILITIES')}</span><span>5 {t('种维度','DIMENSIONS')} / 31 {t('种表达','EXPRESSIONS')}</span></div>
    <div className="possibility-heading"><h2 id="possibility-title" className="reveal-heading">{t('下一幕，','What happens')}<br/>{t('由你想象。','next is yours.')}<span>↗</span></h2><p>{t('从细腻的显影，到大胆的解构。找到让作品与众不同的那一瞬。','From a quiet reveal to a radical transformation. Find the moment that makes your work feel different.')}</p></div>
    <div className="expression-grid">
     <a className="expression-card expression-flow" href={lab('flow-morph')}><div className="expression-art"><img src={sitePath('/images/coast.jpg')} alt={t('深蓝海岸的浪花','Waves along a deep blue coast')} loading="lazy"/><span className="expression-word">{t('流','FLOW')}</span><span className="card-orbit" aria-hidden="true"/></div><div className="expression-caption"><span><small>01 / {t('流动与显影','FLOW & REVEAL')}</small><strong>{t('让边界消融。','Let the edges dissolve.')}</strong></span><ArrowUpRight/></div></a>
     <a className="expression-card expression-form" href={lab('silk-ribbons')}><div className="expression-art"><div className="ribbon-sculpture" aria-hidden="true">{Array.from({length:9},(_,i)=><span key={i} style={{'--strip':i} as React.CSSProperties}/>)}</div><span className="expression-word">{t('形','FORM')}</span></div><div className="expression-caption"><span><small>02 / {t('材质与形态','MATERIAL & FORM')}</small><strong>{t('触碰另一种可能。','Feel another dimension.')}</strong></span><ArrowUpRight/></div></a>
     <a className="expression-card expression-print" href={lab('misregistration')}><div className="expression-art"><img src={sitePath('/images/alpine.jpg')} alt={t('云层下的雪山','Snowy mountains beneath the clouds')} loading="lazy"/><span className="expression-word">{t('印','PRINT')}</span><span className="print-cross" aria-hidden="true">+</span></div><div className="expression-caption"><span><small>03 / {t('图形与印刷','GRAPHIC & PRINT')}</small><strong>{t('偏差，也是风格。','Imperfection is a style.')}</strong></span><ArrowUpRight/></div></a>
    </div>
    <div className="all-effects-row"><p>{t('还有粒子、光、空间，以及你的灵感。','And particles, light, space — and your imagination.')}</p><a className="pill-button outline-button magnetic" href={lab()}><span>{t('探索全部 31 种效果','Explore all 31 effects')}</span><ArrowUpRight size={22}/></a></div>
   </section>

   <section id="start" className="start-section">
    <div className="start-top"><span>03 / {t('把想象，写进作品','FROM POSSIBILITY TO REALITY')}</span><span>npm / v0.1.1</span></div>
    <div className="start-main"><div><h2 className="reveal-heading">{t('现在，','Your next')}<br/>{t('轮到你了。','move.')}<span className="start-dot">●</span></h2><p>{t('一个命令，让下一次变化发生。','One command. A whole new way to move.')}</p></div><div className="start-actions"><Bloom className="start-bloom"/><button className="install-command" onClick={copy}><span><span className="command-dollar">$ </span>npm install varyloom@0.1.1</span>{copied?<Check size={20}/>:<Copy size={20}/>}<span className="install-tooltip" role="status">{copied?t('已复制','Copied'):t('复制安装命令','Copy install command')}</span></button>{copyError&&<p role="alert">{t('复制失败，请手动选择上方命令。','Copy failed. Please select the command above.')}</p>}<a className="start-code" href={lab(selected)+'&tab=code'}>{t('查看完整代码示例','See a complete code example')}<ArrowRight size={18}/></a></div></div>
    <div className="closing-wordmark" aria-hidden="true">varyloom<span>✳</span></div>
    <footer className="brand-footer"><span>© 2026 varyloom</span><span>{t('让变化，自成一景。','Make room for the unexpected.')}</span><a href="#top">{t('回到顶部','Back to top')}<ArrowUpRight size={16}/></a></footer>
   </section>
  </main>
 </div>;
}
