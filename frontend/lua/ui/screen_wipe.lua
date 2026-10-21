-- functions/button_callbacks.lua: wipe_on/wipe_off; engine/particles.lua.
-- A single opaque square, not a fade. The source's 'before' event flips the
-- card immediately and blocks the scene change for 0.7 REAL seconds.
local Card=require('ui.card')
local CardFrame=require('ui.card_frame')
local D=require('ui.card_dimensions')
local Dissolve=require('ui.dissolve')
local TransitionArt=require('ui.transition_art')
local Wipe={};Wipe.__index=Wipe
local g=love.graphics
Wipe.coverTime=0.7
Wipe.lifespan=1.7
Wipe.dissolveAt=Wipe.coverTime+0.55
Wipe.removeAt=Wipe.coverTime+1.1
Wipe.palette={{55/255,66/255,68/255,1},{253/255,162/255,0,1},
  {234/255,192/255,88/255,1},{254/255,95/255,85/255,1}}
local centers
local function atlases()
  if centers then return end
  centers=g.newImage('assets/textures/2x/Enhancers.png')
  centers:setFilter('nearest','nearest')
end
function Wipe.new(callback,colour,reduced,feedback)
  local self=setmetatable({age=0,callback=callback,colour=colour,reduced=reduced,
    feedback=feedback or function()end,facing=love.math.random()*2*math.pi,
    rotationVelocity=0.2*(0.5-love.math.random()),flip=1,front=false},Wipe)
  if not reduced then self.feedback('cardFan2',1,1) end
  return self
end
function Wipe:layout(w,h,unit,viewportWidth,viewportHeight)
  self.width,self.height,self.unit=w,h,unit
  -- 40 tiles is the source value. Expand only for viewports whose diagonal
  -- would otherwise protrude at the covered scene-change point (portrait).
  local vw,vh=viewportWidth or w,viewportHeight or h
  self.maxScale=math.max(40,math.sqrt(vw*vw+vh*vh)/unit*Wipe.lifespan/(2*Wipe.coverTime)*1.04)
  if self.reduced then return end
  if not self.card then
    atlases()
    self.back=g.newQuad(0,0,142,190,centers:getDimensions())
    self.art=TransitionArt.pick()
    local ok,face=pcall(g.newImage,self.art.path)
    local rejectedToken
    if not ok then
      rejectedToken=self.art.token
      self.art=TransitionArt.fallback()
      face=g.newImage(self.art.path)
    end
    -- Decode once and retain the GPU image and border through the wipe. A
    -- scene change can evict the original cache file before the card flips
    -- or the window resizes; neither should change the selected artwork.
    self.face=face;self.face:setFilter('linear','linear')
    self.border=CardFrame.border(self.art.path)
    if self.art.token then print('LUMINOUS:transition-art:used:'..self.art.token)
    elseif rejectedToken then print('LUMINOUS:transition-art:invalid:'..rejectedToken) end
    self.card=Card.new({edition='dissolve',resolution=2,drawFace=function(cw,ch)
      g.setColor(1,1,1)
      if self.front then
        CardFrame.draw(cw,ch,function(aw,ah)
          g.setColor(1,1,1)
          g.draw(self.face,0,0,0,aw/self.face:getWidth(),ah/self.face:getHeight())
        end,self.border)
      else g.draw(centers,self.back,0,0,0,cw/142,ch/190) end
    end},1)
    self.card.disintegration=true
    self.card:place(w/2,h/2,D.TILE_W*unit/D.W,false)
    self.card.motion.T.r=0;self.card.motion.VT.r=0
    self.card:juiceUp(0,0.5,1)
  else
    -- Resize clears WebGL canvases: rebuild the visible side, preserving time,
    -- flip, juice, and burn instead of replaying the transition.
    local c=self.card
    c:rebuild();c.unit=unit;c.baseScale=D.TILE_W*unit/D.W
    c.homeX,c.homeY=w/2,h/2;c.x,c.y=w/2,h/2
    c.motion.T.x,c.motion.T.y=w/2/unit,h/2/unit
    c.motion.VT.x,c.motion.VT.y=c.motion.T.x,c.motion.T.y
  end
end
function Wipe:scale()
  return math.max(0,math.min(2*math.min(self.age/Wipe.lifespan,
    (Wipe.lifespan-self.age)/Wipe.lifespan),1))*self.maxScale
end
function Wipe:update(dt)
  self.age=self.age+dt
  self.facing=self.facing+self.rotationVelocity*dt
  if not self.committed and (self.reduced or self.age>=Wipe.coverTime) then
    self.committed=true
    self.callback()
  end
  if self.reduced then return true end
  local c=self.card
  if c then
    -- Card:update changes sprite_facing at zero; Moveable:move_wh runs next.
    if not self.front and self.flip<=0 then self.front=true;c:rebuild() end
    self.flip=math.max(0,math.min(1,self.flip+(self.front and 1 or -1)*8*math.min(dt,1/20)))
    c.flipScale=self.flip
    if self.age>=Wipe.dissolveAt and not self.burn then
      self.burn=Dissolve.new(c,Wipe.dissolveAt,Wipe.palette)
      self.feedback('whoosh2',0.9+love.math.random()*0.2,0.5)
      self.feedback('crumple'..love.math.random(1,5),0.9+love.math.random()*0.2,0.5)
    end
    if self.burn then self.burn:update(c,dt,self.age) end
    c:update(dt,self.age,false,false)
  end
  return self.age>=Wipe.removeAt
end
function Wipe:draw(shaders,targetColour)
  if self.reduced then return end
  local size=self:scale()*self.unit
  -- The source particle retains BACKGROUND.C by reference while that colour
  -- eases to the new scene over 0.6s. Our scenes own separate palettes.
  local c,target=self.colour,targetColour or self.colour
  local mix=math.max(0,math.min(1,(self.age-Wipe.coverTime)/0.6))
  g.setShader();g.setColor(c[1]+(target[1]-c[1])*mix,c[2]+(target[2]-c[2])*mix,c[3]+(target[3]-c[3])*mix,1)
  g.push();g.translate(self.width/2,self.height/2);g.rotate(self.facing)
  g.rectangle('fill',-size/2,-size/2,size,size);g.pop()
  if self.card then
    self.card:draw(shaders,self.age,0,0,false,self.width)
    if self.burn then self.burn:draw(self.card) end
  end
end
function Wipe:release()
  if self.card then self.card.texture:release();self.card=nil end
  if self.face then self.face:release();self.face=nil end
end
return Wipe
