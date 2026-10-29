// Builds dist/critical-path.html: one self-contained page (styles, engine, app and
// content inlined) for sharing as a single file or hosted page. Uses esbuild via npx.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const js = execFileSync('npx', ['--yes', 'esbuild@0.24.0', 'app/app.js', '--bundle', '--format=esm', '--minify'], { cwd: root, encoding: 'utf8' });
const manifest = JSON.parse(read('content/projects.json'));
const content = {
  world: JSON.parse(read('content/world.json')),
  deck: JSON.parse(read('content/scenarios/core-deck.json')),
  projects: manifest.projects.map((id) => JSON.parse(read(`content/projects/${id}.json`))),
};

const html = read('app/index.html');
const head = html.match(/<title>[\s\S]*?(?=<link rel="stylesheet" href="style.css">)/)[0];
const body = html.match(/<body>([\s\S]*?)<script type="module"/)[1];
const safeJson = JSON.stringify(content).replace(/</g, '\\u003c');

const out = `${head.trim()}
<style>
${read('app/style.css')}
</style>
${body.trim()}
<script>window.CP_CONTENT = ${safeJson};</script>
<script type="module">
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/critical-path.html'), out);
console.log(`dist/critical-path.html ${(out.length / 1024).toFixed(1)} KB`);
