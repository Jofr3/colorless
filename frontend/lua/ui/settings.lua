-- Layout and controls follow create_UIBox_settings/create_UIBox_generic_options,
-- create_slider and create_toggle. Only settings supported by this home appear.
local T=require('ui.theme')
local Controls=require('ui.controls')
local Button=require('ui.button')
local Modal=require('ui.modal')
local Account=require('ui.account')
local Auth=require('ui.auth')
local Input=require('ui.text_input')
local Motion=require('ui.motion')
local g=love.graphics
local Settings={}
Settings.__index=Settings
local tabs={'Game','Graphics','Audio','Account'}
-- Each tab's index in the tab bar, by name.
Settings.tabs={game=1,graphics=2,audio=3,account=4}
local TAB=Settings.tabs
local rows={
  {{kind='slider',key='screenshake',label='Screenshake'},
   {kind='toggle',key='reducedMotion',label='Reduced Motion'}},
  {{kind='slider',key='crt',label='CRT'},
   {kind='cycle',key='bloom',label='CRT Bloom'},
   -- The update and draw cap (main.lua frameCap); `options` names each value, from 0.
   {kind='cycle',key='highFrameRate',label='Max Frame Rate',options={'60 FPS','144 FPS'}}},
  {{kind='slider',key='volume',label='Master Volume'},
   {kind='slider',key='musicVolume',label='Music Volume'},
   {kind='slider',key='effectsVolume',label='Game Sounds'},
   {kind='toggle',key='muted',label='Mute'}},
}
-- The cycle's two arrows and the toggle's emboss, refilled or made once rather than per draw.
local SIDES={'left','right'}
local ARROWS={left={label='<',w=28.8,h=38.4,fontSize=24},right={label='>',w=28.8,h=38.4,fontSize=24}}
local TOGGLE_EMBOSS={[true]={0.5,0.5,0.5,1},[false]={0.7,0.7,0.7,1}}
local DELETE_WARNING='This permanently deletes your account, your decks and your folders. It cannot be undone.'
-- The one-time prompt for an account whose name may have come from its email or Google account
-- (security audit AU3). Saving a name or keeping this one answers it for good; Later asks again
-- on the next visit.
local NAME_PROMPT_TITLE='Choose your public name'
local NAME_PROMPT='Opponents and spectators see this name. It may come from your email or your Google account. Keep it, or choose another.'
function Settings.new(preferences,callbacks,reduced,keyboard,account)
  local self=setmetatable({preferences=preferences,callbacks=callbacks,tab=1,focus=keyboard==false and 0 or 1,hover=0,
    account=account or Account.new(),reduced=reduced,deleteJuice=Motion.new(0,0)},Settings)
  self.motion=Modal.motion(reduced)
  return self
end
function Settings:layout(w,h)
  self.width,self.height=w,h
  local mode=self.auth and self.auth.mode
  -- The tabs are 600 tall for the account tab's four rows of buttons and its message.
  self.w,self.h=w<600 and 440 or 780,mode=='login' and 560 or mode=='register' and 620 or mode=='delete' and 540 or 600
  self.x,self.y=(w-self.w)/2,(h-self.h)/2
  self:build()
end
function Settings:openAuth(mode)
  if self.account.busy then return end
  self.auth=Auth.new(mode)
  self.account.message=''
  self:layout(self.width,self.height)
  self.focus=mode=='register' and 2 or 1
  self.pressed=nil; self.hover=0; self.armed=nil
  self.callbacks.auth('open\t'..self.auth.mode)
  self.callbacks.announce(mode=='register' and 'Create account' or mode=='delete' and 'Delete account. '..DELETE_WARNING or 'Sign in')
end
function Settings:closeAuth()
  local signedIn=self.auth.mode~='delete' and self.account.status=='authenticated'
  self.auth=nil; self.armed=nil
  self.callbacks.auth('close')
  self.tab=TAB.account; self.focus=TAB.account; self.pressed=nil; self.hover=0
  self:layout(self.width,self.height)
  self.callbacks.announce(signedIn and 'Signed in. Account settings.' or 'Account settings')
