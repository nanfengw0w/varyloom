import vinext from 'vinext';
import {defineConfig} from 'vite';
const pages=process.env.GITHUB_PAGES==='true';
export default defineConfig({
 base:pages?'/varyloom/':'/',
 define:{'process.env.NEXT_PUBLIC_BASE_PATH':JSON.stringify(pages?'/varyloom':'')},
 plugins:[vinext()],
});
