local D=require('ui.card_dimensions')
-- CardArea:draw's area_uibox counter and view_deck badge. Coordinates below
-- follow UIBox's tile layout, including the original 200px font rasterization.
local T=require('ui.theme')
local Button=require('ui.button')
local Pile=require('ui.deck_pile')
local Display=require('ui.display')
local Labels={}
local g=love.graphics
local CARD_W,CARD_H=D.TILE_W,D.TILE_H
local function metric(text,scale)
  local font=T.font(200)
  return font:getWidth(text)*scale*0.1/20,font:getHeight()*scale*0.1/20*0.83
end
Labels.metric=metric
-- `scale`: the text's UIElement scale, 0.3 unless a phone needs it larger.
function Labels.counter(count,limit,scale)
  scale=scale or 0.3
  local nodes={}
  local values={tostring(count),'/',tostring(limit or count)}
  local width=0.2+(#values+3)*0.03 -- two 0.1-tile spacers and node padding
  for _,text in ipairs(values) do
    local w,h=metric(text,scale)
    nodes[#nodes+1]={text=text,w=w,h=h,scale=scale}
    width=width+w
  end
  local areaWidth=1.1*CARD_W
  local rowWidth=math.max(areaWidth,width)
  local x=-rowWidth/2+rowWidth-width+0.03+0.1+0.03
  local y=0.95*CARD_H/2+0.03
  for _,node in ipairs(nodes) do node.x,node.y=x,y; x=x+node.w+0.03 end
  return nodes,y+nodes[1].h+0.03
end
function Labels.hover()
  local nodes={}
  local width,height=0,0
  for i,text in ipairs({'View','Deck'}) do
    local scale=i==1 and 0.48 or 0.38
    local w,h=metric(text,scale)
    if w>2 then scale=scale*2/w; w,h=metric(text,scale) end
    nodes[i]={text=text,w=w,h=h,scale=scale}
    width=math.max(width,w); height=height+h
  end
  -- The outer 0.1 clear padding surrounds this inner 0.05 padded button.
  width,height=width+0.1,height+0.15
  local y=-height/2+0.05
  for _,node in ipairs(nodes) do node.x,node.y=-node.w/2,y; y=y+node.h+0.05 end
  return nodes,width,height
end
local function text(node,unit,shadow,parallax)
  local factor=node.scale*0.1/20*unit
  local x,y=node.x*unit,node.y*unit
  g.setFont(T.font(200))
  if shadow then
    -- UIElement:draw_self uses prep_draw(.97) plus text parallax.
    g.push(); g.translate(x+node.w*unit/2,y+node.h*unit/2); g.scale(0.97)
    g.setColor(0,0,0,0.3)
    g.print(node.text,-node.w*unit/2+10*factor-parallax*unit/40,
      -node.h*unit/2-20*factor+1.5*unit/40,0,factor,factor)
    g.pop()
  end
  g.setColor(T.white)
  g.print(node.text,x+10*factor,y-20*factor,0,factor,factor)
end
local function drawCounter(card,count,limit)
  -- On a phone held upright the count is at least Display.MIN_TEXT_CSS (audit QA11); its em is
  -- the scale times the pile's unit.
  -- A pile drawn smaller than its page's own size may keep its count larger (`counterScale`).
  local scale=Display.phone() and math.max(0.3,Display.MIN_TEXT_CSS/(card.unit*Display.collection)) or nil
  if card.counterScale then scale=math.max(scale or 0.3,card.counterScale) end
  local nodes,bottom=Labels.counter(count,limit,scale)
  local gap=0.08*card.unit -- extra clearance below the pile in the library
  g.push(); g.translate(card.homeX,card.homeY+gap)
  for _,node in ipairs(nodes) do text(node,card.unit,false) end
  g.pop()
  return card.homeY+gap+bottom*card.unit
end
function Labels.drawCounter(card)
  return drawCounter(card,card.item.count)
end
function Labels.drawQuantity(card)
  return drawCounter(card,card.item.quantity,card.item.copyLimit or 4)
end
function Labels.drawHover(card)
  if not card.hovered or card.dragging then return end
  local nodes,w,h=Labels.hover()
  -- UIBox: strong position/rotation bond, weak scale bond to the top card.
  g.push(); g.translate(card.x,card.y); g.rotate(card.angle)
  Button.panel(-w*card.unit/2,-h*card.unit/2,w*card.unit,h*card.unit,
    {55/255,66/255,68/255,0.5},0.6*card.unit/20)
  for _,node in ipairs(nodes) do text(node,card.unit,true,Pile.parallax(node.x+node.w/2)) end
  g.pop()
end
return Labels
