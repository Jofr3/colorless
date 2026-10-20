local D=require('ui.card_dimensions')
-- In-game G.deck behavior from CardArea:align_cards/draw/set_ranks and
-- Card:hover/draw. Each visible rank has its own Moveable; only rank 1 reacts.
local Card=require('ui.card')
local Motion=require('ui.motion')
local Pile=setmetatable({}, {__index=Card})
Pile.__index=Pile
local g=love.graphics
-- Preserve G.deck's right-side perspective when displaying a grid of decks.
-- game.lua: deck_W = 1.1 * CARD_W; set_screen_positions: x = TILE_W-w-0.5.
Pile.referenceX=20-0.5-1.1*(D.TILE_W)/2
function Pile.parallax(offset)
  return (Pile.referenceX+(offset or 0)-10)/10*1.5
end
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
  local areaParallax=Pile.parallax()
  local depth=0.15/52*(self.count-rank)*self.unit
  return self.homeX+areaParallax*depth+cardParallax*self.unit/30,self.homeY-1.5*depth
end
function Pile:place(x,y,scale,entering,roomWidth)
  Card.place(self,x,y,scale,false)
  self.count=math.max(1,self.item.count)
  self.layers={}
  roomWidth=roomWidth or 1280
  local parallax=Pile.parallax()
  for _,rank in ipairs(Pile.ranks(self.count)) do
    local tx,ty=self:target(rank,roomWidth,parallax)
    local motion=Motion.new(tx/self.unit,ty/self.unit,0)
    self.layers[#self.layers+1]={rank=rank,motion=motion}
    if rank==1 then self.motion=motion end
  end
  self.x,self.y,self.angle=self.motion.VT.x*self.unit,self.motion.VT.y*self.unit,0
end
-- The collection page callback constructs every card at its row's centre
-- (top-left x = area.x + area.w/2, y = area.y), then emplaces it.
function Pile:enterCollection(rowCentre)
  for _,layer in ipairs(self.layers) do
    layer.motion.VT.x=(rowCentre+D.HALF_W*self.baseScale)/self.unit
    layer.motion.VT.y=(self.homeY+0.025*(D.TILE_H)*self.unit)/self.unit
    layer.motion.VT.r=0
  end
  self.x,self.y=self.motion.VT.x*self.unit,self.motion.VT.y*self.unit
end
function Pile:juiceUp(time,scale,rotation,reduced)
  -- Card:hover calls juice_up(0.05, 0.03), converted by Card:juice_up.
  Card.juiceUp(self,time,scale or 0.05,rotation or 0.03,reduced)
end
function Pile:click(time,reduced)
  -- Use Card:juice_up's default pulse (0.11 scale, +/-0.16 rotation),
  -- rather than the smaller Card:hover pulse used by piles above.
  Card.juiceUp(self,time,nil,nil,reduced)
end
-- CardArea:align_cards' shuffle_amt: odd ranks slide 0.9 tiles sideways and
-- turn 0.3 radians while the amount is up. Two riffles over 0.7 seconds.
Pile.SHUFFLE_TIME=0.7
function Pile:shuffle(time) self.shuffleStart=time end
function Pile:shuffleAmount(time,reduced)
  if reduced or not self.shuffleStart then return 0 end
  local t=time-self.shuffleStart
  if t<0 or t>Pile.SHUFFLE_TIME then return 0 end
  return math.abs(math.sin(math.pi*t/(Pile.SHUFFLE_TIME/2)))
end
function Pile:update(dt,time,active,reduced,roomWidth)
  self.hovered=active and not self.dragging
  roomWidth=roomWidth or 1280
  local amt=self:shuffleAmount(time,reduced)
  for _,layer in ipairs(self.layers) do
    local m=layer.motion
    local top=layer.rank==1
    local px=Pile.parallax(m.T.x-self.homeX/self.unit)
    local tx,ty=self:target(layer.rank,roomWidth,px)
    local odd=(layer.rank%2==1) and 1 or 0
    m.T.x=(top and self.dragging and self.targetX or tx)/self.unit+0.9*amt*(1-layer.rank*0.01)*odd
    m.T.y=(top and self.dragging and self.targetY or ty)/self.unit
    m.T.r=0.3*amt*(1+layer.rank*0.05)*odd
    m:update(dt,time,top and self.hovered,top and self.dragging,reduced)
  end
  local v=self.motion.VT
  self.x,self.y,self.angle=v.x*self.unit,v.y*self.unit,v.r
end
local function face(self,layer)
  local v=layer.motion.VT
  local shade=Pile.grey(self.count,layer.rank)
  g.setColor(shade,shade,shade,1)
  g.draw(self.texture,v.x*self.unit,v.y*self.unit,v.r,self.baseScale*v.scale,self.baseScale*v.scale,D.HALF_W,D.HALF_H)
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
  g.draw(self.texture,self.x-parallax*0.35*self.unit,self.y+1.5*0.35*self.unit,self.angle,scale*0.93,scale*0.93,D.HALF_W,D.HALF_H)
  g.setShader()
  face(self,self.layers[#self.layers])
end
return Pile