end
function Settings:accountChanged()
  local a=self.account
  local signedIn=a.status=='authenticated'
  -- The name prompt ends once answered (the server stops asking) or once signed out.
  if self.prompt then
    if signedIn and a.namePrompt then self:build() else self:closePrompt(false,signedIn) end
    return
  end
  -- A sign-in form closes once signed in, the deletion form once the account is gone.
  if self.auth and (self.auth.mode=='delete')~=signedIn then self:closeAuth()
  else self:build() end
  if not self.auth and self.tab==TAB.account and a:shouldPrompt() then self:openNamePrompt(false) end
end
-- `standalone`: Settings opened only to ask, so Later closes Settings rather than showing the
-- account tab.
function Settings:openNamePrompt(standalone)
  local a=self.account
  if self.auth or not a:shouldPrompt() then return end
  if a.editing then self.callbacks.account('finish-edit'); a.editing=false end
  -- Shown once a session per account. The current name is prefilled: this screen is the user's own.
  a.promptedId=a.id; a.draftName=a.name; a.message=''
  self.prompt={standalone=standalone}
  self.tab=TAB.account; self.pressed=nil; self.hover=0; self.armed=nil
  self:layout(self.width,self.height)
  self.focus=self.focus>0 and 1 or 0
  self.callbacks.announce(NAME_PROMPT_TITLE..'. '..NAME_PROMPT..' Current name: '..a.name..'.')
end
-- `close`: Later from a standalone prompt closes Settings. `answered`: the name was saved or kept.
function Settings:closePrompt(close,answered)
  local standalone=self.prompt and self.prompt.standalone
  if self.account.editing then self.callbacks.account('finish-edit'); self.account.editing=false end
  self.prompt=nil
  if close and standalone then self.callbacks.close(); return end
  self.tab=TAB.account; self.pressed=nil; self.hover=0
  if self.focus>0 then self.focus=TAB.account end
  self:layout(self.width,self.height)
  self.callbacks.announce(answered and 'Name saved. Account settings.' or 'Account settings')
end
-- The deletion's second step, after the in-game Leave match (sim_overlay.lua): the first press
-- arms the button for 3 s, and only a press while armed deletes.
function Settings:arm()
  self.armed=self.time or 0
  self.deleteJuice:juice_up(self.armed,0.3,0.1,self.reduced)
  self:build()
  self.callbacks.announce('Press again to delete your account permanently.')
end
function Settings:disarm() if self.armed then self.armed=nil; self:build() end end
-- Returns true when the field's Tab, Shift+Tab or Enter moved or kept keyboard focus.
function Settings:authInput(raw)
  if not self.auth or not self.auth:input(raw) then return false end
  local a=self.auth
  if a.action=='input' then self.account.message='' end
  if a.action~='next' and a.action~='previous' and a.action~='enter' then return false end
  for i,item in ipairs(self.items) do if item.field==a.field then self.focus=i end end
  if a.action=='enter' and (a.field=='name' or (a.field=='password' and a.mode=='login')) then
    self.callbacks.feedback(); self.callbacks.auth('submit'); return true
  end
  local step=a.action=='previous' and -1 or 1
  self.focus=(self.focus-1+step)%#self.items+1
  if self.items[self.focus].kind=='auth-field' then self:activate(self.focus)
  else self.callbacks.announce(self:describe(self.items[self.focus])) end
  return true
