-- Adapt create_UIBox_current_hand_row (functions/UI_definitions.lua): the
-- quantity replaces the level, and +/- replace the chips/mult values.
local T=require('ui.theme')
local Fit=require('ui.text_fit')
local Button=require('ui.button')
local Alert=require('ui.card_alert')
local Row={colours={
  background={191/255*0.9,199/255*0.9,213/255*0.9,1}, -- darken(JOKER_GREY,.1)
  badge={239/255,239/255,239/255,1}, -- HAND_LEVELS[1]
  badgeText=T.tray, -- UI.TEXT_DARK
  inset=T.panel, -- G.C.BLACK
  inactive={136/255,136/255,136/255,153/255}, -- UI.TEXT_INACTIVE
}}
local g=love.graphics
-- UIElement's static text: native font, .45/.5 scale, with shadow only
-- on the card name (the original badge and score values have no shadow).
local function text(value,scale,x,y,w,h,colour,shadow,roomWidth)
  value=tostring(value):gsub('%c',' ')
  local font=T.font(200)
  local factor=scale*0.3
  if font:getWidth(value)*factor>w-6 then factor=math.max(0.3*0.3,(w-6)/math.max(1,font:getWidth(value)))end
  if font:getWidth(value)*factor>w-6 then
    value=Fit.ellipsize(value,w-6,function(s) return font:getWidth(s)*factor end)
  end
  local tw,th=font:getWidth(value)*factor,font:getHeight()*0.83*factor
  local cx,cy=x+w/2,y+h/2
  g.setFont(font)
  if shadow then
    local px=(cx-roomWidth/2)/(roomWidth/2)*1.5
    g.push();g.translate(cx,cy);g.scale(0.97);g.setColor(0,0,0,0.3)
    g.print(value,-tw/2+10*factor-px*1.5,-th/2-20*factor+2.25,0,factor,factor);g.pop()
  end
  g.setColor(colour)
  g.print(value,cx-tw/2+10*factor,cy-th/2-20*factor,0,factor,factor)
end
function Row.draw(b,hovered,roomWidth)
  local x,y,w,h=b.x,b.y,b.rowWidth,b.h
  local c=Row.colours.background
  local depth=hovered and 0.5 or 0.7
  -- Source padding=.05, emboss=.05: three pixels at 60px/tile.
  Button.panel(x,y+3,w,h,{c[1]*depth,c[2]*depth,c[3]*depth,1})
  Button.panel(x,y,w,h,Button.hoverColour(c,hovered))
  Button.panel(x+3,y+3,42,h-6,Row.colours.badge)
  g.setLineWidth(2.4) -- source outline=.8 at TILESCALE=3
  Button.outline(x+3,y+3,42,h-6,T.white)
  g.setLineWidth(1)
  text(b.arg.quantity,0.5,x+3,y+3,42,h-6,Row.colours.badgeText,false,roomWidth)
  text(b.arg.name,0.45,x+48,y,w-132,h,T.white,true,roomWidth)
  -- Dark score-group inset, with three-pixel padding around both actions.
  Button.panel(x+w-81,y+3,78,h-6,Row.colours.inset)
end
-- The illegal-card alert (ui/card_alert.lua, red_bad like the collection
-- buttons), attached 'tri' to the name cell: its right edge at the dark inset
-- and 0.05 tiles above the row. Drawn on draw_layer 1 by the builder.
Row.alert={
  size=Alert.box.size*60,colour=Alert.colour(true),emboss=Alert.box.emboss*60,radius=1.8,offset={x=0,y=-3},
  text=Alert.text,
}
function Row.alertBox(b)
  local a=Row.alert
  return b.x+b.rowWidth-81+a.offset.x-a.size,b.y+a.offset.y,a.size,a.size
end
function Row.drawAlert(b,time,reduced,roomWidth)
  local x,y=Row.alertBox(b)
  Alert.draw(x,y,60,time,reduced,roomWidth,true)
end
function Row.action(b,hovered,pressed,roomWidth)
  -- Flat score cells from the source row; hover is applied because these
  -- adapted cells are interactive. No added emboss or button drop shadow.
  Button.panel(b.x,b.y,b.w,b.h,Button.hoverColour(b.colour,not b.disabled and (hovered or pressed)))
  text(b.label,0.45,b.x,b.y,b.w,b.h,b.disabled and Row.colours.inactive or T.white,false,roomWidth)
end
return Row
