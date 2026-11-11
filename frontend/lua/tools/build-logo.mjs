// Build a small browser authoring app. Its page previews and downloads the
// finished PNG; the shipped menu never runs this GPU/readback pipeline.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
// Extract the approved angular artwork, then render its border and hand-drawn
// reflections on the source-scale logical grid and export exact 2x pixels.
const web = mkdtempSync(join(tmpdir(), "colorless-angular-logo-"));
cpSync(join(here, "branding/colorless-angular.png"), join(web, "source.png"));
cpSync(join(here, "logo_border.js"), join(web, "logo_border.js"));
cpSync(join(here, "logo_reflections.js"), join(web, "logo_reflections.js"));
cpSync(join(here, "logo_energy.js"), join(web, "logo_energy.js"));
writeFileSync(
  join(web, "index.html"),
  `<!doctype html><title>COLORLESS angular logo export</title>
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
  function encodeLayer(pixels) {
    const layer=document.createElement('canvas');layer.width=pixels.width;layer.height=pixels.height;
    layer.getContext('2d').putImageData(pixels,0,0);
    return layer.toDataURL('image/png').split(',')[1];
  }
  window.borderStats=rebuildBorder(ctx,{onLayers:layers=>{
    window.logoLayers={background:encodeLayer(layers.background),star:encodeLayer(layers.star),
      centerX:layers.centerX,centerY:layers.centerY};
  }});
  const url=canvas.toDataURL('image/png');window.logoPng=url.split(',')[1];
  const link=document.getElementById('download');link.href=url;link.hidden=false;
}
</script>`,
);
console.log(web);
