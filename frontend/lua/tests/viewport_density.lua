-- The real main.lua at every device pixel ratio (audit BT6): the host sends the canvas's CSS size
-- and its device-pixel size, and Lua renders at the device size while everything that must look
-- the same keeps its CSS size: the layout, the CRT's scanline count and fringe, the notice's
-- smallest text. A pointer anywhere lands on the same control, and a table drag reaches the
-- simulator at the same board point, at 1, 1.25, 1.5, 2 and 3. One device pixel per CSS pixel
-- keeps SDL's own resizing, as before.
package.path='frontend/lua/?.lua;'..package.path
local noop=function() end
local function check(ok,message) if not ok then error(message,2) end end
local files={['__viewport.txt']='1280 800 0',['__page.txt']='1\thome\t'}
-- Just enough of Balatro's CRT.fs for main.lua's load-time patch to find what it changes.
files['assets/shaders/CRT.fs']=table.concat({
  'extern MY_HIGHP_OR_MEDIUMP number scanlines;',
  'crt_tex.r = Texel( tex, tc + vec2(0.0005*1600./love_ScreenSize.x, 0.)).r;',
  'crt_tex.g = Texel( tex, tc + vec2(-0.0005*1600./love_ScreenSize.x, 0.)).g;',
  'number mid_dist = screen_scale*length(vertex_position.xy/screen_scale - 0.5*love_ScreenSize.xy)/length(love_ScreenSize.xy);',
},'\n')
local image={release=noop,setFilter=noop,getDimensions=function() return 1850,800 end,getWidth=function() return 245 end,getHeight=function() return 337 end}
local sent,shaderCode={},nil
local function newShader(code)
  local shader={release=noop,hasUniform=function() return true end}
  if code==files['assets/shaders/CRT.fs'] or (code or ''):match('pixel_density') then
    shaderCode=code
    shader.send=function(_,key,value) sent[key]=value end
  else shader.send=noop end
  return shader
