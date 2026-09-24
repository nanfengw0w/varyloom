import type { Metadata } from 'next';
import './globals.css';
import './studio.css';
import './brand.css';
import './adoption.css';
import {sitePath} from '@/lib/site-path';
export const metadata: Metadata = { title: 'varyloom — 让影像，生动起来。', description: '31 种转场，让每一次变化都有自己的表达。探索 varyloom 的动态影像世界。', icons: {icon:sitePath('/favicon.svg')} };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><head><link rel="stylesheet" href={sitePath('/fonts/noto-sans-sc.css')}/></head><body>{children}</body></html>;}
