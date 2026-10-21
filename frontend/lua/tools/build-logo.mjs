// Build a small browser authoring app. Its page previews and downloads the
// finished PNG; the shipped menu never runs this GPU/readback pipeline.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
// Extract the approved angular artwork, then render its border and hand-drawn
// reflections on the source-scale logical grid and export exact 2x pixels.
// The legacy extractor targets the older rounded logo.
if (!process.argv.includes('--legacy')) {
  const web=mkdtempSync(join(tmpdir(),'luminous-angular-logo-'));
  cpSync(join(here,'branding/colorless-angular.png'),join(web,'source.png'));
  cpSync(join(here,'logo_border.js'),join(web,'logo_border.js'));
  cpSync(join(here,'logo_reflections.js'),join(web,'logo_reflections.js'));
  writeFileSync(join(web,'index.html'),`<!doctype html><title>COLORLESS angular logo export</title>
<style>body{background:#20282b}canvas{max-width:100%}</style>
<canvas id="canvas" width="1024" height="380"></canvas>
<a id="download" hidden download="colorless-menu.png">Download finished logo</a>
<script type="module">
import { rebuildBorder } from './logo_border.js';
const source=new Image();source.src='source.png';
await source.decode();
{
  const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');
  const scale=Math.min(canvas.width/source.width,canvas.height/source.height);
  const w=source.width*scale,h=source.height*scale;
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
  window.borderStats=rebuildBorder(ctx);
  const url=canvas.toDataURL('image/png');window.logoPng=url.split(',')[1];
  const link=document.getElementById('download');link.href=url;link.hidden=false;
}
</script>`);
  console.log(web);
  process.exit(0);
}
const source=resolve(process.env.BALATRO_SOURCE || join(here,'../../../../balatro-source'));
const root=mkdtempSync(join(tmpdir(),'luminous-logo-'));
const stage=join(root,'source'),web=join(root,'web');
for(const directory of ['ui','tools','assets/branding']) mkdirSync(join(stage,directory),{recursive:true});
mkdirSync(web);
cpSync(join(here,'logo_bake.lua'),join(stage,'tools/logo_bake.lua'));
cpSync(join(here,'logo_shapes.lua'),join(stage,'tools/logo_shapes.lua'));
cpSync(join(here,'../ui/logo_mask.lua'),join(stage,'ui/logo_mask.lua'));
cpSync(join(here,'../assets/branding/colorless.png'),join(stage,'assets/branding/colorless.png'));
writeFileSync(join(stage,'conf.lua'),`function love.conf(t)
t.identity='colorless-logo-bake';t.version='11.4';t.window.width=960;t.window.height=356
t.modules.physics=false;t.modules.video=false
end`);
writeFileSync(join(stage,'main.lua'),`local logo
function love.load() print('Logo renderer ready') end
function love.draw()
  if not logo then
    local pixels
    logo,pixels=require('tools.logo_bake').new(function(face)
      local png=face:encode('png')
      print('FACE_PNG:'..love.data.encode('string','base64',png))
      png:release()
    end)
    local png=pixels:encode('png')
    print('LOGO_PNG:'..love.data.encode('string','base64',png))
    png:release();pixels:release()
  end
  love.graphics.clear(0.12,0.15,0.17,1)
  love.graphics.setColor(1,1,1,1)
  local w,h=logo:getDimensions()
  local scale=math.min(960/w,356/h)
  love.graphics.draw(logo,0,0,0,scale,scale)
end`);
execFileSync(process.execPath,[join(source,'node_modules/love.js/index.js'),'--compatibility','--title','COLORLESS logo bake','--memory','134217728',stage,web]);
writeFileSync(join(web,'index.html'),`<!doctype html><title>COLORLESS logo bake</title>
<canvas id="canvas" width="960" height="356"></canvas>
<a id="download" hidden download="colorless-menu.png">Download finished logo</a>
<script>var Module={arguments:['./'],canvas:document.getElementById('canvas'),print:function(s){
if(s.startsWith('LOGO_PNG:')){window.logoPng=s.slice(9);var a=document.getElementById('download');a.href='data:image/png;base64,'+window.logoPng;a.hidden=false;}else if(s.startsWith('FACE_PNG:')){window.facePng=s.slice(9);}else console.log(s);
}};</script><script src="game.js"></script><script src="love.js" onload="Love(Module)"></script>`);
console.log(web);
