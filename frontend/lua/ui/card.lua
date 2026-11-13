local T = require('ui.theme')
local Motion = require('ui.motion')
local D = require('ui.card_dimensions')
local Card = {}
Card.__index = Card
local g = love.graphics
local W,H = D.W,D.H
local CARD_W,CARD_H = D.TILE_W,D.TILE_H
local NO_BURN,WHITE = {1,1,1,0},{1,1,1,1}

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

-- `painted`: a card whose canvas already shows this item's face, adopted as is.
function Card.new(item,index,class,painted)
  local self = setmetatable({item=item,index=index,x=0,y=0,homeX=0,homeY=0,angle=0,scale=1,hovered=false,ambientTilt=0.2},class or Card)
  if painted then self.texture,self.resolution=painted.texture,painted.resolution else self:rebuild() end
  return self
end
-- The face raster of an item that draws a scan (item.scan): main.lua sets it from Card Quality.
Card.quality=D.QUALITIES[1]
-- The scan raster's size in pixels: what host.js resizes each scan to.
function Card.scanSize()
  local resolution=Card.quality.resolution
  return math.floor(W*resolution+0.5),math.floor(H*resolution+0.5)
end
-- Canvas size and filter. Native rasters copy drawFace's texels unscaled.
function Card:raster()
  if not self.item.scan then return W,H,'nearest',false end
  local w,h=Card.scanSize()
  return w,h,Card.quality.filter,false
end
function Card:rebuild()
  local item,index=self.item,self.index
  if self.texture then self.texture:release() end
  local tw,th,filter,native=self:raster()
  self.texture = g.newCanvas(tw,th)
  -- What draw divides by: the canvas's texels per face unit, as built.
  self.resolution=native and 1 or tw/W
  g.setCanvas(self.texture); g.clear(); g.push()
  if native then
    -- 'replace' keeps the RGB of transparent texels for linear filtering.
    local mode,alpha=g.getBlendMode()
    g.setBlendMode('replace','premultiplied')
    item.drawFace(tw,th)
    g.setBlendMode(mode,alpha)
  elseif item.drawFace then
    g.scale(tw/W)
    item.drawFace(W,H)
  else
  g.scale(tw/W)
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
  self.texture:setFilter(filter,filter)
end
-- Shared card geometry in tile units, independent of viewport/DPI.
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

-- Half the width and height of the box the card covers now, rotation and zoom included.
function Card:halfExtents()
  local scale=self.motion and self.motion.VT.scale or 1
  local w,h=CARD_W*self.unit/2*scale,CARD_H*self.unit/2*scale
  local c,s=math.abs(math.cos(self.angle)),math.abs(math.sin(self.angle))
  return w*c+h*s,w*s+h*c
end

-- Card:juice_up converts its arguments before calling Moveable:juice_up.
function Card:juiceUp(time,scale,rotation,reduced)
  local sign=love.math.random()>0.5 and 1 or -1
  self.motion:juice_up(time,scale and scale*0.4 or 0.11,
    sign*(rotation and 0.4*rotation or 0.16),reduced)
end

-- `focused`: active through keyboard focus rather than the pointer, so the
-- face keeps its ambient tilt instead of leaning toward a pointer elsewhere.
function Card:update(dt,time,active,reduced,focused)
  self.hovered=active
  self.focused=active and focused or false
  local m=self.motion
  m.T.x=(self.dragging and self.targetX or self.homeX)/self.unit
  m.T.y=(self.dragging and self.targetY or (self.homeY-(self.lift or 0)))/self.unit
  -- Balatro flags states.drag.is on the press itself, so a held card zooms
  -- and raises its shadow before (or without) moving.
  m:update(dt,time,active,self.dragging or self.held,reduced)
  self.x,self.y,self.angle=m.VT.x*self.unit,m.VT.y*self.unit,m.VT.r
end

