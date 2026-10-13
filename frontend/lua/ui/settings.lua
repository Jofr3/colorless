-- Layout and controls follow create_UIBox_settings/create_UIBox_generic_options,
-- create_slider and create_toggle. Only settings supported by this home appear.
local T=require('ui.theme')
local Button=require('ui.button')
local Motion=require('ui.motion')
local g=love.graphics
local Settings={}
Settings.__index=Settings
local tabs={'Game','Graphics','Audio'}
local rows={
  {{kind='slider',key='screenshake',label='Screenshake'},
   {kind='toggle',key='reducedMotion',label='Reduced Motion'}},
  {{kind='slider',key='crt',label='CRT'},
   {kind='cycle',key='bloom',label='CRT Bloom'}},
  {{kind='slider',key='volume',label='Master Volume'},
   {kind='slider',key='musicVolume',label='Music Volume'},
   {kind='slider',key='effectsVolume',label='Game Sounds'},
   {kind='toggle',key='muted',label='Mute'}},
}
function Settings.new(preferences,callbacks,reduced,keyboard)
  local self=setmetatable({preferences=preferences,callbacks=callbacks,tab=1,focus=keyboard==false and 0 or 1,hover=0},Settings)
  self.motion=Motion.new(0,reduced and 0 or 10)
  self.motion.T.y=0
  return self
end
function Settings:layout(w,h)
  self.width=w
  self.w,self.h=w<600 and 440 or 780,540
  self.x,self.y=(w-self.w)/2,(h-self.h)/2
  self:build()
