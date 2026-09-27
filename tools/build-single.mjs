// 单文件预览版构建：把全部 JS/CSS/图标内联进一个 HTML（项目根「单文件版.html」）
// 动机：ES 模块在 file:// 下被 CORS 拦截、跨子目录静态伺服会丢资源——
// 内联后的 <script type="module"> 不发请求，双击、任意路径、任意静态服务器都能跑。
// 用法：npm run build:single；部署仍用 dist/（保留 three 懒加载拆包）。
import { build } from 'vite';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const tmp = resolve(root, '.single-tmp');

await build({
  logLevel: 'error',
  build: {
    outDir: tmp,
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true, // three 并入主包：单文件里没有懒加载语义
        entryFileNames: 'assets/bundle.js',
        chunkFileNames: 'assets/bundle.js',
        assetFileNames: 'assets/bundle.css',
      },
    },
  },
});

let html = readFileSync(resolve(tmp, 'index.html'), 'utf8');
const js = readFileSync(resolve(tmp, 'assets/bundle.js'), 'utf8');
const css = readFileSync(resolve(tmp, 'assets/bundle.css'), 'utf8');

// 内联时转义 </script>，避免包体里的字符串提前闭合标签（JS 字符串/正则中 \/ 合法）
const safeJs = js.replace(/<\/script/gi, '<\\/script');
html = html.replace(/<script type="module"[^>]*><\/script>/i, () => `<script type="module">\n${safeJs}\n</script>`);
html = html.replace(/<link rel="stylesheet"[^>]*>/i, () => `<style>\n${css}\n</style>`);
html = html.replace(/<link rel="modulepreload"[^>]*>\n?/gi, '');
const favPath = resolve(root, 'public/favicon.svg');
if (existsSync(favPath)) {
  const fav = `data:image/svg+xml;base64,${readFileSync(favPath).toString('base64')}`;
  html = html.replaceAll('./favicon.svg', fav);
}
writeFileSync(resolve(root, '单文件版.html'), html);
rmSync(tmp, { recursive: true, force: true });
console.log(`✅ 单文件版.html 已生成（${(html.length / 1024 / 1024).toFixed(1)} MB，双击即可玩）`);
