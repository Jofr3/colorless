-- create_UIBox_card_alert (functions/UI_definitions.lua): a 0.42-tile red
-- square (r=0.15, emboss 0.05) holding a white DynaText '!' that rotates and
-- bumps (bump_rate 7, bump_amount 3, scale 0.48, spacing 3, text_rot 0.2).
-- The collection buttons use red_bad (red darkened by 0.1); cards use plain
-- red. Alerts live on draw_layer 1, so callers draw them after everything.
local T=require('ui.theme')
local Button=require('ui.button')
local Dyna=require('ui.dynatext')
local Alert={}
local g=love.graphics
Alert.box={size=0.42,r=0.15,emboss=0.05} -- tiles
Alert.text={string='!',colours={T.white},shadow=true,rotate=true,bump=true,
  bump_rate=7,bump_amount=3,scale=0.48,spacing=3,text_rot=0.2,font_offset=true}
-- Card:draw attaches the alert with align 'tri' and offset (-0.1, 0.1), fully
-- inside the corner. Our cards and deck piles are smaller, so the badge
-- straddles the corner instead; each surface tunes how far it overhangs.
Alert.card={x=0.11,y=-0.11} -- centre 0.1 tiles inside the corner
Alert.pile={x=0.05,y=-0.05} -- deck backs: a little further in
Alert.gallery={x=0.17,y=-0.17} -- gallery cards: a little further out
function Alert.colour(redBad)
  local c=T.red
  return redBad and {c[1]*0.9,c[2]*0.9,c[3]*0.9,1} or {c[1],c[2],c[3],1}
end
local marks={}
local function mark(unit)
  if not marks[unit] then
    local cfg={};for k,v in pairs(Alert.text) do cfg[k]=v end
    cfg.scale=Alert.text.scale*unit/60
    marks[unit]=Dyna.new(cfg)
  end
  return marks[unit]
end
-- Draw a badge with its top-left at (x,y). `unit` is the pixel size of one
-- tile where the badge lives: 60 in menus, a card's own unit on a card.
-- `parallaxX` is the badge's room x when drawing inside a local transform.
function Alert.draw(x,y,unit,time,reduced,roomWidth,redBad,parallaxX)
  local size=Alert.box.size*unit
  local c=Alert.colour(redBad)
  local r=0.6*unit/20 -- draw_pixellated_rect: res 0.6 for boxes under 3.5 tiles
  Button.panel(x,y+Alert.box.emboss*unit,size,size,{c[1]*0.7,c[2]*0.7,c[3]*0.7,1},r)
  Button.panel(x,y,size,size,c,r)
  local m=mark(unit)
  m:update(time or 0,reduced)
  m:draw(x+size/2,y+size/2,roomWidth,1,parallaxX)
  return size
end
-- Top-left of a card alert relative to the card centre, in pixels.
function Alert.cardOffset(card,offset)
  offset=offset or Alert.card
  local unit,scale=card.unit,card.motion.VT.scale
  local halfW,halfH=71*card.baseScale*scale,95*card.baseScale*scale
  return halfW+(offset.x-Alert.box.size)*unit,-halfH+offset.y*unit
end
-- The UIBox child follows the card's position and rotation.
function Alert.drawOnCard(card,time,reduced,roomWidth,offset)
  local ox,oy=Alert.cardOffset(card,offset)
  local size=Alert.box.size*card.unit
  local angle=card.angle or 0
  local cx=card.x+(ox+size/2)*math.cos(angle)-(oy+size/2)*math.sin(angle)
  g.push();g.translate(card.x,card.y);g.rotate(angle)
  Alert.draw(ox,oy,card.unit,time,reduced,roomWidth,false,cx)
  g.pop()
end
return Alert
