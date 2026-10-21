-- Compare stack placement directly with the original in-game G.deck code.
package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
local draws,shader,colour={},nil,nil
love={math={random=function() return 0.7 end},graphics={
  setShader=function(s) shader=s end,
  setColor=function(...) colour={...} end,
  transformPoint=function(x,y) return x,y end,
  draw=function(_,x,y,r,sx,sy) draws[#draws+1]={x=x,y=y,r=r,sx=sx,sy=sy,shader=shader,colour=colour} end,
}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={} end
local Pile=require('ui.deck_pile')
Moveable={extend=function() return {} end}
dofile((os.getenv('BALATRO_SOURCE') or '../balatro-source')..'/cardarea.lua')
local function near(a,b) assert(math.abs(a-b)<1e-9,tostring(a)..' != '..tostring(b)) end
for _,count in ipairs({1,9,18,52,60}) do
  for _,x in ipairs({220,640,1060}) do
    local p=Pile.new({count=count},1); p:place(x,300,0.82,false,1280)
    local cw,ch=D.W*p.baseScale/p.unit,D.H*p.baseScale/p.unit
    local parallax=(20-0.5-1.1*cw/2-10)/10*1.5
    local area={config={type='deck',deck_height=Pile.DECK_HEIGHT},shuffle_amt=0,children={},cards={},
      T={x=x/p.unit-cw/2,y=300/p.unit-ch/2,w=cw,h=ch},shadow_parrallax={x=parallax,y=-1.5}}
    G={deck=area}
    for k=1,count do area.cards[k]={T={w=cw,h=ch},facing='back',states={drag={is=false}},shadow_parrallax={x=parallax}} end
    CardArea.align_cards(area)
    for _,layer in ipairs(p.layers) do
      local ref=area.cards[layer.rank]
      near(layer.motion.T.x,ref.T.x+cw/2); near(layer.motion.T.y,ref.T.y+ch/2)
    end
    if count>1 then
      assert(p.layers[#p.layers].motion.T.x>p.layers[1].motion.T.x,'Top card must lean right everywhere in the grid')
    end
    draws={}; p:draw()
    assert(#draws==#p.layers)
    for i,d in ipairs(draws) do
      assert(not d.shader,'Resting deck backs must use plain sprites without shadows or tilt shaders')
      local rank=p.layers[i].rank
      near(d.colour[1],rank>3 and 0.5+((count-rank)%7)/50 or 1)
    end
  end
end
local p=Pile.new({count=60},1); p:place(220,300,0.82,false,1280)
for frame=1,90 do p:update(1/60,frame/60,false,false,1280) end
local bases={}
for i,layer in ipairs(p.layers) do bases[i]={x=layer.motion.VT.x,y=layer.motion.VT.y} end
p:juiceUp(1.5,nil,nil,false)
near(p.motion.juice.scale_amt,0.02); near(p.motion.juice.r_amt,0.012)
p.dragging=true; p.targetX,p.targetY=700,350
for frame=91,150 do p:update(1/60,frame/60,true,false,1280) end
for i,layer in ipairs(p.layers) do
  if layer.rank~=1 then
    near(layer.motion.VT.x,bases[i].x); near(layer.motion.VT.y,bases[i].y)
    near(layer.motion.VT.scale,1); near(layer.motion.VT.r,0)
  end
end
assert(p.x>690,'Only the top card follows dragging')
near(p.motion.VT.scale,1.1)
draws={}; p:draw(); assert(#draws==#p.layers-1)
local shadow={hasUniform=function() return true end,send=function() end}
p:drawDragged({dissolve=shadow},2.5,700,350,false,1280)
assert(#draws==#p.layers+1 and draws[#draws-1].shader==shadow and not draws[#draws].shader)
p.dragging=false
for frame=151,330 do p:update(1/60,frame/60,false,false,1280) end
near(p.x,p.motion.T.x*p.unit); near(p.y,p.motion.T.y*p.unit)
print('PASS: original CardArea stack positions at 15 count/position combinations, unshaded backs, rank shading, independent hover/drag and return motion')
-- Read the actual collection callback to capture its Card constructor origins.
local source=os.getenv('BALATRO_SOURCE') or '../balatro-source'
local f=assert(io.open(source..'/functions/button_callbacks.lua')); local callbacks=f:read('*a'); f:close()
local first=assert(callbacks:find('G.FUNCS.your_collection_joker_page = function(args)',1,true))
local last=assert(callbacks:find('--Changing the current page being viewed for the tarot',first,true))
G={FUNCS={},P_CENTER_POOLS={Joker={}},P_CARDS={empty={}},your_collection={}}
for i=1,20 do G.P_CENTER_POOLS.Joker[i]={} end
get_joker_win_sticker=function() end
INIT_COLLECTION_CARD_ALERTS=function() end
local spawned={}
_G.Card=function(x,y,w,h) spawned[#spawned+1]={x=x+w/2,y=y+h/2}; return {} end
local firstPile
for row=1,2 do
  local pile=Pile.new({count=60},1); pile:place(240,240+(row-1)*250,0.82,false,1280)
  local cw,ch=D.TILE_W,D.TILE_H
  G.CARD_W,G.CARD_H=cw,ch
  G.your_collection[row]={cards={},T={x=140/pile.unit,y=pile.homeY/pile.unit-0.95*ch/2,w=1000/pile.unit},emplace=function() end}
  if row==1 then firstPile=pile end
end
assert(loadstring(callbacks:sub(first,last-1)))()
G.FUNCS.your_collection_joker_page({cycle_config={current_option=2}})
firstPile:enterCollection(640)
for _,layer in ipairs(firstPile.layers) do
  near(layer.motion.VT.x,spawned[1].x); near(layer.motion.VT.y,spawned[1].y)
end
for frame=1,180 do firstPile:update(1/60,frame/60,false,false,1280) end
near(firstPile.x,firstPile.motion.T.x*firstPile.unit)
near(firstPile.y,firstPile.motion.T.y*firstPile.unit)
print('PASS: collection entrance origin matches original page callback and settles into the deck pile')
