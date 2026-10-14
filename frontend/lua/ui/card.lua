local T = require('ui.theme')
local Motion = require('ui.motion')
local Card = {}
Card.__index = Card
local g = love.graphics
local W,H = 142,190
local CARD_W,CARD_H = 2.4*35/41,2.4*47/41

local function emblem(kind,colour)
  g.setColor(colour)
  if kind == 1 then
    -- A pixel-cut lightning energy symbol.
    g.polygon('fill',79,48,48,101,68,101,59,142,100,84,77,84,87,48)
  elseif kind == 2 then
    for i=0,3 do
      g.rectangle('fill',44+i*13,65+(i%2)*13,10,10)
      g.rectangle('fill',44+i*13,104+(i%2)*13,10,10)
    end
    g.rectangle('fill',57,78,23,23)
    g.rectangle('fill',83,91,10,10)
  elseif kind == 3 then
    g.push(); g.translate(71,96)
    for _,r in ipairs({-0.72,0.72}) do
      g.push(); g.rotate(r)
      g.polygon('fill',-5,-40,0,-47,5,-40,5,15,-5,15)
      g.rectangle('fill',-15,12,30,7)
      g.rectangle('fill',-4,18,8,18)
      g.pop()
    end
    g.pop()
  else
    for i=2,0,-1 do
      T.box(43+i*6,58+i*6,48,67,colour,4)
      T.box(47+i*6,62+i*6,40,59,T.paper,3)
    end
    g.setColor(colour); g.polygon('fill',67,78,79,96,67,114,55,96)
  end
end

function Card.new(item,index)
  local self = setmetatable({item=item,index=index,x=0,y=0,homeX=0,homeY=0,angle=0,scale=1,hovered=false,ambientTilt=0.2},Card)
  self:rebuild()
  return self
end
function Card:rebuild()
  local item,index=self.item,self.index
  if self.texture then self.texture:release() end
  local resolution=item.resolution or 1
  self.texture = g.newCanvas(W*resolution,H*resolution)
  g.setCanvas(self.texture); g.clear(); g.push(); g.scale(resolution)
  if item.drawFace then
    item.drawFace(W,H)
  else
  T.box(0,0,W,H,T.ink,5)
  T.box(2,2,W-4,H-4,T.paper,4)
  T.box(7,7,W-14,H-14,item.colour,3)
  T.box(9,9,W-18,H-18,T.paper,3)
  g.setFont(T.font(22)); g.setColor(item.colour)
  g.print(index,14,10)
  g.push(); g.translate(W-14,H-10); g.rotate(math.pi); g.print(index,0,0); g.pop()
  -- Fine pixel stipple keeps these new faces in the original atlas vocabulary.
  g.setColor(item.colour[1],item.colour[2],item.colour[3],0.12)
  for x=23,120,8 do for y=37,148,8 do g.rectangle('fill',x,y,2,2) end end
  emblem(index,item.colour)
  T.box(18,153,106,26,item.colour,3)
  T.text(item.label,24,18,152,106)
  end
  g.pop(); g.setCanvas()
  self.texture:setFilter('nearest','nearest')
end
-- Match the source card dimensions in tile units, independent of viewport/DPI.
function Card:place(x,y,baseScale,entering)
  self.homeX,self.homeY,self.baseScale = x,y,baseScale
  self.unit = W*baseScale/CARD_W
  self.motion = Motion.new(x/self.unit,y/self.unit,(self.index-2.5)*0.035)
  if entering then self.motion.VT.y=self.motion.VT.y+90/self.unit end
  self.x,self.y = self.motion.VT.x*self.unit,self.motion.VT.y*self.unit
end

function Card:hit(x,y)
  local dx,dy=x-self.x,y-self.y
  -- Node:collides_with_point uses the visible rectangle without zoom, adds
  -- 0.05 tiles of hover hysteresis, and ignores rotations smaller than 0.1.
  if math.abs(self.angle)>=0.1 then
    local c,s=math.cos(self.angle),math.sin(self.angle)
    dx,dy=c*dx+s*dy,-s*dx+c*dy
  end
  local buffer=self.hovered and 0.05*self.unit or 0
  return math.abs(dx)<=CARD_W*self.unit/2+buffer and math.abs(dy)<=CARD_H*self.unit/2+buffer
end

-- Card:juice_up converts its arguments before calling Moveable:juice_up.
function Card:juiceUp(time,scale,rotation,reduced)
  local sign=love.math.random()>0.5 and 1 or -1
  self.motion:juice_up(time,scale and scale*0.4 or 0.11,
    sign*(rotation and 0.4*rotation or 0.16),reduced)
