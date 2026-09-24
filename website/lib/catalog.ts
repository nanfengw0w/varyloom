import definitions from './effect-defaults.json';
export type Lang = 'zh' | 'en';
export type Words = { zh: string; en: string };
export const w = (zh: string, en: string): Words => ({ zh, en });
export const categories = [w('流动与显影','Flow & reveal'), w('材质与形态','Material & form'), w('图形与印刷','Graphic & print'), w('粒子与光','Particles & light'), w('空间与透视','Space & perspective')];
const rows: [keyof typeof definitions, number, string, string, string, string][] = [
 ['ink-reveal',0,'墨迹显影','Ink reveal','让影像像墨水一样，在纤维之间慢慢苏醒。','An image slowly surfaces, like ink finding its way through paper.'],
 ['melt',0,'液态融化','Melt','流动、折射，消融两幅影像之间的边界。','A fluid distortion dissolves the boundary between two images.'],
 ['gummy-squeeze',0,'柔弹挤压','Gummy squeeze','让画面拥有柔软、富有弹性的触感。','A soft, elastic squeeze gives an image a tactile new dimension.'],
 ['flow-morph',0,'流场变形','Flow morph','循着流场的轨迹，让两幅影像自然相遇。','Two images meet along the paths of an invisible flow field.'],
 ['rack-focus',0,'焦点转移','Rack focus','在模糊与清晰之间，重新分配你的注意力。','Attention shifts through a cinematic breath of blur and focus.'],
 ['liquid-lens',0,'液滴透镜','Liquid lens','细小液滴聚合，把下一幅画面折射出来。','Refractive droplets gather to reveal the next image.'],
 ['frequency-handoff',0,'频率交接','Frequency handoff','从轮廓到细节，让影像逐层接续。','Pass an image from broad shapes to its finest details.'],
 ['darkroom-develop',0,'暗房显影','Darkroom develop','重温暗房中，一幅照片缓缓浮现的时刻。','Revisit the quiet moment a photograph emerges in a darkroom.'],
 ['prismatic-glass',1,'棱镜玻璃','Prismatic glass','穿过弯曲的玻璃，让光线与色彩重新排列。','Bend light and color through a sculptural sheet of glass.'],
 ['silk-ribbons',1,'丝绸织带','Silk ribbons','光泽在丝带间游走，编织成下一幅影像。','Luminous ribbons weave their way into the next image.'],
 ['torn-paper',1,'撕纸拼贴','Torn paper','沿着不规则的纸边，揭开影像的另一层。','Peel back an irregular paper edge to uncover another layer.'],
 ['burn-through',1,'灼烧穿透','Burn through','让余烬沿着画面蔓延，留下新的风景。','An ember travels across the frame, leaving a new landscape behind.'],
 ['impasto-stroke',1,'厚涂笔触','Impasto stroke','以厚重颜料的笔触，涂抹出下一幕。','Paint the next scene with rich, textured brushstrokes.'],
 ['holo-foil',1,'全息箔片','Holo foil','金属薄膜掠过，折射出游移的虹彩。','An iridescent film catches the light as it sweeps across the image.'],
 ['lenticular-shift',1,'光栅移像','Lenticular shift','在微小透镜之间，发现另一种观看角度。','Discover another view between the ridges of a lenticular lens.'],
 ['zipper-cloth',1,'织物拉链','Zipper cloth','像打开一块织物，让画面从中间展开。','Unzip the surface and unfold a new image from within.'],
 ['drowsy-blinds',1,'慵懒百叶','Drowsy blinds','错落翻动的百叶，让时间有了层次。','Staggered slats turn, giving the passage of time a rhythm.'],
 ['postcard-relay',1,'明信片接力','Postcard relay','一张明信片离开，另一段记忆到来。','One postcard departs; another memory takes its place.'],
 ['memory-mosaic',1,'记忆拼图','Memory mosaic','把影像拆成记忆碎片，再一次重新拼合。','Reassemble an image from fragments of visual memory.'],
 ['iris-shutter',1,'虹膜快门','Iris shutter','随着光圈开合，在瞬间发现新的景象。','A mechanical iris opens onto a different scene.'],
 ['misregistration',2,'错版印刷','Misregistration','让色版轻微错位，留下印刷独有的痕迹。','Offset the color plates for the beautiful imperfections of print.'],
 ['contour-reveal',2,'等高线显影','Contour reveal','沿着地形般的轮廓，一层层描摹画面。','Trace the next image through topographic layers and contours.'],
 ['type-aperture',2,'文字光窗','Type aperture','以文字作为窗口，让下一幅影像穿过。','Let typography become a window into the next image.'],
 ['archive-seal',2,'档案封印','Archive seal','拆开影像的封印，开启一份新的视觉档案。','Break the seal and open a new visual archive.'],
 ['contact-sheet',2,'胶片接触印样','Contact sheet','在胶片印样的节奏中，将画面逐格替换。','Replace the frame with the measured rhythm of a film contact sheet.'],
 ['particle-shift',3,'粒子迁移','Particle shift','将影像释放为粒子，再聚合成新的风景。','Release an image into particles, then gather a new landscape.'],
 ['chromatic-dust',3,'色散微尘','Chromatic dust','让彩色晶尘散开，在光中重新凝聚。','Colored crystal dust disperses and reforms in the light.'],
 ['fiber-flow',3,'纤维流光','Fiber flow','发光纤维交织，勾勒出影像的流动轨迹。','Luminous fibers trace the flowing paths between images.'],
 ['meteor-wake',3,'流星尾迹','Meteor wake','让光点划过画面，留下短暂而明亮的余迹。','Streaks of light cross the frame, leaving a luminous afterglow.'],
 ['depth-flip',4,'纵深翻转','Depth flip','把平面影像折入空间，让视角随之翻转。','Fold a flat image into space and turn its perspective.'],
 ['vortex-portal',4,'漩涡之门','Vortex portal','旋转、扭曲，穿过通往下一幕的入口。','Twist through a swirling portal into the next scene.'],
];
export const effects = rows.map(([id,category,zh,en,descZh,descEn],index)=>({id,category,name:w(zh,en),description:w(descZh,descEn),number:String(index+1).padStart(2,'0'),...definitions[id]}));
export type Effect = typeof effects[number];
export const photographs = [
 {file:'dunes-sculptural.jpg',name:w('沙丘的褶皱','Dune studies'),place:w('纳米比亚 · 索苏斯盐沼','Sossusvlei, Namibia'),alt:w('金色沙丘上光与影分明的弧形山脊','A sculptural ridge of golden sand dunes in light and shadow'),author:'Bernd Dittrich',source:'https://unsplash.com/photos/Biao_CjMnV4',remote:'https://images.unsplash.com/photo-1645596065141-2a9b8944346c?auto=format&fit=crop&w=1920&h=1200&q=85'},
 {file:'alpine.jpg',name:w('山的暗面','Alpine silence'),place:w('意大利 · 阿尔卑斯山','Italian Alps'),alt:w('云雾笼罩的深色阿尔卑斯山与积雪山峰','Dark Alpine mountains and snowy peaks beneath a cloudy sky'),author:'Marek Piwnicki',source:'https://unsplash.com/photos/TfHposjc2YY',remote:'https://images.unsplash.com/photo-1579983045195-3cae5c828ece?auto=format&fit=crop&w=1920&h=1200&q=85'},
 {file:'forest.jpg',name:w('林间留白','Into the mist'),place:w('雾中的常绿森林','Evergreen forest'),alt:w('薄雾在层叠的深绿色森林之间流动','Layers of evergreen forest drifting into soft mist'),author:'Roksolana Zasiadko',source:'https://unsplash.com/photos/rS2WbCgN7KM',remote:'https://images.unsplash.com/photo-1469106233956-20341cc41f8b?auto=format&fit=crop&w=1920&h=1200&q=85'},
 {file:'coast.jpg',name:w('海的边界','Ocean margins'),place:w('澳大利亚 · 塔斯马尼亚','Tasmania, Australia'),alt:w('深蓝海水与白色浪花围绕浅色岩石的俯视景象','An aerial view of deep blue waves around pale coastal rocks'),author:'Rod Long',source:'https://unsplash.com/photos/kuMClzSaeIU',remote:'https://images.unsplash.com/photo-1715152075332-46ded6ff0996?auto=format&fit=crop&w=1920&h=1200&q=85'},
];
export const parameterNames: Record<string,Words> = Object.fromEntries([
 ['edgeStrength','边缘强度','Edge strength'],['colorLag','色彩延迟','Color delay'],['debugField','显示显影场','Reveal field'],['particleCount','粒子数量','Particle count'],['particleSize','粒子尺寸','Particle size'],['turbulence','扰动强度','Turbulence'],['exitDirection','离场方向','Exit direction'],['enterDirection','入场方向','Enter direction'],['intensity','融化强度','Intensity'],['scale','纹理尺度','Texture scale'],['aberration','色差','Aberration'],['drift','漂移','Drift'],['overlayColor','叠加颜色','Overlay color'],['direction','运动方向','Direction'],['refraction','折射强度','Refraction'],['dispersion','色散','Dispersion'],['curvature','曲率','Curvature'],['edgeGlow','边缘辉光','Edge glow'],['ribbonCount','织带数量','Ribbon count'],['curl','卷曲程度','Curl'],['stagger','错峰程度','Stagger'],['sheen','表面光泽','Sheen'],['plateSpread','色版偏移','Plate spread'],['halftoneScale','网点尺度','Halftone scale'],['paperTint','纸张颜色','Paper tint'],['punch','冲击强度','Punch'],['origin','起始位置','Origin'],['burnWidth','燃烧宽度','Burn width'],['charDepth','焦痕深度','Char depth'],['roughness','边缘粗糙度','Roughness'],['smoke','烟雾浓度','Smoke'],['emberColor','余烬颜色','Ember color'],['blur','模糊强度','Blur'],['desaturation','去色程度','Desaturation'],['exposureBreath','曝光起伏','Exposure breath'],['grain','颗粒','Grain'],['focusPoint','对焦位置','Focus point'],['dropCount','液滴数量','Drop count'],['surfaceTension','表面张力','Surface tension'],['ripple','涟漪','Ripple'],['mergeSpeed','聚合速度','Merge speed'],['tearSeed','撕裂纹理种子','Tear seed'],['layers','纸张层数','Layers'],['fiberWidth','纤维宽度','Fiber width'],['shadowStrength','阴影强度','Shadow strength'],['crystalCount','晶体数量','Crystal count'],['crystalSize','晶体尺寸','Crystal size'],['density','密度','Density'],['strandCount','纤维数量','Strand count'],['segmentsPerStrand','每条纤维分段','Segments per strand'],['width','纤维宽度','Fiber width'],['glow','辉光','Glow'],['order','交接顺序','Order'],['bloom','泛光','Bloom'],['strength','变形强度','Strength'],['alpha','流场平滑度','Flow smoothness'],['flowBias','流向偏移','Flow bias'],['softness','柔和程度','Softness'],['safelight','安全灯强度','Safelight'],['bristles','笔毛数量','Bristles'],['wetness','湿润程度','Wetness'],['gloss','光泽','Gloss'],['bead','颜料堆积','Paint bead'],['lensCount','透镜数量','Lens count'],['glint','闪光','Glint'],['sheetSoftness','薄片柔度','Sheet softness'],['foilWidth','箔片宽度','Foil width'],['filmDensity','薄膜密度','Film density'],['glitter','闪烁','Glitter'],['edgeLight','边缘光','Edge light'],['levels','轮廓层数','Contour levels'],['lineInk','线条墨量','Line ink'],['relief','浮雕深度','Relief'],['fillLag','填充延迟','Fill delay'],['directionBias','方向偏移','Direction bias'],['depth','纵深','Depth'],['perspective','透视程度','Perspective'],['spread','扩散','Spread'],['afterglow','余辉','Afterglow'],['word','窗口文字','Aperture text'],['twist','扭曲程度','Twist'],['originX','水平原点','Horizontal origin'],['originY','垂直原点','Vertical origin'],['spinDirection','旋转方向','Spin direction'],
].map(([key,zh,en])=>[key,w(zh,en)]));
export const valueNames: Record<string,Words> = {auto:w('自动','Automatic'),opposite:w('与离场相反','Opposite exit'),right:w('向右','Right'),left:w('向左','Left'),up:w('向上','Up'),down:w('向下','Down'),top:w('上方','Top'),bottom:w('下方','Bottom'),radial:w('径向','Radial'),center:w('中心','Center'),pointer:w('点击位置','Pointer'),'-1':w('逆时针','Counterclockwise'),'1':w('顺时针','Clockwise'),'coarse-first':w('先轮廓后细节','Coarse to fine'),'fine-first':w('先细节后轮廓','Fine to coarse')};
export function choices(id:string,key:string): string[] | undefined {
 if(key==='direction') return id==='depth-flip'?['auto','right','left','bottom','top']:id==='chromatic-dust'?['auto','right','left','radial']:id==='fiber-flow'?['auto','right','left','down']:['auto','right','left','down','up'];
 if(key==='exitDirection') return ['auto','right','left','up','down'];
 if(key==='enterDirection') return ['opposite','right','left','top','bottom'];
 if(key==='origin'||key==='focusPoint') return ['center','pointer'];
 if(key==='order') return ['coarse-first','fine-first'];
 if(key==='spinDirection') return ['1','-1'];
}
// UI exploration ranges, not claims about limits enforced by the library.
export function range(id:string,key:string):[number,number,number] {
 const ranges:Record<string,[number,number,number]>={alpha:[.01,1,.01],colorLag:[0,.3,.01],particleCount:id==='meteor-wake'?[8192,98304,1024]:[16000,300000,1000],particleSize:[.3,3,.05],scale:[.5,6,.1],ribbonCount:[4,80,1],halftoneScale:[20,300,1],dropCount:[3,12,1],tearSeed:[0,10,.1],layers:[1,3,1],crystalCount:[4000,80000,1000],crystalSize:[.5,3,.05],strandCount:[96,1000,8],segmentsPerStrand:[12,128,4],width:[.3,4,.05],strength:[0,2,.05],softness:[.05,.2,.01],bristles:[10,140,1],lensCount:[8,100,1],foilWidth:[.02,.5,.01],filmDensity:[1,15,.1],levels:[2,20,1],fillLag:[0,.18,.01],perspective:[1,4,.05],originX:[.05,.95,.01],originY:[.05,.95,.01],turbulence:[0,2,.05]};
 return ranges[key]??[0,1,.01];
}
export function initialOptions(effect:Effect,lang:Lang):Record<string,unknown>{return {...effect.defaults,...(effect.id==='silk-ribbons'?{imageFit:'contain'}:{}),...(effect.id==='type-aperture'?{word:lang==='zh'?'下一幕':'NEXT'}:{})};}
