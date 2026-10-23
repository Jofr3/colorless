local D=require('ui.card_dimensions')
local WheelPager=require('ui.wheel_pager')
-- Shared library elements: text input, collection tray, deck piles/counts and
-- animated red pagination. Player tabs and the sandbox launch remain outside.
local T=require('ui.theme')
local Button=require('ui.button')
local Modal=require('ui.modal')
local Codec=require('ui.codec')
local Fit=require('ui.text_fit')
local PageText=require('ui.page_text')
local Pile=require('ui.deck_pile')
local Labels=require('ui.deck_labels')
local Input=require('ui.text_input')
local Library=require('ui.library')
local g=love.graphics
local Sandbox={}
Sandbox.__index=Sandbox
function Sandbox.new(callbacks)
  return setmetatable({callbacks=callbacks,phase='loading',busy=false,message='',items={},selected={'',''},tab=1,controls={},cards={},query='',editing=false,page=1,pages=1,focus=0,hover=0,time=0,pageText=PageText.new()},Sandbox)
end
function Sandbox:command(...)
  Codec.command(self.callbacks.command,...)
end
function Sandbox:open(reduced)
  self.motion=Modal.motion(reduced); self.focus=0; self.hover=0; self.pressed=nil
  self.query='';self.page=1;self.editing=false;self:makeCards(false);self:build()
  self:command('open')
end
function Sandbox:offset() return self.motion and self.motion.VT.y*60 or 0 end
function Sandbox:deck(seat)
  for _,item in ipairs(self.items) do if item.id==self.selected[seat] then return item end end
end
function Sandbox:canStart()
  if self.phase~='ready' or self.busy then return false end
  for seat=1,2 do local d=self:deck(seat); if not d or d.count~=60 then return false end end
  return true
end
function Sandbox:layout(w,h)
  self.width,self.height,self.portrait=w,h,w<600
  self.w,self.h=self.portrait and w-32 or 866,h-72
  self.x,self.y=(w-self.w)/2,(h-self.h)/2
  self.area={x=self.x+16,y=self.y+146,w=self.w-32,h=self.h-330}
  self.size=self.portrait and 4 or 10
  self.pressed=nil;self:makeCards(false);self:build()
