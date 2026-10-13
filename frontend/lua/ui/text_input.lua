local T=require('ui.theme')
local Button=require('ui.button')
local Account=require('ui.account')
local Input={}
function Input.draw(item,value,editing,firstUnit,lastUnit,time,disabled)
  local g=love.graphics
  T.text(item.label,24,item.x,item.y-32,item.w)
  Button.panel(item.x,item.y+4,item.w,item.h,{0,0,0,0.3})
  Button.panel(item.x,item.y,item.w,item.h,(disabled or editing) and T.panel or T.ink)
  local size=27
  while size>12 and T.font(size):getWidth(value)>item.w-20 do size=size-1 end
  local font=T.font(size)
  local scale=math.min(1,(item.w-20)/math.max(1,font:getWidth(value)))
  g.push(); g.translate(item.x+10,item.y+5); g.scale(scale,1)
  local first=font:getWidth(Account.prefix(value,firstUnit or 0))
  local last=font:getWidth(Account.prefix(value,lastUnit or 0))
  if editing and last>first then g.setColor(T.blue); g.rectangle('fill',first,0,last-first,30) end
  T.text(value~='' and value or (item.placeholder or ''),size,0,0,(item.w-20)/scale,
    (disabled or value=='') and T.profile or T.white,'left')
  if editing and math.floor((time or 0)*2)%2==0 then
    g.setColor(T.white); g.rectangle('fill',last,2,2/scale,25)
  end
  g.pop()
end
return Input