end

function Card:update(dt,time,active,reduced)
  self.hovered=active
  local m=self.motion
  m.T.x=(self.dragging and self.targetX or self.homeX)/self.unit
  m.T.y=(self.dragging and self.targetY or self.homeY)/self.unit
  m:update(dt,time,active,self.dragging,reduced)
  self.x,self.y,self.angle=m.VT.x*self.unit,m.VT.y*self.unit,m.VT.r
end

function Card:shaderValues(time,mx,my,reduced)
  local tiltX,tiltY,tiltAmount
  if self.hovered then
    tiltX,tiltY=mx,my
    -- Node:set_offset measures from the target top-left in TILE units, not UVs.
    local hx=mx/self.unit-(self.motion.T.x-CARD_W/2)
    local hy=my/self.unit-(self.motion.T.y-CARD_H/2)
    tiltAmount=math.abs(hx+hy-1)*0.3
  else
    -- Card:draw keeps the vertex deformation enabled when idle and moves a
    -- synthetic cursor around the centre. It does not rotate the whole card.
    local a=time*(1.56+(self.index/1.14212)%1)+self.index/1.35122
    tiltX=self.x+0.5*self.ambientTilt*math.cos(a)*CARD_W*self.unit
    tiltY=self.y+0.5*self.ambientTilt*math.sin(a)*CARD_H*self.unit
    tiltAmount=self.ambientTilt*(0.5+math.cos(a))*0.3
  end
  -- LÖVE batches transformed texture vertices in framebuffer pixels. Send the
  -- cursor and tile size through the SAME transform, including letterboxing.
  local px,py=g.transformPoint(tiltX,tiltY)
  local ox,oy=g.transformPoint(0,0)
  local ux,uy=g.transformPoint(self.unit,0)
  local j=self.motion.juice
  local phase=math.min(self.angle*3,1)+time/28+(j and j.r*20 or 0)+tiltAmount
  return {
    dissolve=0, time=(123.33412*(self.index/1.14212))%3000,
    texture_details={0,0,W*(self.item.resolution or 1),H*(self.item.resolution or 1)},image_details={W*(self.item.resolution or 1),H*(self.item.resolution or 1)},shadow=false,
    burn_colour_1={1,1,1,0},burn_colour_2={1,1,1,0},
    mouse_screen_pos={px,py},hovering=reduced and 0 or 1,
    screen_scale=math.sqrt((ux-ox)^2+(uy-oy)^2),
  },{phase,time}
end

local function send(shader,values)
  for key,value in pairs(values) do
    if shader:hasUniform(key) then shader:send(key,value) end
  end
end

function Card:draw(shaders,time,mx,my,reduced,roomWidth)
  local values,edition=self:shaderValues(time,mx,my,reduced)
  local scale=self.motion.VT.scale
  local resolution=self.item.resolution or 1
  local sx,sy=CARD_W*self.unit/W*scale/resolution,CARD_H*self.unit/H*scale/resolution
  local dissolve=shaders.dissolve
  -- Sprite:draw_shader's shadow pass is un-tilted, scaled down, and projected
  -- away from the room centre. Dragging raises it from 0.1 to 0.35 tile units.
  local shadowHeight=self.dragging and 0.35 or 0.1
  local parallax=(self.motion.T.x*self.unit-roomWidth/2)/(roomWidth/2)*1.5
  values.shadow=true; values.hovering=0
  send(dissolve,values)
  g.setShader(dissolve); g.setColor(1,1,1,1)
  g.draw(self.texture,self.x-parallax*shadowHeight*self.unit,
    self.y+1.5*shadowHeight*self.unit,self.angle,
    sx*(1-0.2*shadowHeight),sy*(1-0.2*shadowHeight),W*resolution/2,H*resolution/2)

  values.shadow=false; values.hovering=reduced and 0 or 1
  send(dissolve,values)
  g.setShader(dissolve); g.setColor(1,1,1,1)
  g.draw(self.texture,self.x,self.y,self.angle,sx,sy,W*resolution/2,H*resolution/2)
  -- Balatro draws every edition ON TOP of the ordinary card, with identical
  -- geometry; foil's partially transparent pass must never have its own tilt.
  if self.item.edition~='dissolve' then
    local shader=shaders[self.item.edition]
    values[self.item.edition]=edition
    send(shader,values); g.setShader(shader)
    g.draw(self.texture,self.x,self.y,self.angle,sx,sy,W*resolution/2,H*resolution/2)
  end
  g.setShader()
end
return Card