end
function Sandbox:makeCards(entering)
  if not self.area then return end
  for _,card in ipairs(self.cards) do card.texture:release() end
  self.cards={}
  local matches={}
  local q=self.query:lower():match('^%s*(.-)%s*$')
  for _,item in ipairs(self.items) do if q=='' or item.name:lower():find(q,1,true) then matches[#matches+1]=item end end
  self.pages=math.max(1,math.ceil(#matches/self.size));self.page=math.max(1,math.min(self.pages,self.page))
  self.pageText:set('Page '..self.page..'/'..self.pages,self.time)
  local cols=self.portrait and 2 or 5
  local a=self.area
  local scale=math.min(0.82,(a.h/2-84)/D.H)
  for i=(self.page-1)*self.size+1,math.min(#matches,self.page*self.size) do
    local item=matches[i]
    item.drawFace=function(w,h) Library.face(self,item,w,h) end
    local card=Pile.new(item,i)
    local index=#self.cards
    card:place(a.x+a.w/cols*(index%cols+0.5),a.y+50+D.HALF_H*scale+math.floor(index/cols)*a.h/2,scale,false,self.width)
    card.bounds={x=a.x+(index%cols)*a.w/cols+6,y=a.y+math.floor(index/cols)*a.h/2+4,w=a.w/cols-12,h=a.h/2-8}
    card:collect(cols,index%cols,self.width/2,entering,self.time,self.reduced,self.width)
    self.cards[#self.cards+1]=card
  end
end
function Sandbox:add(label,x,y,w,h,action,colour,disabled)
  local b={label=label,x=x,y=y,w=w,h=h,action=action,colour=disabled and T.panel or colour,fontSize=26,disabled=disabled}
  self.controls[#self.controls+1]=b;return b
end
function Sandbox:build()
  if not self.width then return end
  self.controls={}
  local x,y,w,h=self.x,self.y,self.w,self.h
  local tw=self.portrait and 148 or 180
  for i=1,2 do self:add('Player '..i,self.width/2-tw-6+(i-1)*(tw+12),y+24,tw,48,'tab'..i,T.red,self.busy) end
  if self.phase=='ready' then
    local field=self:add('',x+16,y+90,w-32,42,'search',T.ink,self.busy)
    field.input=true;field.placeholder='Search decks'
    for i,card in ipairs(self.cards) do
      local bounds=card.bounds
      local b=self:add(card.item.name,bounds.x,bounds.y,bounds.w,bounds.h,'card',nil,self.busy)
      b.card=i
    end
    self:add('<',self.width/2-157,y+h-170,32,36,'previous',T.red,self.busy)
    self:add('>',self.width/2+125,y+h-170,32,36,'next',T.red,self.busy)
    if #self.items==0 then self:add('Create a deck',x+w/2-140,y+310,280,44,'decks',T.blue,false) end
  elseif self.phase=='anonymous' or self.phase=='error' then
    self:add(self.phase=='anonymous' and 'Sign in' or 'Try again',x+w/2-140,y+310,280,48,self.phase=='anonymous' and 'signin' or 'refresh',T.red,false)
  end
  self:add(self.busy and self.phase=='ready' and 'Preparing...' or 'Play',x+16,y+h-100,w-32,40,'start',T.blue,not self:canStart())
  self:add('Back',x+16,y+h-48,w-32,36,'home',T.orange,false)
end
function Sandbox:sync(raw)
  if not raw or raw==self.raw then return end
  self.raw=raw
  local rows=Codec.rows(raw)
  local f=rows[1];if not f or #f<6 then return end
  self.phase,self.busy,self.message=f[2],f[3]=='1',f[4]
  if self.phase~='ready' and self.editing then self:command('finish-input');self.editing=false end
  self.selected={f[5],f[6]};self.items={}
  local signature={}
  for i=2,#rows do local r=rows[i];if r[1]=='D' then
    self.items[#self.items+1]={id=r[2],name=r[3],count=tonumber(r[4]) or 0}
    signature[#signature+1]=table.concat(r,'\t')
  end end
  signature=table.concat(signature,'\n')
  if signature~=self.signature then self.signature=signature;self:makeCards(true);self.focus=0;self.pressed=nil end
  self:build()
  if self.message~='' and self.message~=self.announced then self.callbacks.announce(self.message) end
  self.announced=self.message
end
function Sandbox:input(raw)
  if not raw or raw==self.inputRaw then return end
  self.inputRaw=raw
  local f=Codec.fields(raw);if #f<6 or f[2]~='search' then return end
  self.editing=f[6]=='input';self.first,self.last=tonumber(f[4]),tonumber(f[5])
  if self.query~=f[3] then self.query=f[3];self.page=1;self:makeCards(true);self:build();self.pressed=nil;self.focus=0 end
end
function Sandbox:hit(x,y)
  y=y-self:offset()
  for i,b in ipairs(self.controls) do
    if not b.disabled and Button.hit(b,x,y) then return i end
  end
  return 0
end
function Sandbox:update(dt,time,mx,my,reduced)
  self.time,self.reduced=time,reduced
  if love.filesystem.getInfo('__sandbox.txt') then self:sync(love.filesystem.read('__sandbox.txt')) end
  if love.filesystem.getInfo('__sandbox_input.txt') then self:input(love.filesystem.read('__sandbox_input.txt')) end
  if self.motion then self.motion:update(dt,time,false,false,reduced) end
  self.mx,self.my=mx,my-self:offset();self.hover=self:hit(mx,my)
  for i,card in ipairs(self.cards) do
    local active=not self.busy and ((self.controls[self.hover] or {}).card==i or (self.controls[self.focus] or {}).card==i)
    if active and not card.hovered then
      if not card.motion.juice then card:juiceUp(time,0.05,0.03,reduced) end
      self.callbacks.feedback('paper1')
    end
    card:update(dt,time,active,reduced,self.width)
  end
end
function Sandbox:changePage(delta)
  if self.busy or self.phase~='ready' then return end
  self.page=(self.page-1+delta+self.pages)%self.pages+1;self:makeCards(true);self:build();self.focus=0;self.pressed=nil
end
function Sandbox:leave(action)
  self:command('finish-input');self.editing=false;self:command('close');self.callbacks[action]()
end
function Sandbox:activate(i)
  local b=self.controls[i];if not b or b.disabled then return end
  self.callbacks.feedback('button')
  local a=b.action
  if a=='search' then self.editing=true;self:command('input','search',self.query);return end
  self:command('finish-input');self.editing=false
  if a=='tab1' or a=='tab2' then
    local tab=a=='tab1' and 1 or 2
    if tab~=self.tab then self.tab=tab;self:makeCards(true) end
    self:build();self.callbacks.announce('Player '..self.tab..'. '..(self:deck(self.tab) and self:deck(self.tab).name or 'Choose a deck'))
  elseif a=='card' then
    local card=self.cards[b.card]
    card:click(self.time,self.reduced)
    local d=card.item
    self:command('select',self.tab,d.id);self.callbacks.announce('Player '..self.tab..': '..d.name)
  elseif a=='previous' or a=='next' then self:changePage(a=='previous' and -1 or 1)
  elseif a=='home' or a=='decks' then self:leave(a)
  elseif a=='signin' then self.callbacks.signin()
  elseif a=='refresh' then self.callbacks.refresh();self:command('refresh')
  elseif a=='start' then self:command('start');self.busy=true;self:build() end
end
function Sandbox:mousepressed(x,y) self.focus=0;self.pressed=self:hit(x,y) end
function Sandbox:mousereleased(x,y)
  if self.pressed and self.pressed==self:hit(x,y) then self:activate(self.pressed) end
  self.pressed=nil
end
function Sandbox:keypressed(key)
  if key=='escape' then self:leave('home');return end
  if key=='tab' or key=='up' or key=='down' or key=='left' or key=='right' then
    local direction=(key=='up' or key=='left' or (key=='tab' and love.keyboard.isDown('lshift','rshift'))) and -1 or 1
    for _=1,#self.controls do
      self.focus=(self.focus-1+direction)%#self.controls+1
      if not self.controls[self.focus].disabled then self.callbacks.announce(self.controls[self.focus].label~='' and self.controls[self.focus].label or 'Search decks');break end
    end
  elseif key=='pageup' or key=='pagedown' then self:changePage(key=='pageup' and -1 or 1)
  elseif key=='return' or key=='space' then self:activate(self.focus) end
end
function Sandbox:wheelmoved(y) if y~=0 and not self.editing and WheelPager.ready(self) then self:changePage(y>0 and -1 or 1) end end
function Sandbox:draw()
  local x,y,w,h=self.x,self.y,self.w,self.h
  Button.panel(x,y+6,w,h,{0.525,0.546,0.585,1},2.4)
  Button.panel(x,y,w,h,{191/255,199/255,213/255,1},2.4)
  Button.panel(x+4,y+4,w-8,h-8,T.tray,2.4)
  if self.phase=='ready' then
    local a=self.area
    Button.panel(a.x,a.y+3,a.w,a.h,{T.panel[1]*0.7,T.panel[2]*0.7,T.panel[3]*0.7,1})
    Button.panel(a.x,a.y,a.w,a.h,T.panel)
    for _,card in ipairs(self.cards) do
      card:draw()
      local bottom=Labels.drawCounter(card)
      local tx,ty=card:target(1,self.width,Pile.parallax())
      local titleX,titleY=tx-D.HALF_W*card.baseScale-6,ty-D.HALF_H*card.baseScale-32
      local titleWidth=D.W*card.baseScale+12
      if card.item.id==self.selected[self.tab] then
        local left=math.min(titleX,card.homeX-D.HALF_W*card.baseScale)-5
        local right=math.max(titleX+titleWidth,card.homeX+78.1*card.baseScale)+5
        g.push('all');g.setLineWidth(1.5)
        Button.outline(left,titleY-5,right-left,bottom-titleY+10,T.white,1.2)
        g.pop()
      end
      local text,size=Fit.fit(card.item.name,22,titleWidth)
      T.text(text,size,titleX,titleY,titleWidth,T.white)
    end
    if #self.cards==0 then T.text(#self.items==0 and 'No valid decks' or 'No matches',32,a.x,a.y+80,a.w) end
    local px,py=self.width/2-119,y+h-170
    Button.cycleFace(px,py,238,36,Button.hit({x=px,y=py,w=238,h=36},self.mx or -1,self.my or -1))
    self.pageText:draw(self.time,self.reduced,px,py,238,36,self.width,0.4)
  else
    local text=self.phase=='loading' and 'Loading your decks...' or self.phase=='anonymous' and 'Sign in to choose your decks' or 'Could not load your decks'
    T.text(text,self.portrait and 27 or 32,x+24,y+220,w-48)
  end
  local message=self.message
  if message=='' and self.phase=='ready' then
    for seat=1,2 do local d=self:deck(seat);if d and d.count~=60 then message='Player '..seat..': choose a 60-card deck.';break end end
  end
  if message~='' then local text,size=Fit.fit(message,18,w-40);T.text(text,size,x+20,y+h-124,w-40,T.red) end
  for i,b in ipairs(self.controls) do
    if b.input then Input.draw(b,self.query,self.editing,self.first,self.last,self.time,b.disabled,self.hover==i)
    elseif not b.card then Button.draw(b,not b.disabled and (self.hover==i or self.focus==i),self.pressed==i,false,self.width) end
    if b.action=='tab'..self.tab then Button.chosen(b,self.time,self.pressed==i,self.width) end
  end
end
return Sandbox