end
function Settings:buildDelete()
  local w=math.min(360,self.w-64)
  local x=self.x+(self.w-w)/2
  self.items={}
  local y=250
  -- The server asks for the password, or without one the email typed out; it is never filled in.
  if self.account.hasPassword then
    self.items[1]={kind='auth-field',label='Password',field='password',placeholder='Your password',
      x=x,y=self.y+y,w=w,h=40,fontSize=27,colour=T.red}
  else
    self.items[1]={kind='auth-field',label='Type your email to confirm',field='email',placeholder='Your account email',
      x=x,y=self.y+y,w=w,h=40,fontSize=27,colour=T.red}
  end
  y=y+90
  local label=self.account.busy and 'Please wait...' or self.armed and 'Press again to delete' or 'Delete account'
  self.items[#self.items+1]={kind='delete-confirm',label=label,x=x,y=self.y+y,w=w,h=40,fontSize=27,colour=T.red}
  self.authMessageY=y+52
  self.items[#self.items+1]={kind='auth-back',label='Back',x=self.x+16,y=self.y+self.h-58,
    w=self.w-32,h=38,fontSize=30,colour=T.orange}
end
function Settings:buildAuth()
  local a=self.auth
  if a.mode=='delete' then self:buildDelete(); return end
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
function Settings:buildPrompt()
  local w=math.min(360,self.w-64)
  local x=self.x+(self.w-w)/2
  local function add(kind,label,action,y,width,at,colour)
    self.items[#self.items+1]={kind=kind,label=label,action=action,x=at or x,y=self.y+y,
      w=width or w,h=40,fontSize=27,colour=colour or T.red}
  end
  self.items={}
  add('name','Public name','edit',262)
  add('action',self.account.busy and 'Please wait...' or 'Save name','save',332,w/2-6)
  add('action','Keep name','keep',332,w/2-6,x+w/2+6)
  self.items[#self.items+1]={kind='prompt-later',label='Later',x=self.x+16,y=self.y+self.h-58,
    w=self.w-32,h=38,fontSize=30,colour=T.orange}
  if self.focus>#self.items then self.focus=1 end
end
function Settings:build()
  if self.prompt then self:buildPrompt(); return end
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
    item.w=(narrow or self.tab~=TAB.audio) and 240 or 300
    if item.kind=='toggle' then item.w=180 end
    item.x=self.x+(self.w-item.w-56)/2
    item.y=self.y+(self.tab==TAB.audio and 134+(i-1)*91 or 180+(i-1)*112)
    item.h=40
    if item.kind=='cycle' then
      -- create_option_cycle: w=4, scale=0.8, at 60 pixels per tile.
      item.w=264; item.h=38.4
      item.x=self.x+(self.w-item.w)/2
    end
    self.items[#self.items+1]=item
  end
  if self.tab==TAB.account then
    local a=self.account
    local w=math.min(360,self.w-64)
    local x=self.x+(self.w-w)/2
    local function add(kind,label,action,y,width,at)
      self.items[#self.items+1]={kind=kind,label=label,action=action,x=at or x,y=self.y+y,
        w=width or w,h=40,fontSize=27,colour=T.red}
    end
    if a.status=='authenticated' then
      add('email','Email',nil,150)
      add('name','Display name','edit',240)
      add('action',a.busy and 'Please wait...' or 'Save','save',310,w/2-6)
      add('action','Sign out','logout',310,w/2-6,x+w/2+6)
      -- Ends every session of the account, this browser's too (POST /auth/logout-all).
      add('action','Sign out everywhere','logout-all',370)
      -- Opens the deletion form; nothing is deleted from this tab.
      add('action','Delete account','delete',430)
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
  if item.kind=='delete-confirm' and not self.armed and not self.account.busy then
    return 'Delete account. Asks you to press again.'
  end
  if self.auth then return item.label end
  if item.kind=='tab' then return item.label..' settings' end
  if item.kind=='back' then return 'Back' end
  if item.kind=='action' then return item.label end
  if item.kind=='prompt-later' then return 'Later. Asks again next time.' end
  if item.kind=='name' then return item.label..': '..self.account.draftName..'. Enter to edit.' end
  if item.kind=='email' then return 'Email: '..self.account.email..'. Disabled.' end
  if item.options then return item.label..': '..item.options[self:value(item)+1] end
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
  -- A text caret is not motion, but main.lua's redraw gate skips Settings frames under reduced
  -- motion, so a blinking caret would stop wherever the gate caught it: it holds steady instead.
  self.caretTime=reduced and 12 or time
  self.time,self.reduced=time,reduced
  self.motion:update(dt,time,false,false,reduced)
  self.deleteJuice:update(dt,time,false,false,reduced)
  if self.armed and time-self.armed>3 then self:disarm() end
  self.hover,self.hoverPart=self:hit(mx,my,true)
  if self.drag then self:slide(self.items[self.drag],mx) end
end
-- True when the popup draws the same frame as long as nothing reaches it (main.lua's redraw
-- gate): no slider drag, no armed delete button (it disarms after 3 s), no "Saved." waiting to
-- clear, and its slide-in and juice at rest.
function Settings:still()
  return not self.drag and not self.armed and not self.account.savedRemaining
    and self.motion:still() and self.deleteJuice:still()
end
function Settings:activate(index)
  local item=self.items[index]
  if not item or self:disabled(item) then return end
  local confirm=item.kind=='delete-confirm'
  -- The 0.35 s lockout after arming stops a double click from deleting.
  if confirm and self.armed and (self.time or 0)-self.armed<0.35 then return end
  if not confirm then self:disarm() end
  self.callbacks.feedback()
  if confirm then
    if self.armed then self:disarm(); self.callbacks.auth('submit') else self:arm() end
  elseif item.kind=='tab' then
    if self.account.editing then self.callbacks.account('finish-edit'); self.account.editing=false end
    self.tab=item.tab; self:build(); if self.focus>0 then self.focus=index end
    self.callbacks.announce(self:describe(self.items[index]))
  elseif item.kind=='prompt-later' then self:closePrompt(true,false)
  elseif item.kind=='auth-tab' then self:openAuth(item.mode)
  elseif item.kind=='auth-back' then self:closeAuth()
  elseif item.kind=='auth-field' then
    self.focus=index; self.auth.editing=item.field
    self.callbacks.auth('edit\t'..item.field)
  elseif item.kind=='auth-submit' then self.callbacks.auth('submit')
  elseif item.kind=='auth-google' then self.callbacks.auth('google')
  elseif item.action=='login' or item.action=='delete' then self:openAuth(item.action)
  elseif item.action then
    if item.action=='edit' then self.focus=index end
    self.callbacks.account(self.account:command(item.action))
  elseif item.kind=='toggle' or item.kind=='cycle' then
    self:change(item,1-self:value(item))
    self.callbacks.announce(self:describe(item))
  elseif item.kind=='back' then self.callbacks.close() end
end
function Settings:cancelInteractions() self.drag=nil;self.pressed=nil;self.pressedPart=nil end
function Settings:mousepressed(x,y)
  self.pressed,self.pressedPart=self:hit(x,y)
  self.focus=0
  local item=self.items[self.pressed]
  -- A press anywhere but the armed button disarms it.
  if not item or item.kind~='delete-confirm' then self:disarm() end
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
    if self.prompt then self:closePrompt(true,false)
    elseif self.auth then self:closeAuth() else self.callbacks.close() end
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
    if self.items[self.focus].kind~='delete-confirm' then self:disarm() end
    self.callbacks.announce(self:describe(self.items[self.focus]))
  elseif key=='return' or key=='space' then self:activate(self.focus) end
end
function Settings:draw()
  local panel=Button.panel
  g.push(); g.translate(0,self.motion.VT.y*60)
  Button.modalFrameRaised(self.x,self.y,self.w,self.h)
  if self.prompt then
    T.text(NAME_PROMPT_TITLE,30,self.x+32,self.y+40,self.w-64)
    T.text(NAME_PROMPT,22,self.x+32,self.y+96,self.w-64)
    if self.account.message~='' then
      T.text(self.account.message,17,self.x+28,self.y+392,self.w-56,T.paper)
    end
  elseif self.auth then
    if self.auth.mode=='delete' then
      T.text('Delete account',30,self.x+32,self.y+40,self.w-64)
      T.text(DELETE_WARNING,22,self.x+32,self.y+96,self.w-64)
    end
    if self.account.message~='' then T.text(self.account.message,19,self.x+30,self.y+self.authMessageY,self.w-60,T.paper)
    -- delete_profile's warning_text: hidden until the first press, as on Leave match.
    elseif self.armed then T.text('Press again to delete permanently',19,self.x+30,self.y+self.authMessageY,self.w-60) end
  elseif self.tab==TAB.account then
    local a=self.account
    if a.status~='authenticated' then
      local text=a.busy and 'Checking your session...' or a.status=='error' and 'Account unavailable' or 'Sign in to personalise your profile'
      T.text(text,24,self.x+32,self.y+172,self.w-64)
    end
    if a.message~='' then
      T.text(a.message,17,self.x+28,self.y+488,self.w-56,T.paper)
    end
  end
  for i,item in ipairs(self.items) do
    local active=Controls.lit(self.hover,self.focus,i)
    local pressed=self.pressed==i and self.hover==i
    if item.kind=='tab' or item.kind=='back' or item.kind=='action' or item.kind=='prompt-later' or
      (self.auth and item.kind~='auth-field') then
      local disabled=self:disabled(item)
      local colour=item.colour
      if disabled then item.colour=T.panel end
      local juice=item.kind=='delete-confirm'
      if juice then
        local m=self.deleteJuice
        g.push();g.translate(item.x+item.w/2,item.y+item.h/2);g.rotate(m.VT.r);g.scale(m.VT.scale);g.translate(-item.x-item.w/2,-item.y-item.h/2)
      end
      Button.draw(item,active and not disabled,pressed and not disabled,self.focus==i,self.width)
      if juice then g.pop() end
      item.colour=colour
      if (not self.auth and item.tab==self.tab) or (self.auth and item.mode==self.auth.mode) then
        Button.chosen(item,self.time or 12,pressed,self.width,self.reduced)
      end
    elseif item.kind=='auth-field' then
      local a=self.auth
      Input.draw(item,a[item.field],a.editing==item.field,a.selectionStart,a.selectionEnd,self.caretTime,self.account.busy,active)
    elseif item.kind=='slider' then
      local value=self:value(item)
      T.text(item.label,30,item.x-28,item.y-34,item.w+112)
      Button.slider(item.x,item.y+7,item.w,value/100,tostring(value),active)
    elseif item.kind=='cycle' then
      local x,y=item.x+36,item.y
      local centreWidth=item.w-72
      T.text(item.label,24,item.x,item.y-32,item.w)
      -- The center is embossed, while only the arrows cast button shadows.
      local colour=self:disabled(item) and T.panel or T.red
      local highlighted=not self:disabled(item) and self.hover==i and self.hoverPart=='center'
      local depth=highlighted and 0.5 or 0.7
      panel(x,y+6,centreWidth,38.4,Button.shade(colour,depth))
      panel(x,y,centreWidth,38.4,Button.hoverColour(colour,highlighted))
      local label=item.options and item.options[self:value(item)+1] or self:value(item)==1 and 'On' or 'Off'
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
      for _,side in ipairs(SIDES) do
        local arrow=ARROWS[side]
        arrow.x,arrow.y,arrow.colour=side=='left' and item.x or item.x+item.w-28.8,y,colour
        Button.draw(arrow,(self.hover==i and self.hoverPart==side) or (self.hover==0 and self.focus==i),
          pressed and self.pressedPart==side and self.hoverPart==side,false,self.width)
      end
    elseif item.kind=='name' or item.kind=='email' then
      local disabled=item.kind=='email'
      local editing=not disabled and self.account.editing
      Input.draw(item,disabled and self.account.email or self.account.draftName,editing,
        self.account.selectionStart,self.account.selectionEnd,self.caretTime,disabled,active)
    else
      local x=item.x+item.w+12
      T.text(item.label,27,item.x-12,item.y+5,item.w+12,T.white,'right')
      -- create_toggle: hover tints the fill; the white outline is drawn
      -- afterwards, unchanged. Only its line_emboss darkens (.3 -> .5).
      local hovered=active
      panel(x,item.y+1.5,36,36,TOGGLE_EMBOSS[hovered and true or false])
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
