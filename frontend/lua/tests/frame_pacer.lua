-- The frame pacer (ui/frame_pacer.lua) caps update and draw at 60 or 144 a second on any
-- display: a display at the cap runs every frame through jitter, a faster one is held to the cap
-- without bursts, and a stall is not paid back. Motion stays dt-based under it (audit LC11):
-- a 60 fps update on a 144 Hz display moves a card like a steady 60 Hz one.
package.path='frontend/lua/?.lua;'..package.path
local Pacer=require('ui.frame_pacer')
local Motion=require('ui.motion')
local function check(ok,message) if not ok then error(message,2) end end

-- Animation frames at `hz` for `seconds`, each frame's clock reading up to `jitter` seconds
-- early or late (a fixed pseudo-random sequence). Returns runs per second and the longest and
-- shortest gap between runs, in display frames.
local function run(hz,cap,seconds,jitter)
  local pacer=Pacer.new()
  local seed,runs,gap,longest,shortest,previous=7,0,0,0,math.huge,0
  for frame=1,math.floor(hz*seconds) do
    seed=(seed*1103515245+12345)%2147483648
    local clock=frame/hz+(seed/2147483648-0.5)*2*(jitter or 0)
    gap=gap+1
    if pacer:due(clock-previous,cap) then
      runs=runs+1
      if frame>1 then longest=math.max(longest,gap);shortest=math.min(shortest,gap) end
      gap=0
    end
    previous=clock
  end
  return runs/seconds,longest,shortest
end
for _,case in ipairs({{60,60},{59.94,60},{60.05,60},{144,144},{30,60},{30,144},{60,144},{120,144},{119.88,144}}) do
  local hz,cap=case[1],case[2]
  local fps,longest=run(hz,cap,20,0.001)
  check(longest==1,('A %g Hz display under a %d cap runs every frame (longest gap %d)'):format(hz,cap,longest))
  check(math.abs(fps-hz)<0.1,('A %g Hz display under a %d cap runs %g a second'):format(hz,cap,fps))
end
-- Faster displays: {Hz, cap, shortest and longest gap between runs in display frames}.
for _,case in ipairs({{120,60,2,2},{119.88,60,2,2},{144,60,2,3},{165,60,2,4},{240,60,4,4},{240,144,1,3},{165,144,1,2},{75,60,1,2}}) do
  local hz,cap,low,high=case[1],case[2],case[3],case[4]
  local fps,longest,shortest=run(hz,cap,20,0.001)
  check(fps<=cap*1.02 and fps>=cap*(hz>cap*1.5 and 0.97 or 0.95),
    ('A %g Hz display under a %d cap runs about the cap (%g a second)'):format(hz,cap,fps))
  check(shortest>=low and longest<=high,('Runs come every %d-%d frames at %g Hz, cap %d (%d-%d)'):format(low,high,hz,cap,shortest,longest))
end
-- A real panel's frames come at a steady beat, without the jitter above that breaks up a run of
-- every-frame draws: a 165 or 170 Hz panel under the 144 cap, or a 72 or 75 Hz one under 60, is
-- held to about the cap too.
for _,case in ipairs({{165,144},{170,144},{75,60},{72,60}}) do
  local hz,cap=case[1],case[2]
  local fps=run(hz,cap,20,0)
  check(fps<=cap*1.02,('A steady %g Hz display under a %d cap runs about the cap (%g a second)'):format(hz,cap,fps))
end
-- A 144 Hz display under the 60 cap runs 60 a second, not 72 (every other frame) nor 48 (every
-- third).
local fps=run(144,60,20,0.001)
check(math.abs(fps-60)<0.5,('144 Hz under the 60 cap runs 60 a second (%g)'):format(fps))
-- After a half-second stall the next frame runs once, and the frames after it keep the cap.
do
  local pacer=Pacer.new()
  for _=1,144 do pacer:due(1/144,60) end
  check(pacer:due(0.5,60),'The frame after a stall runs')
  local runs=0
  for _=1,144 do if pacer:due(1/144,60) then runs=runs+1 end end
  check(runs>=59 and runs<=61,('The second after a stall runs at the cap, not a catch-up burst (%d)'):format(runs))
end

-- LC11: main.lua's smoothed dt (smoothedDt) feeds Motion the time since the last run frame. A
-- card moved and juiced under a 60 fps update on a 144 Hz display follows a steady 60 Hz
-- update's path within a few hundredths of a tile and settles at the same place.
local function trace(hz,cap)
  local pacer,motion=Pacer.new(),Motion.new(2,3,0)
  local clock,previous,last,smoothed,time=0,0,0,1/100,12
  local samples,moved={},nil
  local seed,frame=3,0
  while clock<3 do
    frame=frame+1
    seed=(seed*1103515245+12345)%2147483648
    clock=frame/hz+(seed/2147483648-0.5)*0.002
    if pacer:due(clock-previous,cap) then
      smoothed=math.min(0.8*smoothed+0.2*(clock-last),0.1);last=clock
      time=time+smoothed
      -- The card is sent off on the first update after 0.5 s; times count from there.
      if clock>=0.5 and not moved then moved=clock;motion.T.x,motion.T.y=11,5;motion:juice_up(time,0.11,-0.16,false) end
      local since=moved and clock-moved
      motion:update(smoothed,time,since and since>0.5 and since<0.9,false,false)
      if moved then samples[#samples+1]={since,motion.VT.x,motion.VT.y,motion.VT.r,motion.VT.scale} end
    end
    previous=clock
  end
  return samples
end
-- The trace's position `t` seconds after the move, interpolated between the updates around it.
local function at(samples,t)
  for i=2,#samples do
    local a,b=samples[i-1],samples[i]
    if b[1]>=t then
      local f=(t-a[1])/(b[1]-a[1])
      local out={t}
      for k=2,5 do out[k]=a[k]+(b[k]-a[k])*f end
      return out
    end
  end
  return samples[#samples]
end
local function apart(a,b)
  local worst=0
  for t=0.02,2.3,0.01 do
    local p,q=at(a,t),at(b,t)
    for k=2,3 do worst=math.max(worst,math.abs(p[k]-q[k])) end
  end
  return worst
end
local steady,fast,paced=trace(60,60),trace(144,144),trace(144,60)
check(#paced>=148 and #paced<=152,('The 144 Hz trace updates 60 a second (%d updates in 2.5 s)'):format(#paced))
-- How far a steady 144 Hz update already strays from a steady 60 Hz one: the dt-based motion's
-- own step-size error, which motion.lua's 30-144 fps comparisons accept.
local worst,baseline=apart(steady,paced),apart(steady,fast)
check(worst<=math.max(0.05,baseline),('The paced card follows the 60 Hz one (worst %.3f tiles, 144 Hz strays %.3f)'):format(worst,baseline))
local a,b=steady[#steady],paced[#paced]
for k=2,5 do check(math.abs(a[k]-b[k])<1e-6,'Both settle at the same place') end
check(math.abs(b[2]-11)<1e-6 and math.abs(b[3]-5)<1e-6,'The paced card reaches its target')
print(('PASS: frame pacer caps at 60/144 on 30-240 Hz displays; paced motion within %.3f tiles of 60 Hz (144 Hz: %.3f)'):format(worst,baseline))
