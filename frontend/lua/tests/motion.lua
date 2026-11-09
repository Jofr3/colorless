-- Differential check against the user's actual Balatro engine, not a second
-- transcription of the formulas. Run from the repository root with LuaJIT.
package.path='frontend/lua/?.lua;'..package.path
local Motion=require('ui.motion')
local source=require('tests.support.balatro_source').required()
Node={extend=function() return {} end}
dofile(source..'/engine/moveable.lua')
local sourceMoveable=Moveable
local checks=0
local function near(actual,expected,label)
  assert(math.abs(actual-expected)<1e-10,label..': '..actual..' != '..expected)
  checks=checks+1
end
local function reference(x,y,r)
  return setmetatable({T={x=x,y=y,r=r,scale=1},VT={x=x,y=y,r=r,scale=1},
    velocity={x=0,y=0,r=0,scale=0},zoom=true,
    states={drag={is=false},hover={is=false}}},{__index=sourceMoveable})
end
for _,dt in ipairs({1/30,1/60,1/120,1/144,0.09}) do
  G={SETTINGS={reduced_motion=false},TIMERS={REAL=0},exp_times={}}
  local actual,expected=Motion.new(2,3,-0.05),reference(2,3,-0.05)
  for frame=1,240 do
    local time=frame*dt
    G.TIMERS.REAL=time
    local hover=frame>=20 and frame<120 and not (frame>=60 and frame<80)
    local drag=frame>=60 and frame<100
    expected.states.hover.is=hover; expected.states.drag.is=drag
    if frame==20 then
      actual:juice_up(time,0.02,0.012,false)
      expected:juice_up(0.02,0.012)
    end
    if frame==60 then
      actual.T.x,actual.T.y=11,5
      expected.T.x,expected.T.y=11,5
    elseif frame==100 then
      actual.T.x,actual.T.y=2,3
      expected.T.x,expected.T.y=2,3
    elseif frame==150 then
      actual:juice_up(time,0.11,-0.16,false)
      expected:juice_up(0.11,-0.16)
    end
    actual:update(dt,time,hover,drag,false)
    -- A frame longer than 1/50 s runs Balatro's step as equal substeps (ui/motion.lua MAX_STEP),
    -- so the reference takes the same substeps; 1/60 s and faster is one step, Balatro's own.
    local steps=math.ceil(dt/(1/50)-1e-9)
    local step=dt/steps
    local moveDt=math.min(1/20,step)
    G.exp_times={xy=math.exp(-50*step),r=math.exp(-190*step),scale=math.exp(-60*step),max_vel=70*moveDt}
    expected:move_juice(moveDt)
    for _=1,steps do
      expected:move_xy(moveDt)
      expected:move_r(moveDt,expected.velocity)
      expected:move_scale(moveDt)
    end
    for _,key in ipairs({'x','y','r','scale'}) do
      near(actual.VT[key],expected.VT[key],'VT.'..key)
      near(actual.velocity[key],expected.velocity[key],'velocity.'..key)
    end
  end
end
local reduced=Motion.new(0,0,0)
reduced.T.x=9
reduced:juice_up(0,0.1,0.1,true)
reduced:update(1/60,1,true,false,true)
near(reduced.VT.x,9,'reduced motion position')
near(reduced.VT.scale,1.05,'reduced motion hover scale')
assert(reduced.juice==nil)
-- A slow frame does not make a spring ring. A dialog sliding in from 10 tiles away overshoots by
-- 0.35 tiles at 60 fps, crosses its place twice and settles by 0.25 s. At main.lua's longest frame
-- (0.1 s) one step crossed it 13 times and settled only after 1 s, moving a button out from under
-- a tap while the card index parsed. Substeps keep every frame length to the 60 fps path.
for _,dt in ipairs({1/60,1/30,0.1}) do
  local m=Motion.new(0,10,0);m.T.y=0
  local worst,crossings,last=0,0,10
  for frame=1,math.ceil(1/dt) do
    m:update(dt,frame*dt,false,false,false)
    worst=math.min(worst,m.VT.y)
    if (last>0)~=(m.VT.y>0) and m.VT.y~=0 then crossings=crossings+1 end
    last=m.VT.y
    if frame*dt>=0.5 then assert(math.abs(m.VT.y)<0.05,'Settled by 0.5 s at dt '..dt..': '..m.VT.y) end
  end
  assert(worst>-0.4,'Overshoot under 0.4 tiles at dt '..dt..': '..worst)
  assert(crossings<=2,'No ringing at dt '..dt..': '..crossings..' crossings')
  checks=checks+1
end
print('PASS: '..checks..' motion comparisons against Balatro, plus reduced motion')
