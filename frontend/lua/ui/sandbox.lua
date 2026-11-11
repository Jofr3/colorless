local D=require('ui.card_dimensions')
local WheelPager=require('ui.wheel_pager')
-- Shared library elements: text input, collection tray, deck piles/counts and
-- animated red pagination. Player tabs and the sandbox launch remain outside.
local T=require('ui.theme')
local Controls=require('ui.controls')
local Button=require('ui.button')
local Modal=require('ui.modal')
local Codec=require('ui.codec')
local TextRecord=require('ui.text_record')
local W=require('ui.wire_fields').sandbox
local Mailbox=require('ui.mailbox')
local PageText=require('ui.page_text')
local Input=require('ui.text_input')
local DeckGrid=require('ui.deck_grid')
local DeckPicker=require('ui.deck_picker')
local Limits=require('ui.limits')
local Sandbox={}
Sandbox.__index=Sandbox
local NO_DECKS='No valid decks. Create a deck to play.'
local NOT_READY=' a deck needs exactly '..Limits.deckSize..' cards and a Basic Pokémon.'
function Sandbox.new(callbacks)
  return setmetatable({callbacks=callbacks,phase='loading',busy=false,message='',items={},selected={'',''},tab=1,controls={},cards={},query='',editing=false,page=1,pages=1,focus=0,hover=0,time=0,pageText=PageText.new()},Sandbox)
end
function Sandbox:command(...)
  Codec.command(self.callbacks.command,...)
end
function Sandbox:open(reduced)
  self.motion=Modal.motion(reduced); self.focus=0; self.hover=0; self.pressed=nil
  self.query='';self.page=1;self.editing=false;self:makeCards(false);self:build()
  self.opening=true
  self:command('open')
end
function Sandbox:offset() return self.motion and self.motion.VT.y*60 or 0 end
-- The search's box while a text proxy edits it, for main.lua to hand the page.
function Sandbox:editBox()
  if not self.editing then return end
  for _,b in ipairs(self.controls) do if b.input then return b.x,b.y,b.w,b.h end end
end
function Sandbox:deck(seat)
  for _,item in ipairs(self.items) do if item.id==self.selected[seat] then return item end end