end
function Settings:build()
  local narrow=self.width<600
  local tabWidth=narrow and 124 or 150
  local left=self.x+(self.w-(tabWidth*3+24))/2
  self.items={}
  for i,label in ipairs(tabs) do
    self.items[i]={kind='tab',tab=i,label=label,x=left+(i-1)*(tabWidth+12),y=self.y+34,
      w=tabWidth,h=48,fontSize=narrow and 27 or 30,colour=T.red}
  end
  for i,row in ipairs(rows[self.tab]) do
    local item={}
    for k,v in pairs(row) do item[k]=v end
    item.w=(narrow or self.tab~=3) and 240 or 300
    if item.kind=='toggle' then item.w=180 end
    item.x=self.x+(self.w-item.w-56)/2
    item.y=self.y+(self.tab==3 and 134+(i-1)*91 or 180+(i-1)*112)
    item.h=40
    if item.kind=='cycle' then
      -- create_option_cycle: w=4, scale=0.8, at 60 pixels per tile.
      item.w=264; item.h=38.4
      item.x=self.x+(self.w-item.w)/2
    end
    self.items[#self.items+1]=item
  end
  self.items[#self.items+1]={kind='back',label='Back',x=self.x+16,y=self.y+self.h-58,
    w=self.w-32,h=38,fontSize=30,colour=T.orange}
end
function Settings:value(item)
  if item.key=='reducedMotion' then return self.callbacks.reduced() and 1 or 0 end
  return self.preferences[item.key]
end
function Settings:describe(item)
  if item.kind=='tab' then return item.label..' settings' end
  if item.kind=='back' then return 'Back' end
  return item.label..': '..((item.kind=='toggle' or item.kind=='cycle') and (self:value(item)==1 and 'on' or 'off') or self:value(item))
end
function Settings:hit(x,y)
  y=y-self.motion.VT.y*60
  for i,item in ipairs(self.items) do
    local w=item.kind=='slider' and item.w+56 or item.kind=='toggle' and item.w+56 or item.w
    if x>=item.x and x<=item.x+w and y>=item.y and y<=item.y+item.h then
      if item.kind=='cycle' then
        if x<=item.x+28.8 then return i,'left' end
        if x>=item.x+item.w-28.8 then return i,'right' end
      else return i end
    end
  end
  return 0
end
function Settings:change(item,value)
  if self.preferences:set(item.key,value) then self.callbacks.changed() end
end
function Settings:slide(item,x)
  self:change(item,100*(x-item.x)/item.w)
end
function Settings:update(dt,time,mx,my,reduced)
  self.markerTime=reduced and 12 or time
  self.motion:update(dt,time,false,false,reduced)
  self.hover,self.hoverPart=self:hit(mx,my)
  if self.drag then self:slide(self.items[self.drag],mx) end
end
function Settings:activate(index)
  local item=self.items[index]
  if not item then return end
  self.callbacks.feedback()
  if item.kind=='tab' then
    self.tab=item.tab; self:build(); if self.focus>0 then self.focus=index end
    self.callbacks.announce(self:describe(self.items[index]))
  elseif item.kind=='toggle' or item.kind=='cycle' then
    self:change(item,1-self:value(item))
    self.callbacks.announce(self:describe(item))
  elseif item.kind=='back' then self.callbacks.close() end
end
function Settings:mousepressed(x,y)
  self.pressed,self.pressedPart=self:hit(x,y)
  self.focus=0
  local item=self.items[self.pressed]
  if item and item.kind=='slider' then
    self.drag=self.pressed
    self:slide(item,x)
  end
end
function Settings:mousereleased(x,y)
  if self.drag then
    local item=self.items[self.drag]
    self:slide(item,x)
    self.callbacks.feedback()
    self.callbacks.announce(self:describe(item))
  else
    local hit,part=self:hit(x,y)
    if self.pressed and self.pressed==hit and self.pressedPart==part then self:activate(self.pressed) end
  end
  self.drag=nil; self.pressed=nil; self.pressedPart=nil
end
function Settings:keypressed(key)
  if key=='escape' then self.callbacks.feedback(); self.callbacks.close(); return end
  local item=self.items[self.focus]
  if (key=='left' or key=='right' or key=='home' or key=='end') and item and item.kind=='slider' then
    local value=key=='home' and 0 or key=='end' and 100 or self:value(item)+(key=='left' and -5 or 5)
    self:change(item,value)
    self.callbacks.announce(self:describe(item))
  elseif (key=='left' or key=='right') and item and item.kind=='cycle' then
    self:activate(self.focus)
  elseif (key=='left' or key=='right') and item and item.kind=='tab' then
    self:activate((item.tab-1+(key=='left' and -1 or 1))%3+1)
  elseif key=='tab' or key=='down' or key=='up' or key=='left' or key=='right' then
    local backward=key=='up' or key=='left' or (key=='tab' and love.keyboard.isDown('lshift','rshift'))
    self.focus=self.focus==0 and (backward and #self.items or 1)
      or ((self.focus-1+(backward and -1 or 1))%#self.items)+1
    self.callbacks.announce(self:describe(self.items[self.focus]))
  elseif key=='return' or key=='space' then self:activate(self.focus) end
end
function Settings:draw()
  local panel=Button.panel
  g.push(); g.translate(0,self.motion.VT.y*60)
  -- Generic options: JOKER_GREY border, 0.1-tile emboss, L_BLACK interior.
  panel(self.x,self.y+6,self.w,self.h,{0.525,0.546,0.585,1},2.4)
  panel(self.x,self.y,self.w,self.h,{191/255,199/255,213/255,1},2.4)
  panel(self.x+4,self.y+4,self.w-8,self.h-8,T.tray,2.4)
  for i,item in ipairs(self.items) do
    local active=self.hover==i or self.focus==i
    local pressed=self.pressed==i and self.hover==i
    if item.kind=='tab' or item.kind=='back' then
      Button.draw(item,active,pressed,self.focus==i,self.width)
      if item.tab==self.tab then
        Button.chosen(item,self.markerTime or 12,pressed,self.width)
      end
    elseif item.kind=='slider' then
      local value=self:value(item)
      T.text(item.label,30,item.x-28,item.y-34,item.w+112)
      panel(item.x,item.y+10,item.w,24,{0.08,0.12,0.13,1})
      panel(item.x,item.y+7,item.w,24,T.ink)
      if value>0 then
        local fill=item.w*value/100
        panel(item.x,item.y+7,fill,24,T.red,math.min(1.8,fill/8))
      end
      local number={label=tostring(value),x=item.x+item.w+8,y=item.y+7,w=48,h=24,fontSize=21,colour=T.red}
      Button.draw(number,false,false,false,self.width)
    elseif item.kind=='cycle' then
      local x,y=item.x+36,item.y
      T.text(item.label,24,item.x,item.y-32,item.w)
      -- The center is embossed, while only the arrows cast button shadows.
      panel(x,y+6,192,38.4,{T.red[1]*0.7,T.red[2]*0.7,T.red[3]*0.7,1})
      panel(x,y,192,38.4,T.red)
      T.text(self:value(item)==1 and 'On' or 'Off',24,x,y+1,192)
      for pip=0,1 do
        panel(x+90+pip*7.2,y+28,4.8,4.8,self:value(item)==pip and T.white or T.ink,0.6)
      end
      for _,side in ipairs({'left','right'}) do
        local arrow={label=side=='left' and '<' or '>',x=side=='left' and item.x or item.x+item.w-28.8,
          y=y,w=28.8,h=38.4,fontSize=24,colour=T.red}
        Button.draw(arrow,(self.hover==i and self.hoverPart==side) or self.focus==i,
          pressed and self.pressedPart==side and self.hoverPart==side,false,self.width)
      end
    else
      local x=item.x+item.w+12
      T.text(item.label,27,item.x-12,item.y+5,item.w+12,T.white,'right')
      panel(x-2,item.y+1,38,38,{0,0,0,0.3})
      panel(x,item.y,36,36,T.white)
      panel(x+3,item.y+3,30,30,self:value(item)==1 and T.red or T.ink,1.5)
      if self:value(item)==1 then
        g.setColor(T.white); g.setLineWidth(4); g.setLineStyle('rough')
        g.line(x+8,item.y+18,x+15,item.y+25,x+28,item.y+10)
      end
    end
  end
  g.pop()
end
return Settings
