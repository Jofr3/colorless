-- Run the actual source particle/event code as the behavioral reference.
package.path='frontend/lua/?.lua;'..package.path
-- Without Balatro's source the timing/particle comparisons are skipped; the
-- coverage, reduced-motion and artwork checks below are app behaviour and run.
local source=require('tests.support.balatro_source').optional()
local noop=function()end
local image={setFilter=noop,getDimensions=function()return 1850,800 end,getWidth=function()return 245 end,getHeight=function()return 337 end,release=noop}
love={filesystem={getInfo=function()return nil end},math={random=math.random},graphics=setmetatable({
  newImage=function()return image end,newQuad=function()return {} end,
  newCanvas=function()return image end,transformPoint=function(x,y)return x,y end,
},{__index=function()return noop end})}
local Wipe=require('ui.screen_wipe')
local checks=0
local function near(a,b,epsilon)
  assert(math.abs(a-b)<(epsilon or 1e-8),tostring(a)..' != '..tostring(b));checks=checks+1
end
if source then
 local function read(path)local f=assert(io.open(source..path));local s=f:read('*a');f:close();return s end
 dofile(source..'/engine/object.lua')
 dofile(source..'/engine/event.lua')
 Moveable=Object:extend();Moveable.move=noop
 dofile(source..'/engine/particles.lua')
 local callbacks=read('/functions/button_callbacks.lua')
 G={FUNCS={}}
 local start=assert(callbacks:find('G.FUNCS.wipe_on =',1,true))
 assert(loadstring(callbacks:sub(start)))()
 HEX=function()return {1,1,1,1}end
 pseudorandom_element=function(t)return t[1]end
 local sourceParticle,trace
 Card=function()return {states={hover={}},juice_up=noop,
  flip=function()trace.flip=G.TIMERS.REAL end,
  start_dissolve=function(_,colours)trace.burn=G.TIMERS.REAL;trace.palette=colours end}end
 UIBox=function()return {children={},alignment={offset={}},get_UIE_by_ID=noop,
  remove=function()trace.removed=G.TIMERS.REAL end}end
 local RealParticles=Particles
 Particles=function(_,_,_,_,config)sourceParticle=config;return {remove=noop}end
 play_sound=noop
 delay=function(t)G.E_MANAGER:add_event(Event({trigger='after',delay=t}))end
 for _,fps in ipairs({30,60,120,144})do
  trace={}
  G.SETTINGS={paused=true};G.TIMERS={REAL=0,TOTAL=0};G.ARGS={};G.CONTROLLER={locks={}}
  G.C={BLACK=Wipe.palette[1],ORANGE=Wipe.palette[2],GOLD=Wipe.palette[3],RED=Wipe.palette[4],BACKGROUND={C={0.2,0.3,0.4,1}},CLEAR={0,0,0,0}}
  G.UIT={};G.P_CARDS={};G.P_CENTERS={};G.E_MANAGER=EventManager()
  G.FUNCS.wipe_on()
  G.E_MANAGER:add_event(Event({func=function()trace.swap=G.TIMERS.REAL;return true end}))
  G.FUNCS.wipe_off()
  near(sourceParticle.scale,40);near(sourceParticle.lifespan,Wipe.lifespan);near(sourceParticle.max,1)
  for frame=1,fps*3 do
   G.TIMERS.REAL=frame/fps;G.E_MANAGER:update(1/fps)
  end
  -- Queue processing can add a frame per blocking event, even when complete.
  near(trace.flip,0,1/30+1e-8)
  near(trace.swap,Wipe.coverTime,3/math.min(fps,60)+1e-8)
  near(trace.burn,Wipe.dissolveAt,6/math.min(fps,60)+1e-8)
  near(trace.removed,Wipe.removeAt,6/math.min(fps,60)+1e-8)
  for i=1,4 do assert(trace.palette[i]==Wipe.palette[i])end
  local calls,sounds=0,{}
  local wipe=Wipe.new(function()calls=calls+1 end,{0.2,0.3,0.4,1},false,function(name)sounds[#sounds+1]=name end)
  wipe:layout(1280,800,1280/22)
  local ref={scale=40,lifespan=sourceParticle.lifespan,timer_type='REAL',created_on_pause=true,
   particles={{age=0,e_curr=0,scale=0,offset={x=0,y=0},velocity=0,dir=0,facing=wipe.facing,r_vel=wipe.rotationVelocity}}}
  local done=false
  for frame=1,math.ceil(fps*Wipe.removeAt)do
   RealParticles.move(ref,1/fps)
   done=wipe:update(1/fps)
   if ref.particles[1]then near(wipe:scale(),ref.particles[1].scale);near(wipe.facing,ref.particles[1].facing)end
   if wipe.age<Wipe.coverTime then assert(calls==0)else assert(calls==1)end
   if wipe.burn then near(wipe.card.dissolve,math.min(1,(wipe.age-Wipe.dissolveAt)/0.7))end
  end
  if not done then done=wipe:update(1/fps)end
  assert(done and calls==1 and #sounds==3)
  wipe:release()
 end
end
-- Every viewport corner must be covered at the mutation frame, at every
-- random square angle, including portrait and letterboxed ultra-wide views.
for _,size in ipairs({{1280,800},{480,850},{3000,700}})do
 local w,h=unpack(size);local unit=math.min(w/22,h/12.9)
 local wipe=Wipe.new(noop,{1,1,1,1},false)
 wipe:layout(w,h,unit);wipe.age=Wipe.coverTime
 for angle=0,6.28,0.1 do
  for _,x in ipairs({-w/2,w/2})do for _,y in ipairs({-h/2,h/2})do
   local a,b=math.cos(angle)*x-math.sin(angle)*y,math.sin(angle)*x+math.cos(angle)*y
   assert(math.max(math.abs(a),math.abs(b))<wipe:scale()*unit/2)
  end end
 end
 wipe:layout(h,w,unit);near(wipe.age,Wipe.coverTime);wipe:release()
end
local calls=0
local reduced=Wipe.new(function()calls=calls+1 end,{},true,function()error('Reduced motion must be silent')end)
reduced:layout(480,850,30);assert(not reduced.card)
assert(reduced:update(1/60) and calls==1);reduced:update(1/60);assert(calls==1)
-- A first visit's wipe can start before the host has written any transition scan: it neither
-- errors nor waits, and the card burns face down. LÖVE's newImage throws for a file that is
-- not there.
local stubImage=love.graphics.newImage
love.graphics.newImage=function(path)
  if path~='assets/textures/2x/Enhancers.png' then error('Could not open file '..path..'. Does not exist.') end
  return stubImage(path)
end
local cold=Wipe.new(noop,{1,1,1,1},false)
cold:layout(1280,800,60)
assert(cold.card and not cold.art and not cold.face,'A wipe with no artwork yet shows the card back')
for _=1,math.ceil(60*Wipe.removeAt)+1 do cold:update(1/60) end
assert(not cold.front,'Without artwork the card never turns face up')
cold:layout(480,850,30);cold:release()
-- A staged scan that will not decode is reported, and when the fallback scan will not decode
-- either the card stays face down too.
local output=print
local said={}
love.filesystem={getInfo=function(path)return path=='__transition_art.txt' or path=='broken.png'
  or path=='assets/transition_cards/sv01-030.png' end,
  read=function()return '9\tbroken\tbroken.png' end}
print=function(message) said[#said+1]=message end
local broken=Wipe.new(noop,{1,1,1,1},false)
broken:layout(1280,800,60)
print=output
assert(said[1]=='COLORLESS:transition-art:invalid\t9' and #said==1,'A scan that will not decode is reported')
assert(broken.card and not broken.art and not broken.face)
for _=1,30 do broken:update(1/60) end
assert(not broken.front);broken:release()
love.filesystem={getInfo=function()return nil end}
love.graphics.newImage=stubImage
-- A selected cache file may be evicted during the covered scene swap.
-- The image must survive both the flip and subsequent viewport changes.
local exists,loads=true,0
love.filesystem={getInfo=function(path)return path=='__art.txt' or (path=='cached.png' and exists)end,
  read=function()return '2\ncached-card\tcached.png' end}
love.image={newImageData=function()error('No pixels in this stub')end}
local originalImage=love.graphics.newImage
love.graphics.newImage=function(path)
  if path=='cached.png' then assert(exists);loads=loads+1 end
  return originalImage(path)
end
local cached=Wipe.new(noop,{1,1,1,1},false)
cached:layout(1280,800,60)
assert(cached.art.id=='cached-card' and loads==1)
exists=false
for _=1,20 do cached:update(1/60)end
cached:layout(480,850,30)
assert(cached.front and cached.art.id=='cached-card' and loads==1,'Resize and flip must reuse retained artwork')
cached:release()
-- Acknowledge persistent art only after both the image and border load.
local consumed=false
love.filesystem={getInfo=function(path)return path=='__transition_art.txt' or (path=='prepared.png' and not consumed)end,
  read=function()return '7\tpersistent\tprepared.png' end}
print=function(message)
  assert(message=='COLORLESS:transition-art:used\t7')
  consumed=true
end
local prepared=Wipe.new(noop,{1,1,1,1},false)
prepared:layout(1280,800,60)
assert(consumed and prepared.art.id=='persistent')
for _=1,20 do prepared:update(1/60)end
prepared:layout(480,850,30);prepared:release()
print=output
print('PASS: '..(source and checks..' source screen-wipe timing/particle comparisons, ' or '')
 ..'coverage, resize, reduced motion and the face-down wipe without artwork'
 ..(source and '' or ' (source comparisons skipped: no Balatro source)'))