function Card:shaderValues(time,mx,my,reduced)
  local tiltX,tiltY,tiltAmount
  if self.hovered and not self.focused then
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
  -- Balatro atlases use logical 71x95 pixels even with 2x artwork. Keep the
  -- original burn-mask grain independent of our higher-resolution canvases.
  local resolution=self.resolution or 1
  local shaderW,shaderH=W*resolution,H*resolution
  if self.disintegration then shaderW,shaderH=71,95 end
  -- One values table per card, refilled each frame.
  local v=self.shaderState
  if not v then
    v={texture_details={0,0,0,0},image_details={0,0},mouse_screen_pos={0,0}}
    self.shaderState,self.editionState=v,{0,0}
  end
  v.dissolve=self.dissolve or 0
  v.time=(123.33412*(self.index/1.14212))%3000
  local details=v.texture_details;details[1],details[2],details[3],details[4]=0,0,shaderW,shaderH
  local image=v.image_details;image[1],image[2]=shaderW,shaderH
  v.shadow=false
  v.burn_colour_1=self.burn1 or NO_BURN
  v.burn_colour_2=self.burn2 or NO_BURN
  local mouse=v.mouse_screen_pos;mouse[1],mouse[2]=px,py
  v.hovering=reduced and 0 or 1
  v.screen_scale=math.sqrt((ux-ox)^2+(uy-oy)^2)
  local edition=self.editionState;edition[1],edition[2]=phase,time
  return v,edition
end

-- hasUniform answers, per shader, keyed by uniform name.
local uniforms=setmetatable({},{__mode='k'})
local function has(shader,key)
  local known=uniforms[shader]
  if not known then known={};uniforms[shader]=known end
  local found=known[key]
  if found==nil then found=shader:hasUniform(key);known[key]=found end
  return found
end
local function send(shader,values)
  for key,value in pairs(values) do
    if has(shader,key) then shader:send(key,value) end
  end
end
local function sendOne(shader,key,value)
  if has(shader,key) then shader:send(key,value) end
end
Card.send=send

function Card:draw(shaders,time,mx,my,reduced,roomWidth)
  local values,edition=self:shaderValues(time,mx,my,reduced)
  local scale=self.motion.VT.scale
  local resolution=self.resolution or 1
  local sx,sy=CARD_W*self.unit/W*scale/resolution,CARD_H*self.unit/H*scale/resolution
  sx=sx*(self.flipScale or 1)
  -- Balatro Card:draw's greyed deck-view cards use played.fs directly, with
  -- no shadow or ordinary face beneath its translucent, desaturated artwork.
  if self.greyed then
    values.played=edition
    send(shaders.played,values)
    values.played=nil
    g.setShader(shaders.played);g.setColor(self.tint or WHITE)
    g.draw(self.texture,self.x,self.y,self.angle,sx,sy,W*resolution/2,H*resolution/2)
    g.setShader()
    return
  end
  local dissolve=shaders.dissolve
  -- Sprite:draw_shader's shadow pass is un-tilted, scaled down, and projected
  -- away from the room centre. Dragging raises it from 0.1 to 0.35 tile units.
  local shadowHeight=(self.dragging or self.held) and 0.35 or 0.1
  local parallax=(self.motion.T.x*self.unit-roomWidth/2)/(roomWidth/2)*1.5
  values.shadow=true; values.hovering=0
  send(dissolve,values)
  g.setShader(dissolve); g.setColor(1,1,1,1)
  g.draw(self.texture,self.x-parallax*shadowHeight*self.unit,
    self.y+1.5*shadowHeight*self.unit,self.angle,
    sx*(1-0.2*shadowHeight),sy*(1-0.2*shadowHeight),W*resolution/2,H*resolution/2)

  -- The face pass differs from the shadow pass only in these two uniforms.
  values.shadow=false; values.hovering=reduced and 0 or 1
  sendOne(dissolve,'shadow',false);sendOne(dissolve,'hovering',values.hovering)
  g.setColor(self.tint or WHITE)
  g.draw(self.texture,self.x,self.y,self.angle,sx,sy,W*resolution/2,H*resolution/2)
  -- Balatro draws every edition ON TOP of the ordinary card, with identical
  -- geometry; foil's partially transparent pass must never have its own tilt.
  -- An edition whose shader is not compiled (foil, holo and polychrome are packaged for later
  -- pages but never built) keeps the ordinary face rather than failing the frame.
  local shader=self.item.edition~='dissolve' and shaders[self.item.edition]
  if shader then
    values[self.item.edition]=edition
    send(shader,values); g.setShader(shader)
    values[self.item.edition]=nil
    g.draw(self.texture,self.x,self.y,self.angle,sx,sy,W*resolution/2,H*resolution/2)
  end
  g.setShader()
end
return Card
