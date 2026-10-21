-- Port of update_canvas_juice (functions/common_events.lua), with the original
-- default screen-shake setting of 50. Coordinates here are logical pixels;
-- `unit` converts the source's tile displacement into the current layout.
local Room = {}
Room.__index = Room

function Room.new(w,h,unit)
  return setmetatable({w=w,h=h,unit=unit or 60,x=0,y=0,r=0,jiggle=0},Room)
end

function Room:update(dt,time,cursorX,cursorY,reduced,screenshake)
  screenshake=screenshake or 50
  local cursorWeight=reduced and 0 or math.max(0,screenshake-30)/100
  self.cursorX=self.cursorX or cursorX
  self.cursorY=self.cursorY or cursorY
  self.cursorX=self.cursorX*(1-3*dt)+3*dt*(cursorWeight*cursorX+(1-cursorWeight)*self.w/2)
  self.cursorY=self.cursorY*(1-3*dt)+3*dt*(cursorWeight*cursorY+(1-cursorWeight)*self.h/2)
  local shake=reduced and 0 or screenshake/100*3
  if shake<0.05 then shake=0 end
  self.jiggle=self.jiggle*(1-5*dt)*(shake>0.05 and 1 or 0)
  self.r=(0.001*math.sin(0.3*time)+0.002*self.jiggle*math.sin(39.913*time))*shake
  self.x=shake*(self.unit*0.015*math.sin(0.913*time)+self.unit*0.01*self.jiggle*shake*math.sin(19.913*time)+(self.cursorX-self.w/2)*0.01)
  self.y=shake*(self.unit*0.015*math.sin(0.952*time)+self.unit*0.01*self.jiggle*shake*math.sin(21.913*time)+(self.cursorY-self.h/2)*0.01)
end

-- Node:translate_container rotates around the room midpoint, then translates.
function Room:apply()
  love.graphics.translate(self.w/2,self.h/2)
  love.graphics.rotate(self.r)
  love.graphics.translate(-self.w/2+self.x,-self.h/2+self.y)
end

function Room:unproject(x,y)
  local c,s=math.cos(self.r),math.sin(self.r)
  x,y=x-self.w/2,y-self.h/2
  return c*x+s*y+self.w/2-self.x,-s*x+c*y+self.h/2-self.y
end

return Room