end
local canvases,modes={},{}
local limit
package.loaded['ui.menu_logo']={new=function() return {update=noop,draw=noop,getDimensions=function() return 1850,800 end} end}
local audio=setmetatable({isPlaying=function() return false end},{__index=function() return noop end})
local mouseX,mouseY,held=0,0,false
love={graphics=setmetatable({getDimensions=function() return 1280,800 end,
  newCanvas=function(w,h) canvases[#canvases+1]={w,h};return image end,
  newImage=function() return image end,newQuad=function() return {} end,newShader=newShader,
  getSystemLimits=function() return {texturesize=limit or 16384} end,
  transformPoint=function(x,y) return x,y end},{__index=function() return noop end}),
  math={random=math.random},window={setTitle=noop,setMode=function(w,h,flags) modes[#modes+1]={w=w,h=h,flags=flags} end},
  audio={newSource=function() return audio end},
  mouse={getSystemCursor=noop,setCursor=noop,getPosition=function() return mouseX,mouseY end,isDown=function() return held end},
  keyboard={isDown=function() return false end},
  filesystem={getInfo=function(name) return files[name] or name:match('sounds/') end,read=function(name) return files[name] end}}
local T=require('ui.theme');T.text=noop
local Button=require('ui.button')
local lit,noticeSize={},nil
Button.draw=function(b,active) lit[b.label]=active or nil end
Button.errorLine=function(_,size) noticeSize=size end
local scenes={}
for _,name in ipairs({'library','builder','sandbox','simulator','online'}) do
  package.loaded['ui.'..name]={new=function(callbacks)
    local s={callbacks=callbacks,cards={},hover=0}
    for _,method in ipairs({'open','offset','backgroundColours','keypressed','wheelmoved',
      'retarget','command','close','cancelInteractions','editBox','closeModal','layout','draw'}) do s[method]=noop end
    function s:offset() return 0 end
    function s:backgroundColours() return {T.blue,T.panel,T.panel} end
    function s:update(_,_,mx,my) self.mx,self.my=mx,my end
    function s:mousepressed(x,y) self.pressedAt={x,y} end
    function s:mousereleased(x,y) self.releasedAt={x,y} end
    scenes[name]=s;return s
  end}
end
local output=print
print=noop
dofile('frontend/lua/main.lua');love.load()
local function frame() love.update(1/60);lit={};love.draw() end
-- The viewport mailbox is read every quarter second.
local function view(text) files['__viewport.txt']=text;for _=1,20 do frame() end end
local function move(x,y) mouseX,mouseY=x,y;love.mousemoved(x,y,1,1);frame() end
local function litLabel() local label=next(lit);return label or '' end

-- What a CSS-pixel grid over home lights, the pointer at (x*sx, y*sy) device pixels as SDL maps
-- it. Reduced motion holds the room and the screen tilt still, so two layouts compare.
local function homeAt(w,h,sx,sy)
  local map={}
  for y=0,h,h/40 do for x=0,w,w/40 do
    move(x*sx,y*(sy or sx))
    map[#map+1]=litLabel()
  end end
  return map
end
local function sameMap(a,b,message)
  local differ=0
  for i=1,#a do if a[i]~=b[i] then differ=differ+1 end end
  check(differ==0,message..': '..differ..' of '..#a..' points light another control')
end
local lastMode=function() return modes[#modes] end

-- One device pixel per CSS pixel: as before, a resizable window at the CSS size, and a host that
-- sends no device size means the same.
view('1280 800 0')
check(lastMode()==nil or (lastMode().w==1280 and lastMode().h==800),'A CSS-size viewport keeps the boot window')
view('1000 700 0 1000 700')
check(lastMode().w==1000 and lastMode().h==700 and lastMode().flags.resizable==true,'DPR 1 sets a resizable window at the CSS size')
check(canvases[#canvases][1]==1000 and canvases[#canvases][2]==700,'The scene canvas is the CSS size at DPR 1')
check(sent.scanlines==700*0.75,'DPR 1 scanlines come from the height ('..tostring(sent.scanlines)..')')
check(sent.pixel_density==1,'The fringe is the original at DPR 1')
check(shaderCode and shaderCode:match('1600%.%*pixel_density/love_ScreenSize%.x') and shaderCode:match('love_ScreenSize%.xy/pixel_density%)'),
  'The CRT shader is patched to measure its fringe and centre in CSS pixels')

local cases={{1280,800},{390,844},{844,390}}
for _,size in ipairs(cases) do
  local w,h=size[1],size[2]
  view(w..' '..h..' 1 '..w..' '..h)
  local base=homeAt(w,h,1)
  local hits=0
  for _,label in ipairs(base) do if label~='' then hits=hits+1 end end
  check(hits>0,'Some grid points light a home control at '..w..'x'..h)
  for _,density in ipairs({1.25,1.5,2,3}) do
    local pw,ph=math.floor(w*density+0.5),math.floor(h*density+0.5)
    view(w..' '..h..' 1 '..pw..' '..ph)
    local mode=lastMode()
    check(mode.w==pw and mode.h==ph,('DPR %s renders at %dx%d, got %dx%d'):format(density,pw,ph,mode.w,mode.h))
    check(mode.flags.resizable==false,'A denser canvas is sized only by Lua: SDL would size a resizable one to its CSS size')
    check(canvases[#canvases][1]==pw and canvases[#canvases][2]==ph,'The scene canvas is the device size')
    -- On a layout drawn under 0.6 CSS px per layout px (844x390) they follow the layout (LC4).
    local layout=w/h<0.9 and math.min(w/480,h/850) or math.min(w/1280,h/800)
    local lines=h*0.75/(layout<0.6 and layout or 1)
    check(math.abs(sent.scanlines-lines)<1e-6,('Scanlines come from the CSS height at DPR %s (%s)'):format(density,tostring(sent.scanlines)))
    check(math.abs(sent.pixel_density-ph/h)<1e-9,'The CRT fringe is measured in CSS pixels')
    sameMap(base,homeAt(w,h,pw/w,ph/h),('%dx%d at DPR %s'):format(w,h,density))
  end
end

-- Browser zoom can change the ratio and the CSS size and leave the device size as it was.
view('2560 1600 1 2560 1600')
check(math.abs(sent.scanlines-1600*0.75)<1e-6,'2560x1600 CSS pixels at DPR 1')
view('1280 800 1 2560 1600')
check(math.abs(sent.scanlines-800*0.75)<1e-6 and sent.pixel_density==2,'Zoomed to 200%, the same device size lays out for DPR 2')
check(lastMode().flags.resizable==false,'and is sized by Lua')

-- The table: a press, a drag and a release reach the simulator at the same board points.
view('1280 800 1 1280 800')
files['__page.txt']='2\tsimulator\t';for _=1,240 do frame() end
local sim=scenes.simulator
local function drag(density)
  local points={}
  local function at(x,y) mouseX,mouseY=x*density,y*density;love.mousemoved(mouseX,mouseY,1,1) end
  at(612,688);love.mousepressed(612*density,688*density,1);held=true;frame()
  points[#points+1]=sim.pressedAt
  for step=1,4 do at(612-step*60,688-step*70);frame();points[#points+1]={sim.mx,sim.my} end
  love.mousereleased(372*density,408*density,1);held=false;frame()
  points[#points+1]=sim.releasedAt
  return points
end
local base=drag(1)
for _,density in ipairs({1.25,1.5,2,3}) do
  view(('1280 800 1 %d %d'):format(1280*density,800*density))
  local points=drag(density)
  for i,p in ipairs(points) do
    check(math.abs(p[1]-base[i][1])<1e-6 and math.abs(p[2]-base[i][2])<1e-6,
      ('Table point %d at DPR %s: %.4f,%.4f against %.4f,%.4f'):format(i,density,p[1],p[2],base[i][1],base[i][2]))
  end
end
files['__page.txt']='3\thome\t';for _=1,5 do frame() end

-- The page notice is never under 12 CSS pixels, at any ratio.
files['__notice.txt']='1\tOffline'
view('640 400 0 640 400')
local cssSize=noticeSize
check(cssSize and cssSize>16,'A small viewport enlarges the notice ('..tostring(cssSize)..')')
view('640 400 0 1280 800')
check(noticeSize==cssSize,'DPR 2 keeps the notice\'s size ('..tostring(noticeSize)..' against '..tostring(cssSize)..')')
files['__notice.txt']=nil

-- Wider than the GPU's largest texture: the largest device size that fits, at the same aspect.
limit=4096
view('2560 1440 0 5120 2880')
check(lastMode().w==4096 and lastMode().h==2304,('A 5120x2880 canvas renders at 4096x2304 on a 4096 GPU, got %dx%d'):format(lastMode().w,lastMode().h))
check(math.abs(sent.scanlines-1440*0.75)<1e-6,'and keeps its CSS scanline count')
print=output
print('PASS: device-pixel canvas at DPR 1.25-3 with CSS layout, scanlines, fringe and notice; pointer and table drag mapping exact; DPR 1 resizable; GPU texture limit')
