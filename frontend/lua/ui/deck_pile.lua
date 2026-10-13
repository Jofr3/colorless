-- In-game G.deck behavior from CardArea:align_cards/draw/set_ranks and
-- Card:hover/draw. Each visible rank has its own Moveable; only rank 1 reacts.
local Card=require('ui.card')
local Motion=require('ui.motion')
local Pile=setmetatable({}, {__index=Card})
Pile.__index=Pile
local g=love.graphics
function Pile.new(item,index)
  return setmetatable(Card.new(item,index),Pile)
end
function Pile.ranks(count)
  local ranks={}
  for rank=math.max(1,count),1,-1 do
    if rank==1 or rank%9==0 or rank==count then ranks[#ranks+1]=rank end
  end
  return ranks
end
function Pile.grey(count,rank)
  return rank>3 and 0.5+((count-rank)%7)/50 or 1
end
function Pile:target(rank,roomWidth,cardParallax)
  local areaParallax=(self.homeX-roomWidth/2)/(roomWidth/2)*1.5
  local depth=0.15/52*(self.count-rank)*self.unit
  return self.homeX+areaParallax*depth+cardParallax*self.unit/30,self.homeY-1.5*depth
end
function Pile:place(x,y,scale,entering,roomWidth)
  Card.place(self,x,y,scale,false)
  self.count=math.max(1,self.item.count)
  self.layers={}
  roomWidth=roomWidth or 1280
  local parallax=(x-roomWidth/2)/(roomWidth/2)*1.5
  for _,rank in ipairs(Pile.ranks(self.count)) do
    local tx,ty=self:target(rank,roomWidth,parallax)
    local motion=Motion.new(tx/self.unit,ty/self.unit,0)
    self.layers[#self.layers+1]={rank=rank,motion=motion}
    if rank==1 then self.motion=motion end
  end
  self.x,self.y,self.angle=self.motion.VT.x*self.unit,self.motion.VT.y*self.unit,0
end
function Pile:juiceUp(time,scale,rotation,reduced)
  -- Card:hover calls juice_up(0.05, 0.03), converted by Card:juice_up.
  Card.juiceUp(self,time,scale or 0.05,rotation or 0.03,reduced)
end
function Pile:update(dt,time,active,reduced,roomWidth)
  self.hovered=active and not self.dragging
  roomWidth=roomWidth or 1280
  for _,layer in ipairs(self.layers) do
    local m=layer.motion
    local top=layer.rank==1
    local px=(m.T.x*self.unit-roomWidth/2)/(roomWidth/2)*1.5
    local tx,ty=self:target(layer.rank,roomWidth,px)
    m.T.x=(top and self.dragging and self.targetX or tx)/self.unit
    m.T.y=(top and self.dragging and self.targetY or ty)/self.unit
    m:update(dt,time,top and self.hovered,top and self.dragging,reduced)
  end
  local v=self.motion.VT
  self.x,self.y,self.angle=v.x*self.unit,v.y*self.unit,v.r
end
local function face(self,layer)
  local v=layer.motion.VT
  local shade=Pile.grey(self.count,layer.rank)
  g.setColor(shade,shade,shade,1)
  g.draw(self.texture,v.x*self.unit,v.y*self.unit,v.r,self.baseScale*v.scale,self.baseScale*v.scale,71,95)
end
function Pile:draw()
  -- Deck backs use Sprite:draw(overlay), never the mouse-tilt dissolve pass.
  -- Card:draw explicitly excludes cards in a deck from resting shadows.
  g.setShader()
  for _,layer in ipairs(self.layers) do
    if not (self.dragging and layer.rank==1) then face(self,layer) end
  end
end
function Pile:drawDragged(shaders,time,mx,my,reduced,roomWidth)
  if not self.dragging then return end
  local values=self:shaderValues(time,mx,my,reduced)
  values.shadow=true; values.hovering=0
  local shader=shaders.dissolve
  for key,value in pairs(values) do if shader:hasUniform(key) then shader:send(key,value) end end
  local parallax=(self.motion.T.x*self.unit-roomWidth/2)/(roomWidth/2)*1.5
  local scale=self.baseScale*self.motion.VT.scale
  g.setShader(shader); g.setColor(1,1,1,1)
  g.draw(self.texture,self.x-parallax*0.35*self.unit,self.y+1.5*0.35*self.unit,self.angle,scale*0.93,scale*0.93,71,95)
  g.setShader()
  face(self,self.layers[#self.layers])
end
return Pile
