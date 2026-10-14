-- Balatro's high-score rows and create_progress_box: grey label panels,
-- inset black values, 0.05-tile emboss, and half-alpha blue progress fills.
local T=require('ui.theme')
local Button=require('ui.button')
local Stats={}
function Stats.rows(deck)
  local basic=0
  for _,item in ipairs(deck.deck)do
    if item.kind~='' then
      if (item.kind=='Pokémon' or item.kind=='Pokemon') and item.subtype=='Basic' then basic=basic+item.quantity end
    end
  end
  local total=deck.count
  local left={
    {label='Format',value=deck.format=='expanded' and 'Expanded' or 'Standard'},
    {label='Total cards',value=total..'/60',colour=total>60 and T.red or total==60 and {234/255,192/255,88/255,1} or T.blue},
    {label='Basic Pokemon',value=tostring(basic),colour=basic==0 and T.red or T.white},
  }
  local right={}
  for i,label in ipairs({'Pokemon','Trainer','Energy'})do
    local count=tonumber(deck.groups[i]) or 0
    right[#right+1]={label=label,value=tostring(count),suffix=' ('..(total>0 and math.floor(count/total*100+0.01) or 0)..'%)',progress=total>0 and count/total or 0}
  end
  return left,right
end
function Stats.layout(modal)
  local x,y,width=modal.x+24,modal.y+24,modal.w-48
  return x,y,width,x,y+3*58
end
-- Exact G.C.JOKER_GREY and G.C.BLACK from globals.lua. The profile button
-- colour is a different grey; G.C.BLACK is T.panel, not the deeper T.ink.
Stats.colours={label={191/255*0.9,199/255*0.9,213/255*0.9,1},value=T.panel,muted={191/255,199/255,213/255,1}}
local g=love.graphics
local function embossed(x,y,w,h,colour)
  Button.panel(x,y+3,w,h,{colour[1]*0.7,colour[2]*0.7,colour[3]*0.7,colour[4]})
  Button.panel(x,y,w,h,colour)
end
local function measure(value,scale)
  local font=T.font(200);local factor=scale*0.3
  return font:getWidth(value)*factor,font:getHeight()*0.83*factor
end
-- UIElement:draw_self: native 200px font, .97 shadow transform, text offsets
-- (10,-20), and position-dependent shadow parallax; suffixes have no shadow.
local function static(value,scale,x,y,w,h,colour,shadow,roomWidth)
  local tw,th=measure(value,scale)
  if tw>w-12 then scale=scale*(w-12)/tw;tw,th=measure(value,scale)end
  local factor=scale*0.3;local cx,cy=x+w/2,y+h/2
  local px=(cx-roomWidth/2)/(roomWidth/2)*1.5
  g.setFont(T.font(200))
  if shadow then
    g.push();g.translate(cx,cy);g.scale(0.97);g.setColor(0,0,0,0.3)
    g.print(value,-tw/2+10*factor-px*1.5,-th/2-20*factor+2.25,0,factor,factor);g.pop()
  end
  g.setColor(colour);g.print(value,cx-tw/2+10*factor,cy-th/2-20*factor,0,factor,factor)
end
-- DynaText float=true (not the paginator's bump). Its shadow stays on the
-- baseline while each foreground glyph floats; reduced motion disables float.
local function floating(value,scale,x,y,w,h,colour,time,reduced,roomWidth)
  local font=T.font(200);local tw,th=measure(value,scale)
  if tw>w-12 then scale=scale*(w-12)/tw;tw,th=measure(value,scale)end
  local factor=scale*0.3;local px=(x+w/2-roomWidth/2)/(roomWidth/2)*1.5
  local norm=math.sqrt(px*px+2.25)
  g.setFont(font)
  for _,shadow in ipairs({true,false})do
    local cursor=x+(w-tw)/2+10*factor
    g.setColor(shadow and {0,0,0,0.3} or colour)
    local i=0
    for char in value:gmatch('.')do
      i=i+1
      local offset=reduced and 0 or math.sqrt(scale)*(2+10*math.sin(2.666*time+200*i))
      local dx=shadow and -px*scale*3 or px/norm*0.3
      local dy=shadow and 1.5*scale*3 or (-offset/2-1.5/norm)*0.3
      g.print(char,cursor+dx,y+(h-th)/2-20*factor+dy,0,factor,factor)
      cursor=cursor+font:getWidth(char)*factor
    end
  end
end
local function row(data,x,y,w,deck,isProgress)
  local colour=Stats.colours
  if not data.plain then embossed(x,y,w,50,colour.label)end
  local split=0.49
  local vx,vw=x+w*split,w*(1-split)-3
  -- UIBox padding=.05 => three pixels; the inset has its own embossed edge.
  local vy,vh=y+3,44
  if data.plain then vy,vh=y+7,36 end
  embossed(vx,vy,vw,vh,colour.value)
  if data.progress and data.progress>0 then
    Button.panel(vx,vy,vw,vh,{T.blue[1],T.blue[2],T.blue[3],0.5},1.8,data.progress)
  end
  local labelScale=isProgress and 0.5 or 0.65-0.025*math.max(#data.label-8,0)
  static(data.label,labelScale,x,y,w*split,50,T.white,true,deck.width)
  if data.suffix then
    local valueWidth=measure(data.value,0.55)
    local suffixWidth=measure(data.suffix,0.35)
    local tx=vx+(vw-valueWidth-suffixWidth)/2
    floating(data.value,0.55,tx-6,y,valueWidth+12,50,T.white,deck.time,deck.reduced,deck.width)
    static(data.suffix,0.35,tx+valueWidth-6,y,suffixWidth+12,50,colour.muted,false,deck.width)
  else
    local scale=isProgress and 0.55 or data.label=='Format' and 0.55 or data.label=='Total cards' and 0.65 or 0.85
    floating(data.value,scale,vx,y,vw,50,data.colour or T.white,deck.time,deck.reduced,deck.width)
  end
end
function Stats.draw(deck,modal,portrait)
  local left,right=Stats.rows(deck)
  local x,y,w,rx,ry=Stats.layout(modal,portrait)
  for i,data in ipairs(left)do row(data,x,y+(i-1)*58,w,deck,false)end
  for i,data in ipairs(right)do row(data,rx,ry+(i-1)*58,w,deck,true)end
end
return Stats
