-- create_option_cycle's DynaText subset: pop_in_rate=8, reset_pop_in=true,
-- float=true, bump=true, silent=true, shadow=true, scale=0.5.
local T=require('ui.theme')
local Codec=require('ui.codec')
local Text={}
Text.__index=Text
local g=love.graphics
function Text.new()
  return setmetatable({value='',created=0},Text)
end
function Text:set(value,time)
  if self.value==value then return end
  self.value,self.created=value,time
end
function Text.letter(time,created,index,length,reduced,scale)
  if reduced then return 1,0 end
  local pop=math.min(1,math.max((time-created)*length*8-index+1,0))
  -- DynaText applies bump AFTER float, replacing the floating offset.
  local offset=math.sqrt(scale or 0.5)*7*math.max(0,(5+2.666)*math.sin(2.666*time+200*index)-3-2.666)
  return pop*pop,offset
end
function Text:draw(time,reduced,x,y,w,h,roomWidth,textScale)
  local font=T.font(200)
  local unit,scale=60,textScale or 0.5
  local factor=scale*0.1/20*unit
  local letters={}
  local width=0
  for char in self.value:gmatch(Codec.UTF8_CHAR) do
    local cw=font:getWidth(char)*factor
    letters[#letters+1]={char=char,w=cw,rawWidth=font:getWidth(char)}
    width=width+cw
  end
  local height=font:getHeight()*factor*0.83
  -- Account for the cycle's empty 0.05-tile row beneath the text object.
  local left=x+(w-width)/2+10*factor
  local top=y+(h-height)/2-0.025*unit-20*factor
  local px=((x+w/2-roomWidth/2)/(roomWidth/2))*1.5
  local norm=math.sqrt(px*px+1.5*1.5)
  g.setFont(font)
  for _,shadow in ipairs({true,false}) do
    local cursor=left
    g.setColor(shadow and {0,0,0,0.3} or T.white)
    for i,letter in ipairs(letters) do
      local pop,offset=Text.letter(time,self.created,i,#letters,reduced,scale)
      local dx=shadow and -px*scale*unit/20 or px/norm*0.1/20*unit
      local dy=shadow and 1.5*scale*unit/20 or (-offset/2-1.5/norm)*0.1/20*unit
      g.print(letter.char,cursor+letter.w/2+dx,top+height/2+dy,0,factor*pop,factor*pop,
        letter.rawWidth/2,font:getHeight()*0.83/2)
      cursor=cursor+letter.w
    end
  end
end
return Text
