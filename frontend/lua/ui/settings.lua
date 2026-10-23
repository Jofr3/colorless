-- Layout and controls follow create_UIBox_settings/create_UIBox_generic_options,
-- create_slider and create_toggle. Only settings supported by this home appear.
local T=require('ui.theme')
local Controls=require('ui.controls')
local Button=require('ui.button')
local Modal=require('ui.modal')
local Account=require('ui.account')
local Auth=require('ui.auth')
local Input=require('ui.text_input')
local g=love.graphics
local Settings={}
Settings.__index=Settings
local tabs={'Game','Graphics','Audio','Account'}
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
function Settings.new(preferences,callbacks,reduced,keyboard,account)
  local self=setmetatable({preferences=preferences,callbacks=callbacks,tab=1,focus=keyboard==false and 0 or 1,hover=0,
    account=account or Account.new()},Settings)
  self.motion=Modal.motion(reduced)
  return self
end
function Settings:layout(w,h)
  self.width,self.height=w,h
  self.w,self.h=w<600 and 440 or 780,self.auth and (self.auth.mode=='login' and 560 or 620) or 540
  self.x,self.y=(w-self.w)/2,(h-self.h)/2
  self:build()
end
function Settings:openAuth(mode)
  if self.account.busy then return end
  self.auth=Auth.new(mode)
  self.account.message=''
  self:layout(self.width,self.height)
  self.focus=mode=='register' and 2 or 1
  self.pressed=nil; self.hover=0
  self.callbacks.auth('open\t'..self.auth.mode)
  self.callbacks.announce(mode=='register' and 'Create account' or 'Sign in')
end
function Settings:closeAuth()
  self.auth=nil
  self.callbacks.auth('close')
  self.tab=4; self.focus=4; self.pressed=nil; self.hover=0
  self:layout(self.width,self.height)
  self.callbacks.announce(self.account.status=='authenticated' and 'Signed in. Account settings.' or 'Account settings')
end
function Settings:accountChanged()
  if self.auth and self.account.status=='authenticated' then self:closeAuth()
  else self:build() end
end
function Settings:authInput(raw)
  if not self.auth or not self.auth:input(raw) then return end
  local a=self.auth
  if a.action=='input' then self.account.message='' end
  if a.action~='next' and a.action~='previous' and a.action~='enter' then return end
  for i,item in ipairs(self.items) do if item.field==a.field then self.focus=i end end
  if a.action=='enter' and (a.field=='name' or (a.field=='password' and a.mode=='login')) then
    self.callbacks.feedback(); self.callbacks.auth('submit'); return
  end
  local step=a.action=='previous' and -1 or 1
  self.focus=(self.focus-1+step)%#self.items+1
  if self.items[self.focus].kind=='auth-field' then self:activate(self.focus)
  else self.callbacks.announce(self:describe(self.items[self.focus])) end
