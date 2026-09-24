'use client';
import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import type {Varyloom} from 'varyloom';
import {ArrowUpRight,ArrowLeft,ArrowRight,Check,Copy,Globe2,Play,RotateCcw,SlidersHorizontal,Code2,Eye,Menu,X,MoveHorizontal,Pause,ChevronDown,BookOpen,Package} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {SidebarProvider,Sidebar,SidebarContent,SidebarGroup,SidebarGroupLabel,SidebarMenu,SidebarMenuItem,SidebarMenuButton} from '@/components/ui/sidebar';
import {useIsMobile} from '@/hooks/use-mobile';
import {categories,effects,photographs,parameterNames,valueNames,choices,range,initialOptions,type Lang} from '@/lib/catalog';
import TransitionStage from './transition-stage';
import {useStudioMotion} from './studio-atmosphere';
import {useLanguage} from '@/lib/language';
import {sitePath} from '@/lib/site-path';
import {apiUrl,repositoryUrl,npmUrl} from '@/lib/project-links';
import {createCodeExample,type ExampleFramework} from '@/lib/code-examples';

function Choice({label,value,values,onChange}:{label:string;value:string;values:{value:string;label:string}[];onChange:(v:string)=>void}){
 return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="parameter-select"><SelectValue/></SelectTrigger><SelectContent>{values.map(x=><SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>;
}
function RangeControl({label,value,min,max,step,onChange,unit=''}:{label:string;value:number;min:number;max:number;step:number;onChange:(v:number)=>void;unit?:string}){
 const id='param-'+label.replace(/\s/g,'-');
 return <div className="range-control"><div className="control-label"><label id={id}>{label}</label><output>{Number(value.toFixed(2))}{unit}</output></div><Slider ref={node=>{node?.querySelector('[role="slider"]')?.setAttribute('aria-labelledby',id);}} aria-labelledby={id} value={[value]} min={min} max={max} step={step} onValueChange={v=>onChange(v[0])}/></div>;
}
export default function Playground({initialEffect='ink-reveal',initialLang='zh',initialTab='preview'}:{initialEffect?:string;initialLang?:Lang;initialTab?:string}){
 const studio=useRef<HTMLDivElement>(null);
 const isMobile=useIsMobile();
 const [lang,setLang]=useLanguage(initialLang);
 const [selected,setSelected]=useState(initialEffect);
 const effect=effects.find(e=>e.id===selected)!;
 const [options,setOptions]=useState<Record<string,unknown>>(initialOptions(effects.find(e=>e.id===initialEffect)!,initialLang));
 const [duration,setDuration]=useState(1.6);
 const [easing,setEasing]=useState('power2.inOut');
 const [autoplay,setAutoplay]=useState(false);
 const [tab,setTab]=useState(initialTab);
 const [framework,setFramework]=useState<ExampleFramework>('react');
 const [index,setIndex]=useState(0);
 useStudioMotion(studio,selected,index,tab);
 const [controller,setController]=useState<Varyloom|null>(null);
 const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 const [actual,setActual]=useState(initialEffect);
 const [menu,setMenu]=useState(false);
 const [copied,setCopied]=useState('');
 const [copyFailed,setCopyFailed]=useState(false);
 const [reduced,setReduced]=useState(false);
 const copyTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const t=(zh:string,en:string)=>lang==='zh'?zh:en;
 const photo=photographs[index];
 const fallback=actual!==selected&&status==='ready';
 const setOption=(key:string,value:unknown)=>setOptions(old=>{const next={...old};if(value==='opposite')delete next[key];else next[key]=value;return next;});
 const chooseEffect=(id:string)=>{if(id===selected){setMenu(false);return;}const e=effects.find(e=>e.id===id)!;setSelected(id);setOptions(initialOptions(e,lang));setMenu(false);setStatus('loading');};
 const chooseRef=useRef(chooseEffect);chooseRef.current=chooseEffect;
 useEffect(()=>{const url=new URL(window.location.href);url.searchParams.set('effect',selected);url.searchParams.set('tab',tab);window.history.replaceState(window.history.state,'',url);},[selected,tab]);
 useEffect(()=>{
  type Tool = {name:string;description:string;inputSchema:object;annotations:object;execute:(input:unknown)=>unknown};
  const context=(document as Document&{modelContext?:{registerTool:(tool:Tool,options:{signal:AbortSignal})=>unknown}}).modelContext;
  if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  const tool:Tool={name:'select_transition',description:'Select a built-in transition in the visible playground. This starts preparing its preview; it does not guarantee graphics compatibility.',inputSchema:{type:'object',properties:{effect:{type:'string',enum:effects.map(e=>e.id)}},required:['effect'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){
   if(!input||typeof input!=='object'||Object.keys(input).some(key=>key!=='effect'))throw new Error('Expected only an effect identifier.');
   const id=(input as {effect?:unknown}).effect;
   if(typeof id!=='string'||!effects.some(e=>e.id===id))throw new Error('Unknown transition.');
   flushSync(()=>{chooseRef.current(id);setTab('preview');});
   return {selectedEffect:id,status:'selected'};
  }};
  try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
  return()=>lifecycle.abort();
 },[]);
 const toggleLanguage=()=>{const next=lang==='zh'?'en':'zh';setLang(next);if(selected==='type-aperture')setOption('word',next==='zh'?'下一幕':'NEXT');};
 useEffect(()=>{document.documentElement.lang=lang==='zh'?'zh-CN':'en';document.title=lang==='zh'?'varyloom — 动态影像实验室':'varyloom — A study in motion';document.querySelector('meta[name="description"]')?.setAttribute('content',lang==='zh'?'探索 31 种影像转场，实时调整参数，复制代码开始创作。':'Explore 31 image transitions. Tune real parameters and copy code to start creating.');},[lang]);
 useEffect(()=>{setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches);return()=>{if(copyTimer.current)clearTimeout(copyTimer.current);};},[]);
 useEffect(()=>{if(!menu)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[menu]);
 async function copy(text:string,key:string){
  let success=false;
  try{await navigator.clipboard.writeText(text);success=true;}catch{
   const field=document.createElement('textarea');field.value=text;field.style.cssText='position:fixed;left:-9999px';document.body.appendChild(field);field.select();try{success=document.execCommand('copy');}catch{}field.remove();
  }
  setCopyFailed(!success);setCopied(success?key:'');if(copyTimer.current)clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(''),2000);
 }
 const code=createCodeExample(framework,{effect:selected,options,duration,easing,autoplay,startIndex:index,lang});
 const parameterEntries=Object.entries(options).filter(([key])=>key!=='imageFit');
 if(selected==='particle-shift'&&!('enterDirection' in options))parameterEntries.push(['enterDirection','opposite']);
 return <SidebarProvider ref={studio} className="studio-shell" data-photo={index}>
  <header className="site-header">
   <a href={sitePath('/?lang='+lang)} className="brand" aria-label={t('varyloom 首页','varyloom home')}><img src={sitePath('/favicon.svg')} width="34" height="34" alt=""/><span>varyloom</span></a>
   <span className="header-caption">{t('动态影像实验室','A study in motion')}</span>
   <nav className="lab-resource-links" aria-label={t('项目资源','Project resources')}><a href={apiUrl(lang)} target="_blank" rel="noreferrer" aria-label={t('查看完整文档','Read the documentation')} title={t('文档','Documentation')}><BookOpen size={16}/><span>{t('文档','Docs')}</span></a><a href={repositoryUrl} target="_blank" rel="noreferrer" aria-label={t('查看 GitHub 源码','View source on GitHub')} title="GitHub"><Code2 size={16}/><span>GitHub</span></a><a href={npmUrl} target="_blank" rel="noreferrer" aria-label={t('查看 npm 包','View the npm package')} title="npm"><Package size={16}/><span>npm</span></a></nav>
   <div className="header-actions"><a className="lab-home-link" href={sitePath('/?lang='+lang)}>{t('返回首页','Back to home')}<ArrowUpRight size={14}/></a><span className="version">v0.1.1</span><span className="header-divider"/><button onClick={toggleLanguage} aria-label={t('切换为英文','Switch to Chinese')} className="language-button"><Globe2 size={16}/>{t('中文','English')}<ChevronDown size={12}/></button><button className="mobile-menu" onClick={()=>setMenu(!menu)} aria-expanded={menu} aria-label={t('效果目录','Effects menu')}>{menu?<X/>:<Menu/>}</button></div>
  </header>
  {menu&&<button className="menu-scrim" onClick={()=>setMenu(false)} aria-label={t('关闭效果目录','Close effects menu')}/>}
  <Sidebar collapsible="none" inert={isMobile&&!menu} aria-hidden={isMobile&&!menu?true:undefined} className={'effect-sidebar '+(menu?'is-open':'')}>
   <div className="library-label"><span>{t('转场目录','TRANSITIONS')}</span><span className="count-pill">31</span></div>
   <SidebarContent><nav aria-label={t('转场效果分类','Transition categories')}>
    {categories.map((category,cat)=><SidebarGroup key={cat} className="effect-group"><SidebarGroupLabel className="category-label">{category[lang]}<span>{String(effects.filter(e=>e.category===cat).length).padStart(2,'0')}</span></SidebarGroupLabel><SidebarMenu>{effects.filter(e=>e.category===cat).map(e=><SidebarMenuItem key={e.id}><SidebarMenuButton className="effect-button" isActive={e.id===selected} onClick={()=>chooseEffect(e.id)} aria-current={e.id===selected?'true':undefined} data-effect-id={e.id}><span className="effect-marker"/><span>{e.name[lang]}</span>{e.id===selected?<ArrowUpRight size={15}/>:e.backend==='webgpu'?<span className="gpu-small">GPU</span>:null}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>)}
   </nav></SidebarContent>
   <div className="sidebar-bottom"><span className="little-star">✳</span><span>{t('让变化，自成一景。','Make room for the unexpected.')}</span></div>
  </Sidebar>
  <main className="main-workspace" inert={isMobile&&menu}>
   <div className="effect-heading"><div className="heading-copy"><div className="eyebrow"><span>{t('转场实验','TRANSITION STUDIES')}</span><span>/</span><span>{categories[effect.category][lang]}</span></div><h1>{effect.name[lang]}<span className="title-dot">.</span></h1><p>{effect.description[lang]}</p></div><div className="study-number" aria-hidden="true"><span>№</span>{effect.number}</div></div>
   <Tabs value={tab} onValueChange={setTab} className="workspace-tabs">
    <div className="tabs-toolbar"><TabsList variant="line"><TabsTrigger value="preview"><Eye size={16}/>{t('预览','Preview')}</TabsTrigger><TabsTrigger value="code"><Code2 size={16}/>{t('代码','Code')}</TabsTrigger></TabsList><span className="backend-label">{effect.backend==='custom'?t('浏览器渲染','Browser rendering'):effect.backend==='webgpu'?'WebGPU':effect.backend==='ogl'?'WebGL':'WebGL 2'}<span className="backend-line"/></span></div>
    <TabsContent value="preview" forceMount className="preview-panel">
     <div className="preview-grid">
      <div className="image-column">
       <div className="stage-frame"><div className="art-stage" data-testid="art-stage" data-status={status} data-active-effect={actual}>
        <TransitionStage effect={effect} options={options} duration={duration} easing={easing} autoplay={autoplay} visible={tab==='preview'} lang={lang} index={index} onIndex={setIndex} onController={setController} onStatus={(s,a)=>{setStatus(s);setActual(a);}}/>
        <div className="stage-top" aria-hidden="true"><span className="stage-caption">{t('影像研究','IMAGE STUDY')}<span>— {String(index+1).padStart(2,'0')}</span></span><span className="stage-coordinate">{t('光 · 形 · 运动','LIGHT / FORM / MOTION')}</span></div>
        {status==='loading'&&<div className="stage-message"><span className="loading-line"/>{t('正在准备影像…','Preparing the image…')}</div>}
        {status==='error'&&<div className="stage-message error-message"><p>{t('当前浏览器无法渲染此效果。','This browser could not render the effect.')}</p><button onClick={()=>chooseEffect('melt')}>{t('尝试液态融化','Try Melt')}<ArrowRight size={15}/></button></div>}
        <div className="stage-bottom"><div className="photo-title"><span>{t('图像','FRAME')} {String(index+1).padStart(2,'0')} / 04</span><strong>{photo.name[lang]}</strong></div><div className="stage-controls"><button disabled={status!=='ready'} onClick={()=>controller?.prev()} aria-label={t('上一张图片','Previous image')}><ArrowLeft size={18}/></button><button className="play-button" disabled={status!=='ready'} onClick={()=>controller?.next()} aria-label={t('播放转场','Play transition')}><Play size={17} fill="currentColor"/></button><button disabled={status!=='ready'} onClick={()=>controller?.next()} aria-label={t('下一张图片','Next image')}><ArrowRight size={18}/></button></div></div>
       </div></div>
       <div className="image-caption"><span>{photo.place[lang]}</span><span><MoveHorizontal size={14}/>{t('拖动影像，或点击播放','Drag the image, or press play')}</span></div>
       <div className="image-selector-heading"><h2>{t('换一种风景','A change of scenery')}</h2><span>{t('点击图片即刻转场','SELECT AN IMAGE TO TRANSITION')}</span></div>
       <div className="thumbnail-strip">{photographs.map((p,i)=><button key={p.file} className={'thumbnail '+(i===index?'selected':'')} onClick={()=>controller?.goTo(i)} disabled={status!=='ready'} aria-label={t('切换到：','Switch to: ')+p.name[lang]} aria-pressed={i===index}><div className="thumbnail-image"><img src={sitePath('/images/'+p.file)} alt={p.alt[lang]} width="192" height="120"/><span className="thumbnail-number">0{i+1}</span>{i===index&&<span className="thumbnail-check"><Check size={12}/></span>}</div><span>{p.name[lang]}</span></button>)}</div>
       <div className="photo-credit">{t('摄影','Photography')} · <a href={photo.source} target="_blank" rel="noreferrer">{photo.author}<ArrowUpRight size={12}/></a><span>/</span><a href="https://unsplash.com/license" target="_blank" rel="noreferrer">{t('Unsplash 授权素材','Unsplash license')}</a></div>
      </div>
      <aside className="parameter-panel" aria-label={t('效果参数','Effect parameters')}>
       <div className="parameter-header"><h2><SlidersHorizontal size={16}/>{t('调校','Fine-tune')}</h2><button className="reset-button" onClick={()=>{setOptions(initialOptions(effect,lang));setDuration(1.6);setEasing('power2.inOut');setAutoplay(false);}} aria-label={t('重置参数','Reset parameters')}><RotateCcw size={14}/>{t('重置','Reset')}</button></div>
       <div className="parameter-body">
        <div className="parameter-section-title">{t('基础设置','PLAYBACK')}</div>
        <RangeControl label={t('转场时长','Duration')} value={duration} min={.3} max={4} step={.1} unit={t(' 秒',' s')} onChange={v=>{setDuration(v);controller?.setOptions({duration:v});controller?.next();}}/>
        <div className="field-control"><label>{t('影像适配','Image fit')}</label><Choice label={t('影像适配','Image fit')} value={String(options.imageFit)} values={[{value:'cover',label:t('填满画面','Cover')},{value:'contain',label:t('完整显示','Contain')}]} onChange={v=>setOption('imageFit',v)}/></div>
        {['ink-reveal','melt'].includes(selected)&&<div className="field-control"><label>{t('缓动曲线','Easing')}</label><Choice label={t('缓动曲线','Easing')} value={easing} values={[{value:'power2.inOut',label:t('平滑进出','Smooth in-out')},{value:'none',label:t('匀速','Linear')},{value:'power3.out',label:t('快速启动','Quick start')}]} onChange={v=>{setEasing(v);controller?.setOptions({easing:v});controller?.next();}}/></div>}
        <div className="switch-control"><label htmlFor="autoplay">{t('自动播放','Autoplay')}</label><Switch id="autoplay" checked={autoplay} onCheckedChange={setAutoplay}/></div>
        {parameterEntries.length>0&&<><div className="parameter-section-title effect-settings-title">{t('效果参数','EFFECT SETTINGS')}</div><fieldset disabled={fallback||status==='error'} className="effect-fields">{parameterEntries.map(([key,value])=>{
         const label=parameterNames[key]?.[lang]??key;const enumValues=choices(selected,key);const [min,max,step]=range(selected,key);
         if(enumValues)return <div className="field-control" key={key}><label>{label}</label><Choice label={label} value={String(value)} values={enumValues.map(v=>({value:v,label:valueNames[v][lang]}))} onChange={v=>setOption(key,key==='spinDirection'?Number(v):v)}/></div>;
         if(typeof value==='number')return <RangeControl key={key} label={label} value={value} min={min} max={max} step={step} onChange={v=>setOption(key,v)}/>;
         if(typeof value==='boolean')return <div className="switch-control" key={key}><label htmlFor={key}>{label}</label><Switch id={key} checked={value} onCheckedChange={v=>setOption(key,v)}/></div>;
         if(typeof value==='string'&&value.startsWith('#'))return <div key={key} className="color-control"><label htmlFor={key}>{label}</label><input type="color" id={key} value={value} onChange={e=>setOption(key,e.target.value)}/><span>{value.toUpperCase()}</span></div>;
         return <div className="field-control" key={key}><label htmlFor={key}>{label}</label><input className="word-input" id={key} value={String(value)} maxLength={12} onChange={e=>setOption(key,e.target.value||t('下一幕','NEXT'))}/></div>;
        })}</fieldset></>}
        {fallback&&<p className="compatibility-note" role="status">{t('此环境无法运行所选效果，当前演示为「液态融化」。','The selected effect is unavailable here. This preview is showing Melt.')}</p>}
        {effect.backend==='webgpu'&&!fallback&&<p className="compatibility-note">{t('此效果需要支持 WebGPU 的浏览器与显卡。','This effect needs a WebGPU-compatible browser and graphics device.')}</p>}
        {reduced&&<p className="compatibility-note">{t('已遵循系统减少动态效果设置，转场时长不超过 0.25 秒。','Reduced motion is enabled. Transitions are capped at 0.25 seconds.')}</p>}
       </div>
       <div className="parameter-footer"><span className="live-indicator"/>{status==='loading'?t('正在更新','Updating'):status==='error'?t('预览不可用','Preview unavailable'):t('参数实时生效','Changes apply live')}</div>
      </aside>
     </div>
    </TabsContent>
    <TabsContent value="code" className="code-panel">
     <div className="code-intro"><h2>{t('把变化带进你的作品。','Bring a little motion to your work.')}</h2><p>{t('安装已发布的版本。示例代码与当前效果及参数保持同步。','Install the published release. This example follows your selected effect and settings.')}</p></div>
     <section className="install-block"><div className="code-block-heading"><span><span className="step-number">01</span>{t('安装依赖','Install the package')}</span><button onClick={()=>copy('npm install varyloom@0.1.1','install')}>{copied==='install'?<Check size={15}/>:<Copy size={15}/>} {copied==='install'?t('已复制','Copied'):t('复制命令','Copy command')}</button></div><pre><code><span className="code-dollar">$</span> npm install varyloom@0.1.1</code></pre></section>
     <div className="example-toolbar"><div className="framework-picker" role="group" aria-label={t('示例技术栈','Example framework')}><button onClick={()=>{setFramework('react');setCopied('');}} aria-pressed={framework==='react'}>React · TSX</button><button onClick={()=>{setFramework('vanilla');setCopied('');}} aria-pressed={framework==='vanilla'}>{t('原生 JavaScript','Vanilla JavaScript')}</button></div><a className="effect-api-link" href={apiUrl(lang,selected)} target="_blank" rel="noreferrer">{t('此效果的参数文档','Effect parameter reference')}<ArrowUpRight size={15}/></a></div>
     <div className="framework-guidance">{framework==='react'?<p>{t('保存为 Gallery.tsx，适用于 React 18+。Next.js App Router 请保留第一行的「use client」声明，并在页面中导入此组件。','Save as Gallery.tsx in React 18+. With Next.js App Router, keep the first-line “use client” directive and import this component into your page.')}</p>:<><p>{t('保存为 Vite 项目根目录的 index.html，使用 npm 包导入。新建空项目时，先复制并运行下面的启动命令，再粘贴完整示例。','Save as index.html at the root of a Vite project to resolve the npm import. For an empty project, run the setup command below, then paste the complete example.')}</p><div className="vanilla-setup"><code>npm install -D vite &amp;&amp; npx vite</code><button onClick={()=>copy('npm install -D vite && npx vite','setup')} aria-label={t('复制原生示例启动命令','Copy vanilla setup command')}>{copied==='setup'?<Check size={14}/>:<Copy size={14}/>}</button></div></>}</div>
     <section className="example-block"><div className="code-block-heading"><span><span className="step-number">02</span>{framework==='react'?'Gallery.tsx':'index.html'}</span><button onClick={()=>copy(code,'example')}>{copied==='example'?<Check size={15}/>:<Copy size={15}/>} {copied==='example'?t('已复制','Copied'):t('复制代码','Copy code')}</button></div><pre tabIndex={0} aria-label={t('可复制的完整示例代码','Copyable complete example')}><code>{code.split('\n').map((line,i)=><span className={'code-line '+(line.trim().startsWith('import')?'code-import':'')} key={i}><span className="line-number" aria-hidden="true">{i+1}</span>{line||' '}</span>)}</code></pre></section>
     <p className="code-note">{framework==='react'?t('控制器引用使用包导出的 VaryloomController 类型；效果参数由对应类型校验。组件卸载时会自动释放资源。','The ref uses the exported VaryloomController type; effect options are checked against their specific type. Resources are released on unmount.'):t('原生示例包含容器、操作按钮、错误提示和销毁逻辑；单页应用在移除画廊时请调用 destroyGallery()。','The vanilla example includes a container, controls, error handling, and cleanup. In a single-page app, call destroyGallery() when removing the gallery.')}</p>
     {selected==='archive-seal'&&<p className="code-note">{t('此效果原版图形内的印章文字为英文；本演示通过界面层将其本地化。','The original effect includes a fixed English stamp. This demo localizes it in the presentation layer.')}</p>}
     {copyFailed&&<p role="alert" className="copy-error">{t('浏览器未允许复制，请选中上方代码手动复制。','Clipboard access was denied. Select the code above to copy it manually.')}</p>}
    </TabsContent>
   </Tabs>
   <footer className="workspace-footer"><span>varyloom <span className="footer-slash">/</span> {t('为下一次视觉实验而生','Made for your next visual experiment')}</span><span>31 {t('种可能，无限种表达。','possibilities. Endless expressions.')}</span></footer>
  </main>
 </SidebarProvider>;
}