end
function Sandbox:canStart()
  if self.phase~='ready' or self.busy then return false end
  for seat=1,2 do local d=self:deck(seat); if not d or d.count~=Limits.deckSize then return false end end
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
  DeckGrid.release(self)
  DeckGrid.fill(self,DeckPicker.matches(self.items,self.query),self.size,self.portrait and 2 or 5,math.min(0.82,(self.area.h/2-84)/D.H),entering)
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
    DeckPicker.arrows(self,y+h-170,function(label,ax,ay,aw,ah,dir)
      return self:add(label,ax,ay,aw,ah,dir<0 and 'previous' or 'next',T.red,self.busy)
    end)
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
  local H,K=W.header,W.deck
  local f=rows[1];if not f or #f<H.second then return end
  local was=self.phase
  self.phase,self.busy,self.message=f[H.phase],f[H.busy]=='1',f[H.message]
  self.hidden=tonumber(f[H.hidden]) or 0
  if self.phase~='ready' and self.editing then self:command('finish-input');self.editing=false end
  self.selected={f[H.first],f[H.second]};self.items={}
  local signature={}
  for i=2,#rows do local r=rows[i];if r[1]=='D' then
    self.items[#self.items+1]={id=r[K.id],name=r[K.name],count=tonumber(r[K.count]) or 0}
    signature[#signature+1]=table.concat(r,'\t')
  end end
  signature=table.concat(signature,'\n')
  if signature~=self.signature then self.signature=signature;self:makeCards(true);self.focus=0;self.pressed=nil end
  self:build()
  local say={}
  -- The empty state is said when the chooser opens on it or comes to it, and again when its
  -- reason changes, as the other states are.
  local empty=self.phase=='ready' and #self.items==0 and self:emptyState() or nil
  if self.opening or self.phase~=was then say[1]=self:summary();self.opening=nil
  elseif empty and empty~=self.saidEmpty then say[1]=empty end
  self.saidEmpty=empty
  if self.message~='' and self.message~=self.announced then say[#say+1]=self.message end
  self.announced=self.message
  if #say>0 then self.callbacks.announce(table.concat(say,' ')) end
end
-- Why the chooser has no decks when the user has some: how many it leaves out, and what a game
-- needs from a deck. Nil when the user has none.
function Sandbox:emptyNote()
  local n=self.hidden or 0
  if n<1 then return nil end
  return n..(n==1 and ' of your decks isn\'t ready:' or ' of your decks aren\'t ready:')..NOT_READY
end
function Sandbox:emptyState()
  local note=self:emptyNote()
  return note and 'No valid decks. '..note or NO_DECKS
end
local function seatDeck(self,seat) local d=self:deck(seat);return d and d.name or 'no deck' end
-- What the chooser says when it opens or its phase changes.
function Sandbox:summary()
  local state
  if self.phase=='loading' then state='Loading your decks.'
  elseif self.phase=='anonymous' then state='Sign in to choose your decks.'
  elseif self.phase~='ready' then state='Could not load your decks.'
  elseif #self.items==0 then state=self:emptyState()
  else
    state=#self.items..(#self.items==1 and ' deck.' or ' decks.')..' Player 1: '..seatDeck(self,1)..'. Player 2: '..seatDeck(self,2)..'.'
  end
  return 'Sandbox. '..state
end
-- What a focused control says: its label, the value it shows, and what it acts on.
function Sandbox:describe(b)
  if b.input then return 'Search decks: '..(self.query~='' and self.query or 'empty')..'. Enter to edit.' end
  if b.speech then return b.speech end
  local seat=b.action=='tab1' and 1 or b.action=='tab2' and 2
  if seat then return 'Player '..seat..' tab'..(self.tab==seat and ', selected' or '')..'. '..seatDeck(self,seat) end
  if b.card then
    local d=self.cards[b.card].item
    local chosen=''
    for i=1,2 do if self.selected[i]==d.id then chosen=chosen..', selected for Player '..i end end
    return d.name..chosen..', '..d.count..(d.count==1 and ' card' or ' cards')
  end
  return b.label
end
function Sandbox:input(raw)
  local r=TextRecord.read(self,raw);if not r or r.field~='search' then return end
  self.editing=r.action=='input';self.first,self.last=r.selectionStart,r.selectionEnd
  if self.query~=r.value then
    local had=#self.cards>0
    self.query=r.value;self.page=1;self:makeCards(true);self:build();self.pressed=nil;self.focus=0
    if had~=(#self.cards>0) and #self.items>0 then self.callbacks.announce(had and 'No matches' or #self.cards..' decks shown') end
  end
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
  self:sync(Mailbox.read('sandbox'))
  self:input(Mailbox.read('sandboxInput'))
  if self.motion then self.motion:update(dt,time,false,false,reduced) end
  self.mx,self.my=mx,my-self:offset();self.hover=self:hit(mx,my)
  DeckPicker.update(self,self.controls,dt,time,reduced,not self.busy)
end
function Sandbox:changePage(delta)
  if self.busy or self.phase~='ready' then return end
  DeckPicker.turn(self,delta)
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
function Sandbox:cancelInteractions() self.pressed=nil end
function Sandbox:mousepressed(x,y) self.focus=0;self.pressed=self:hit(x,y) end
function Sandbox:mousereleased(x,y)
  if self.pressed and self.pressed==self:hit(x,y) then self:activate(self.pressed) end
  self.pressed=nil
end
function Sandbox:keypressed(key)
  if key=='escape' then self:leave('home');return end
  if key=='tab' or key=='up' or key=='down' or key=='left' or key=='right' then
    local found
    self.focus,found=Controls.move(self.focus,key,self.controls)
    if found then self.callbacks.announce(self:describe(self.controls[self.focus])) end
  elseif key=='pageup' or key=='pagedown' then self:changePage(key=='pageup' and -1 or 1)
  elseif key=='return' or key=='space' then self:activate(self.focus) end
end
function Sandbox:wheelmoved(y) if y~=0 and not self.editing and WheelPager.ready(self) then self:changePage(y>0 and -1 or 1) end end
function Sandbox:draw()
  local x,y,w,h=self.x,self.y,self.w,self.h
  Button.modalFrameRaised(x,y,w,h)
  if self.phase=='ready' then
    local a=self.area
    DeckPicker.drawTray(a)
    DeckPicker.drawPiles(self,self.selected[self.tab])
    if #self.cards==0 then T.text(#self.items==0 and 'No valid decks' or 'No matches',32,a.x,a.y+80,a.w) end
    -- Under Create a deck, which keeps its place.
    local note=#self.items==0 and self:emptyNote()
    if note then T.text(note,20,a.x+16,y+372,a.w-32,T.paper) end
    DeckPicker.drawPager(self,y+h-170)
  else
    local text=self.phase=='loading' and 'Loading your decks...' or self.phase=='anonymous' and 'Sign in to choose your decks' or 'Could not load your decks'
    T.text(text,self.portrait and 27 or 32,x+24,y+220,w-48)
  end
  local message=self.message
  if message=='' and self.phase=='ready' then
    for seat=1,2 do local d=self:deck(seat);if d and d.count~=Limits.deckSize then message='Player '..seat..': choose a '..Limits.deckSize..'-card deck.';break end end
  end
  if message~='' then Button.errorLine(message,18,x+20,y+h-124,w-40) end
  for i,b in ipairs(self.controls) do
    local lit=Controls.lit(self.hover,self.focus,i)
    if b.input then Input.draw(b,self.query,self.editing,self.first,self.last,self.time,b.disabled,lit)
    elseif not b.card then Button.draw(b,not b.disabled and lit,self.pressed==i,lit and self.hover==0,self.width) end
    if b.action=='tab'..self.tab then Button.chosen(b,self.time,self.pressed==i,self.width,self.reduced) end
  end
end
return Sandbox
