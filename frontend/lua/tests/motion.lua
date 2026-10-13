-- Differential check against the user's actual Balatro engine, not a second
-- transcription of the formulas. Run from the repository root with LuaJIT.
package.path='frontend/lua/?.lua;'..package.path
local Motion=require('ui.motion')
local source=os.getenv('BALATRO_SOURCE') or '../balatro-source'
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
    local moveDt=math.min(1/20,dt)
    G.exp_times={xy=math.exp(-50*dt),r=math.exp(-190*dt),scale=math.exp(-60*dt),max_vel=70*moveDt}
    expected:move_juice(moveDt)
    expected:move_xy(moveDt)
    expected:move_r(moveDt,expected.velocity)
    expected:move_scale(moveDt)
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
print('PASS: '..checks..' motion comparisons against Balatro, plus reduced motion')
