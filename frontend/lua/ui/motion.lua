-- Balatro's Moveable motion, kept in game/tile units. T is the target transform;
-- VT is the visible transform. These are deliberately separate while dragging.
-- Equations and update order: engine/moveable.lua and game.lua (LÖVE 11.4).
local Motion = {}
Motion.__index = Motion

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

function Motion:update(realDt, time, hovered, dragging, reduced)
  if reduced then
    self.juice=nil
    self.VT.x,self.VT.y,self.VT.r = self.T.x,self.T.y,self.T.r
    self.VT.scale = self.T.scale+(hovered and 0.05 or 0)+(dragging and 0.1 or 0)
    self.velocity = {x=0,y=0,r=0,scale=0}
    return
  end
  if realDt<=0 then return end
  local dt = math.min(1/20,realDt)
  self:move_juice(time)
  self:move_xy(dt,math.exp(-50*realDt))
  self:move_r(dt,math.exp(-190*realDt))
  self:move_scale(math.exp(-60*realDt),hovered,dragging)
end
return Motion
