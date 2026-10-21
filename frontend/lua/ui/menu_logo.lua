-- Two authored sprites keep the disc/lettering still while its star turns.
-- No startup shaders, Canvas readbacks or texture reconstruction.
local Logo={}
Logo.__index=Logo
local layout=require('ui.menu_logo_layout')
function Logo.new()
  local base=love.graphics.newImage('assets/branding/colorless-menu-base.png')
  local star=love.graphics.newImage('assets/branding/colorless-energy-star.png')
  base:setFilter('linear','linear');star:setFilter('linear','linear')
  local w,h=base:getDimensions()
  local sw,sh=star:getDimensions()
  return setmetatable({base=base,star=star,w=w,h=h,sw=sw,sh=sh,phase=0},Logo)
end
function Logo:getDimensions()
  return self.w,self.h
end
function Logo:update(dt,reduced)
  if not reduced then self.phase=(self.phase+dt)%60 end
end
function Logo:draw(scale)
  local g=love.graphics
  g.draw(self.base,0,0,0,scale,scale,self.w/2,self.h/2)
  g.draw(self.star,(layout.starX-self.w/2)*scale,(layout.starY-self.h/2)*scale,
    self.phase*math.pi*2/60,scale,scale,self.sw/2,self.sh/2)
end
return Logo