end
function Settings:buildAuth()
  local a=self.auth
  local tabWidth=self.width<600 and 168 or 210
  local left=self.x+(self.w-2*tabWidth-12)/2
  self.items={}
  for i,mode in ipairs({'login','register'}) do
    self.items[i]={kind='auth-tab',mode=mode,label=mode=='login' and 'Sign in' or 'Create account',
      x=left+(i-1)*(tabWidth+12),y=self.y+34,w=tabWidth,h=48,fontSize=self.width<600 and 24 or 27,colour=T.red}
  end
  local w=math.min(360,self.w-64)
  local x=self.x+(self.w-w)/2
  local function add(kind,label,field,y,colour)
    self.items[#self.items+1]={kind=kind,label=label,field=field,x=x,y=self.y+y,w=w,h=40,fontSize=27,colour=colour or T.red}
  end
  local start=a.mode=='register' and 135 or 175
  add('auth-field','Email','email',start)
  self.items[#self.items].placeholder='you@example.com'
  add('auth-field','Password','password',start+90)
  self.items[#self.items].placeholder=a.mode=='register' and 'At least 8 characters' or 'Your password'
  if a.mode=='register' then
    add('auth-field','Display name (optional)','name',start+180)
    self.items[#self.items].placeholder='Your name'
  end
  local submitY=a.mode=='register' and 398 or 338
  self.authMessageY=submitY+52
  add('auth-submit',self.account.busy and 'Please wait...' or (a.mode=='register' and 'Create account' or 'Sign in'),nil,submitY)
  add('auth-google','Continue with Google',nil,submitY+90,T.blue)
  self.items[#self.items+1]={kind='auth-back',label='Back',x=self.x+16,y=self.y+self.h-58,
    w=self.w-32,h=38,fontSize=30,colour=T.orange}
end
function Settings:build()
  if self.auth then self:buildAuth(); return end
  local narrow=self.width<600
  local tabWidth=narrow and 94 or 150
  local gap=narrow and 8 or 12
  local left=self.x+(self.w-(tabWidth*#tabs+gap*(#tabs-1)))/2
  self.items={}
  for i,label in ipairs(tabs) do
    self.items[i]={kind='tab',tab=i,label=label,x=left+(i-1)*(tabWidth+gap),y=self.y+34,
      w=tabWidth,h=48,fontSize=narrow and 22 or 30,colour=T.red}
  end
  for i,row in ipairs(rows[self.tab] or {}) do
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
  if self.tab==4 then
    local a=self.account
    local w=math.min(360,self.w-64)
    local x=self.x+(self.w-w)/2
    local function add(kind,label,action,y,width,at)
      self.items[#self.items+1]={kind=kind,label=label,action=action,x=at or x,y=self.y+y,
        w=width or w,h=40,fontSize=27,colour=T.red}
    end
    if a.status=='authenticated' then
      add('email','Email',nil,163)
      add('name','Display name','edit',263)
      add('action',a.busy and 'Please wait...' or 'Save','save',345,w/2-6)
      add('action','Sign out','logout',345,w/2-6,x+w/2+6)
    elseif not a.busy then
      add('action',a.status=='error' and 'Retry' or 'Sign in',a.status=='error' and 'refresh' or 'login',245,240,self.x+(self.w-240)/2)
    end
  end
  self.items[#self.items+1]={kind='back',label='Back',x=self.x+16,y=self.y+self.h-58,
    w=self.w-32,h=38,fontSize=30,colour=T.orange}
  if self.focus>#self.items then self.focus=1 end
end
function Settings:disabled(item)
  if self.auth then return self.account.busy and item.kind~='auth-back' end
  if item.kind=='email' then return true end
  if item.action=='save' then return not self.account:canSave() end
  return item.action and self.account.busy or false
end
function Settings:value(item)
  if item.key=='reducedMotion' then return self.callbacks.reduced() and 1 or 0 end
  return self.preferences[item.key]
end
function Settings:describe(item)
  if item.kind=='auth-field' then
    return item.label..(item.field=='password' and '. Enter to edit.' or ': '..self.auth[item.field]..'. Enter to edit.')
  end
  if self.auth then return item.label end
  if item.kind=='tab' then return item.label..' settings' end
  if item.kind=='back' then return 'Back' end
  if item.kind=='action' then return item.label end
  if item.kind=='name' then return 'Display name: '..self.account.draftName..'. Enter to edit.' end
  if item.kind=='email' then return 'Email: '..self.account.email..'. Disabled.' end
  return item.label..': '..((item.kind=='toggle' or item.kind=='cycle') and (self:value(item)==1 and 'on' or 'off') or self:value(item))
end
function Settings:hit(x,y,hoverOnly)
  y=y-self.motion.VT.y*60
  for i,item in ipairs(self.items) do
    local w=item.kind=='slider' and item.w+56 or item.kind=='toggle' and item.w+56 or item.w
    if not self:disabled(item) and x>=item.x and x<=item.x+w and y>=item.y and y<=item.y+item.h then
      if item.kind=='cycle' then
        if x<=item.x+28.8 then return i,'left' end
        if x>=item.x+item.w-28.8 then return i,'right' end
        if hoverOnly then return i,'center' end
      elseif hoverOnly and item.kind=='slider' then
        if x<=item.x+item.w and y>=item.y+7 and y<=item.y+31 then return i end
      elseif hoverOnly and item.kind=='toggle' then
        if x>=item.x+item.w+12 and x<=item.x+item.w+48 and y<=item.y+36 then return i end
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
  self.hover,self.hoverPart=self:hit(mx,my,true)
  if self.drag then self:slide(self.items[self.drag],mx) end
end
function Settings:activate(index)
  local item=self.items[index]
  if not item or self:disabled(item) then return end
  self.callbacks.feedback()
  if item.kind=='tab' then
    if self.account.editing then self.callbacks.account('finish-edit'); self.account.editing=false end
    self.tab=item.tab; self:build(); if self.focus>0 then self.focus=index end
    self.callbacks.announce(self:describe(self.items[index]))
  elseif item.kind=='auth-tab' then self:openAuth(item.mode)
  elseif item.kind=='auth-back' then self:closeAuth()
  elseif item.kind=='auth-field' then
    self.focus=index; self.auth.editing=item.field
    self.callbacks.auth('edit\t'..item.field)
  elseif item.kind=='auth-submit' then self.callbacks.auth('submit')
  elseif item.kind=='auth-google' then self.callbacks.auth('google')
  elseif item.action=='login' then self:openAuth('login')
  elseif item.action then
    if item.action=='edit' then self.focus=index end
    self.callbacks.account(self.account:command(item.action))
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
    if self.pressed and self.pressed==hit and self.pressedPart==part then self:activate(self.pressed,part=='left' and -1 or 1) end
  end
  self.drag=nil; self.pressed=nil; self.pressedPart=nil
end
function Settings:keypressed(key)
  if self.auth and self.auth.editing~='' then return end
  if self.account.editing then return end
  if key=='escape' then
    self.callbacks.feedback()
    if self.auth then self:closeAuth() else self.callbacks.close() end
    return
  end
  local item=self.items[self.focus]
  if (key=='left' or key=='right' or key=='home' or key=='end') and item and item.kind=='slider' then
    local value=key=='home' and 0 or key=='end' and 100 or self:value(item)+(key=='left' and -5 or 5)
    self:change(item,value)
    self.callbacks.announce(self:describe(item))
  elseif (key=='left' or key=='right') and item and item.kind=='cycle' then
    self:activate(self.focus,key=='left' and -1 or 1)
  elseif (key=='left' or key=='right') and item and item.kind=='auth-tab' then
    self:activate(item.mode=='login' and 2 or 1)
  elseif (key=='left' or key=='right') and item and item.kind=='tab' then
    self:activate((item.tab-1+(key=='left' and -1 or 1))%#tabs+1)
  elseif key=='tab' or key=='down' or key=='up' or key=='left' or key=='right' then
    local backward=Controls.backward(key)
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
  Button.modalFrame(self.x,self.y,self.w,self.h)
  panel(self.x+4,self.y+4,self.w-8,self.h-8,T.tray,2.4)
  if self.auth then
    if self.account.message~='' then T.text(self.account.message,19,self.x+30,self.y+self.authMessageY,self.w-60,T.paper) end
  elseif self.tab==4 then
    local a=self.account
    if a.status~='authenticated' then
      local text=a.busy and 'Checking your session...' or a.status=='error' and 'Account unavailable' or 'Sign in to personalise your profile'
      T.text(text,24,self.x+32,self.y+172,self.w-64)
    end
    if a.message~='' then
      T.text(a.message,17,self.x+28,self.y+410,self.w-56,T.paper)
    end
  end
  for i,item in ipairs(self.items) do
    local active=self.hover==i or self.focus==i
    local pressed=self.pressed==i and self.hover==i
    if item.kind=='tab' or item.kind=='back' or item.kind=='action' or
      (self.auth and item.kind~='auth-field') then
      local disabled=self:disabled(item)
      local colour=item.colour
      if disabled then item.colour=T.panel end
      Button.draw(item,active and not disabled,pressed and not disabled,self.focus==i,self.width)
      item.colour=colour
      if (not self.auth and item.tab==self.tab) or (self.auth and item.mode==self.auth.mode) then
        Button.chosen(item,self.markerTime or 12,pressed,self.width)
      end
    elseif item.kind=='auth-field' then
      local a=self.auth
      Input.draw(item,a[item.field],a.editing==item.field,a.selectionStart,a.selectionEnd,self.markerTime,self.account.busy,self.hover==i)
    elseif item.kind=='slider' then
      local highlighted=self.hover==i
      local value=self:value(item)
      T.text(item.label,30,item.x-28,item.y-34,item.w+112)
      Button.slider(item.x,item.y+7,item.w,value/100,tostring(value),highlighted)
    elseif item.kind=='cycle' then
      local x,y=item.x+36,item.y
      local centreWidth=item.w-72
      T.text(item.label,24,item.x,item.y-32,item.w)
      -- The center is embossed, while only the arrows cast button shadows.
      local colour=self:disabled(item) and T.panel or T.red
      local highlighted=not self:disabled(item) and self.hover==i and self.hoverPart=='center'
      local depth=highlighted and 0.5 or 0.7
      panel(x,y+6,centreWidth,38.4,{colour[1]*depth,colour[2]*depth,colour[3]*depth,1})
      panel(x,y,centreWidth,38.4,Button.hoverColour(colour,highlighted))
      local label=self:value(item)==1 and 'On' or 'Off'
      local size=24
      while size>12 and T.font(size):getWidth(label)>centreWidth-12 do size=size-1 end
      local textScale=math.min(1,(centreWidth-12)/math.max(1,T.font(size):getWidth(label)))
      g.push(); g.translate(x,y+1); g.scale(textScale,1)
      T.text(label,size,0,0,centreWidth/textScale)
      g.pop()
      local count,index=2,self:value(item)
      for pip=0,count-1 do
        panel(x+(centreWidth-(count*7.2-2.4))/2+pip*7.2,y+28,4.8,4.8,index==pip and T.white or T.ink,0.6)
      end
      for _,side in ipairs({'left','right'}) do
        local arrow={label=side=='left' and '<' or '>',x=side=='left' and item.x or item.x+item.w-28.8,
          y=y,w=28.8,h=38.4,fontSize=24,colour=colour}
        Button.draw(arrow,(self.hover==i and self.hoverPart==side) or self.focus==i,
          pressed and self.pressedPart==side and self.hoverPart==side,false,self.width)
      end
    elseif item.kind=='name' or item.kind=='email' then
      local disabled=item.kind=='email'
      local editing=not disabled and self.account.editing
      Input.draw(item,disabled and self.account.email or self.account.draftName,editing,
        self.account.selectionStart,self.account.selectionEnd,self.markerTime,disabled,self.hover==i)
    else
      local x=item.x+item.w+12
      T.text(item.label,27,item.x-12,item.y+5,item.w+12,T.white,'right')
      -- create_toggle: hover tints the fill; the white outline is drawn
      -- afterwards, unchanged. Only its line_emboss darkens (.3 -> .5).
      local hovered=self.hover==i
      local depth=hovered and 0.5 or 0.7
      panel(x,item.y+1.5,36,36,{depth,depth,depth,1})
      panel(x,item.y,36,36,T.white)
      panel(x+3,item.y+3,30,30,Button.hoverColour(self:value(item)==1 and T.red or T.panel,hovered),1.5)
      if self:value(item)==1 then
        g.setColor(T.white); g.setLineWidth(4); g.setLineStyle('rough')
        g.line(x+8,item.y+18,x+15,item.y+25,x+28,item.y+10)
      end
    end
  end
  g.pop()
end
return Settings
