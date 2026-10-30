local T=require('ui.theme')
local Button=require('ui.button')
local Codec=require('ui.codec')
local Fit=require('ui.text_fit')
local Input={}
-- The size, from `size` down to 12, at which a field's value fits its width; remembered per value
-- and width, so a long value does not step through every size each frame.
local fitSize=Fit.cached(function(value,size,width)
  while size>12 and T.font(size):getWidth(value)>width do size=size-1 end
  return size
end)
local SHADOW={0,0,0,0.3}
function Input.background(item,editing,disabled,hovered)
  -- create_text_input + G.FUNCS.text_input: hooked colour is 30% darker;
  -- hover adds the standard black overlay. Shadow opacity never changes.
  local base=item.inputColour or T.ink
  local colour=disabled and T.panel or editing and {
    base[1]*0.7,base[2]*0.7,base[3]*0.7,base[4]} or base
  Button.panel(item.x,item.y+4,item.w,item.h,SHADOW)
  Button.panel(item.x,item.y,item.w,item.h,Button.hoverColour(colour,hovered and not disabled))
end
function Input.draw(item,value,editing,firstUnit,lastUnit,time,disabled,hovered)
  hovered=hovered and not disabled
  local g=love.graphics
  T.text(item.label,24,item.x,item.y-32,item.w)
  Input.background(item,editing,disabled,hovered)
  local size=fitSize(value,27,item.w-20)
  local font=T.font(size)
  local scale=math.min(1,(item.w-20)/math.max(1,font:getWidth(value)))
  g.push(); g.translate(item.x+10,item.y+5); g.scale(scale,1)
  local first=font:getWidth(Codec.utf16Prefix(value,firstUnit or 0))
  local last=font:getWidth(Codec.utf16Prefix(value,lastUnit or 0))
  if editing and last>first then g.setColor(T.blue); g.rectangle('fill',first,0,last-first,30) end
  T.text(value~='' and value or (item.placeholder or ''),size,0,0,(item.w-20)/scale,
    (disabled or value=='') and T.profile or T.white,'left')
  if editing and math.floor((time or 0)*2)%2==0 then
    g.setColor(T.white); g.rectangle('fill',last,2,2/scale,25)
  end
  g.pop()
end
return Input
