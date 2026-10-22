-- DynaText (engine/text.lua) in pixels: letters pop in, float, bump, pulse and
-- rotate; shadows use the 30% black / 0.97 prep_draw convention. Text uses the
-- 200px m6x11plus atlas scaled by `scale*0.1/20*60`, exactly as UIElement text.
local T=require('ui.theme')
local Dyna={};Dyna.__index=Dyna
local g=love.graphics
local UNIT=60
Dyna.OFFSET_X,Dyna.OFFSET_Y,Dyna.HEIGHT_SCALE=10,-20,0.83
local function factor(scale) return scale*0.1/20*UNIT end
local function chars(text)
  local out={}
  for c in tostring(text):gmatch('[%z\1-\127\194-\244][\128-\191]*') do out[#out+1]=c end
  return out
end
-- Metrics of a static string at a DynaText/UIElement scale, in pixels.
function Dyna.measure(text,scale)
  local font=T.font(200)
  return font:getWidth(tostring(text))*factor(scale),font:getHeight()*factor(scale)*Dyna.HEIGHT_SCALE
end
-- Word-wrap at a scale; returns lines and the line height.
function Dyna.wrap(text,scale,width)
  local font=T.font(200)
  local f=factor(scale)
  local lines={}
  for paragraph in (tostring(text or '')..'\n'):gmatch('(.-)\n') do
    local _,wrapped=font:getWrap(paragraph,width/f)
    if #wrapped==0 then wrapped={''} end
    for _,line in ipairs(wrapped) do lines[#lines+1]=line end
  end
  return lines,font:getHeight()*f*Dyna.HEIGHT_SCALE
end
-- UIElement:draw_self text: shadow at 0.97 with position parallax, then the
-- glyphs with the font's (10,-20) atlas offsets. Centred in the (x,y,w,h) box.
function Dyna.static(text,scale,x,y,w,h,colour,opts)
  opts=opts or {}
  text=tostring(text)
  local font=T.font(200)
  local tw,th=Dyna.measure(text,scale)
  if opts.fit and tw>w-4 then scale=scale*(w-4)/tw;tw,th=Dyna.measure(text,scale) end
  local f=factor(scale)
  local align=opts.align or 'center'
  local cx=align=='left' and x+tw/2 or align=='right' and x+w-tw/2 or x+w/2
  local cy=y+(h or th)/2
  local roomWidth=opts.roomWidth or 1280
  local px=(cx-roomWidth/2)/(roomWidth/2)*1.5
  g.setFont(font)
  if opts.shadow~=false then
    g.push();g.translate(cx,cy);g.scale(0.97)
    g.setColor(0,0,0,0.3*(colour and colour[4] or 1))
    g.print(text,-tw/2+Dyna.OFFSET_X*f-px*1.5,-th/2+Dyna.OFFSET_Y*f+2.25,0,f,f)
    g.pop()
  end
  g.setColor(colour or T.white)
  g.print(text,cx-tw/2+Dyna.OFFSET_X*f,cy-th/2+Dyna.OFFSET_Y*f,0,f,f)
  return tw,th
end
function Dyna.new(cfg)
  cfg=cfg or {}
  local self=setmetatable({
    cfg=cfg,scale=cfg.scale or 1,colours=cfg.colours or {T.red},shadow=cfg.shadow,
    popInRate=cfg.pop_in_rate or 3,bumpRate=cfg.bump_rate or 2.666,bumpAmount=cfg.bump_amount or 1,
    letters={},string='',created=cfg.time or 0,W=0,H=0,
  },Dyna)
  self.popIn=cfg.pop_in
  self:set(cfg.string or '',cfg.time or 0,true)
  return self
end
-- Changing the string restarts the pop-in only when the text was created with
-- pop_in (reset_pop_in semantics); otherwise letters simply swap.
function Dyna:set(text,time,first)
  text=tostring(text or '')
  if text==self.string and not first then return end
  self.string=text
  local font=T.font(200)
  local baseScale=self.cfg.scale or 1
  self.scale=baseScale
  local width=0
  for _,c in ipairs(chars(text)) do width=width+font:getWidth(c)*factor(self.scale)+2.7*(self.cfg.spacing or 0)*0.3 end
  if self.cfg.maxw and width>self.cfg.maxw and width>0 then self.scale=self.scale*self.cfg.maxw/width end
  local f=factor(self.scale)
  self.letters={}
  self.W,self.H=0,0
  for _,c in ipairs(chars(text)) do
    local w=font:getWidth(c)*f+2.7*(self.cfg.spacing or 0)*0.3
    local h=font:getHeight()*f*Dyna.HEIGHT_SCALE
    self.letters[#self.letters+1]={char=c,w=w,h=h,rawW=font:getWidth(c),pop=(self.cfg.pop_in and 0 or 1),scale=1,r=0,offset=0}
    self.W=self.W+w
    self.H=math.max(self.H,h)
  end
  if self.cfg.pop_in or self.cfg.reset_pop_in then self.popIn=self.cfg.pop_in or 0;self.created=time or 0 end
  self.popOut=nil
end
function Dyna:pulse(amount,time)
  self.pulseState={speed=40,width=2.5,start=time,amount=amount or 0.2}
end
function Dyna:pop_out(rate,time)
  self.popOut=rate or 1;self.popOutTime=time
end
function Dyna:update(time,reduced)
  local n=#self.letters
  local motion=reduced and 0 or 1
  for k,letter in ipairs(self.letters) do
    if self.popOut then
      letter.pop=math.min(1,math.max(1-(time-self.popOutTime)*self.popOut,0))
      letter.pop=letter.pop*letter.pop
    elseif self.popIn then
      letter.pop=math.min(1,math.max((time-self.popIn-self.created)*n*self.popInRate-k+1,0))
      letter.pop=letter.pop*letter.pop
      if k==n and letter.pop>=1 then self.popIn=nil end
    else letter.pop=1 end
    letter.r=0;letter.scale=1
    if self.cfg.rotate then letter.r=(self.cfg.rotate==2 and -1 or 1)*(0.2*(-n/2-0.5+k)/n+motion*0.02*math.sin(2*time+k)) end
    local p=self.pulseState
    if p then
      letter.scale=letter.scale+motion*(1/p.width)*p.amount*math.max(math.min((p.start-time)*p.speed+k+p.width,(time-p.start)*p.speed-k+p.width+2),0)
      letter.r=letter.r+motion*(letter.scale-1)*(0.02*(-n/2-0.5+k))
      if p.start>time+2*p.speed*n then self.pulseState=nil end
    end
    if self.cfg.float then letter.offset=motion*math.sqrt(self.scale)*(2+10*math.sin(2.666*time+200*k))+60*(letter.scale-1) end
    if self.cfg.bump then letter.offset=motion*self.bumpAmount*math.sqrt(self.scale)*7*math.max(0,(5+self.bumpRate)*math.sin(self.bumpRate*time+200*k)-3-self.bumpRate) end
  end
end
function Dyna:visible() return self.letters[#self.letters] and self.letters[#self.letters].pop>0 end
-- Draw centred on (cx,cy). `alpha` multiplies every colour (attention fades).
-- `parallaxX` overrides the room x used for shadow parallax when (cx,cy) are
-- local to a transform.
function Dyna:draw(cx,cy,roomWidth,alpha,parallaxX)
  alpha=alpha or 1
  local font=T.font(200)
  local f=factor(self.scale)
  roomWidth=roomWidth or 1280
  local px=((parallaxX or cx)-roomWidth/2)/(roomWidth/2)*1.5
  local norm=math.sqrt(px*px+2.25)
  g.setFont(font)
  -- text_rot rotates the whole DynaText (its Moveable T.r) about its centre.
  local rot=self.cfg.text_rot or 0
  if rot~=0 then g.push();g.translate(cx,cy);g.rotate(rot);g.translate(-cx,-cy) end
  -- DynaText:init shifts every glyph by the font's TEXT_OFFSET*scale, the
  -- same (10,-20) atlas offset Dyna.static applies. Opt-in here: the HUD and
  -- overlay callers were positioned by hand without it.
  if self.cfg.font_offset then cx,cy=cx+Dyna.OFFSET_X*f,cy+Dyna.OFFSET_Y*f end
  local left=cx-self.W/2+(self.cfg.spacing or 0)*0.3
  if self.shadow then
    local cursor=left
    local sc=self.cfg.shadow_colour
    g.setColor(sc and sc[1] or 0,sc and sc[2] or 0,sc and sc[3] or 0,(sc and sc[4] or 0.3*(self.colours[1][4] or 1))*alpha)
    for _,letter in ipairs(self.letters) do
      local s=f*letter.pop
      g.print(letter.char,cursor+letter.w/2-px*self.scale*3,cy-self.H/2+letter.h/2+1.5*self.scale*3,letter.r,s,s,letter.rawW/2,font:getHeight()*Dyna.HEIGHT_SCALE/2)
      cursor=cursor+letter.w
    end
  end
  local cursor=left
  for k,letter in ipairs(self.letters) do
    local c=self.colours[(k-1)%#self.colours+1]
    g.setColor(c[1],c[2],c[3],(c[4] or 1)*alpha)
    local s=f*letter.pop*letter.scale
    g.print(letter.char,cursor+letter.w/2+px/norm*0.3,cy-self.H/2+letter.h/2-letter.offset*0.15+(-1.5/norm)*0.3,letter.r,s,s,letter.rawW/2,font:getHeight()*Dyna.HEIGHT_SCALE/2)
    cursor=cursor+letter.w
  end
  if rot~=0 then g.pop() end
end
return Dyna
