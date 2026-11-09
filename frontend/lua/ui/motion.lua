-- Balatro's Moveable motion, kept in game/tile units. T is the target transform;
-- VT is the visible transform. These are deliberately separate while dragging.
-- Equations and update order: engine/moveable.lua and game.lua (LÖVE 11.4).
local Motion = {}
Motion.__index = Motion
-- The longest step the springs take. Stable well past 1/60 s, and long enough that a 60 Hz frame
-- running a little late is still one step. main.lua caps a frame's dt at 0.1 s: five steps.
local MAX_STEP = 1/50

function Motion.new(x, y, rotation)
  return setmetatable({
    T = {x=x, y=y, r=rotation or 0, scale=1},
    VT = {x=x, y=y, r=rotation or 0, scale=1},
    velocity = {x=0, y=0, r=0, scale=0},
  }, Motion)
end

function Motion:juice_up(time, amount, rotation, reduced)
  if reduced then return end
  self.juice = {
    scale=0, r=0, scale_amt=amount, r_amt=rotation,
    start_time=time, end_time=time+0.4,
  }
  self.VT.scale = 1-0.6*amount
end

function Motion:move_juice(time)
  local j = self.juice
  if not j then return end
  if j.end_time < time then self.juice=nil; return end
  local remaining = math.max(0, (j.end_time-time)/(j.end_time-j.start_time))
  j.scale = j.scale_amt*math.sin(50.8*(time-j.start_time))*remaining^3
  j.r = j.r_amt*math.sin(40.8*(time-j.start_time))*remaining^2
end

function Motion:move_xy(dt, damping)
  local t,v,velocity = self.T,self.VT,self.velocity
  if t.x~=v.x or math.abs(velocity.x)>0.01 or t.y~=v.y or math.abs(velocity.y)>0.01 then
    velocity.x = damping*velocity.x+(1-damping)*(t.x-v.x)*35*dt
    velocity.y = damping*velocity.y+(1-damping)*(t.y-v.y)*35*dt
    local maxVelocity = 70*dt
    if velocity.x^2+velocity.y^2 > maxVelocity^2 then
      local speed = math.sqrt(velocity.x^2+velocity.y^2)
      velocity.x,velocity.y = maxVelocity*velocity.x/speed,maxVelocity*velocity.y/speed
    end
    v.x,v.y = v.x+velocity.x,v.y+velocity.y
    if math.abs(v.x-t.x)<0.01 and math.abs(velocity.x)<0.01 then v.x=t.x; velocity.x=0 end
    if math.abs(v.y-t.y)<0.01 and math.abs(velocity.y)<0.01 then v.y=t.y; velocity.y=0 end
  end
end

function Motion:move_r(dt, damping)
  local desired = self.T.r+0.015*self.velocity.x/dt+(self.juice and self.juice.r*2 or 0)
  if desired~=self.VT.r or math.abs(self.velocity.r)>0.001 then
    self.velocity.r = damping*self.velocity.r+(1-damping)*(desired-self.VT.r)
    self.VT.r = self.VT.r+self.velocity.r
  end
  if math.abs(self.VT.r-self.T.r)<0.001 and math.abs(self.velocity.r)<0.001 then
    self.VT.r=self.T.r; self.velocity.r=0
  end
end

function Motion:move_scale(damping, hovered, dragging)
  local desired = self.T.scale+(dragging and 0.1 or 0)+(hovered and 0.05 or 0)
    +(self.juice and self.juice.scale or 0)
  if desired~=self.VT.scale or math.abs(self.velocity.scale)>0.001 then
    self.velocity.scale = damping*self.velocity.scale+(1-damping)*(desired-self.VT.scale)
    self.VT.scale = self.VT.scale+self.velocity.scale
  end
end

-- True when nothing is moving: no juice, the visible transform on its target and no velocity.
-- Scale counts only its velocity, as hover and drag hold it off the target on purpose.
function Motion:still()
  local t,v,velocity = self.T,self.VT,self.velocity
  return not self.juice and v.x==t.x and v.y==t.y and v.r==t.r
    and velocity.x==0 and velocity.y==0 and velocity.r==0 and velocity.scale==0
end

function Motion:update(realDt, time, hovered, dragging, reduced)
  if reduced then
    self.juice=nil
    self.VT.x,self.VT.y,self.VT.r = self.T.x,self.T.y,self.T.r
    self.VT.scale = self.T.scale+(hovered and 0.05 or 0)+(dragging and 0.1 or 0)
    local velocity = self.velocity
    velocity.x,velocity.y,velocity.r,velocity.scale = 0,0,0,0
    return
  end
  if realDt<=0 then return end
  self:move_juice(time)
  -- The springs are explicit steps that overshoot and ring at the 0.1 s a slow frame can hand them
  -- (a button rang about 30 px around its place for a second while the card index parsed, moving
  -- out from under a tap), so a longer frame runs as equal substeps of at most MAX_STEP. At 50
  -- frames a second or faster that is one step, as before.
  local steps = math.ceil(realDt/MAX_STEP-1e-9)
  local step = realDt/steps
  local dt = math.min(1/20,step)
  for _=1,steps do
    self:move_xy(dt,math.exp(-50*step))
    self:move_r(dt,math.exp(-190*step))
    self:move_scale(math.exp(-60*step),hovered,dragging)
  end
end
return Motion
