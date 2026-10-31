local D=require('ui.card_dimensions')
local WheelPager=require('ui.wheel_pager')
local T=require('ui.theme')
local Controls=require('ui.controls')
local Button=require('ui.button')
local Pile=require('ui.deck_pile')
local CardBack=require('ui.card_back')
local Alert=require('ui.card_alert')
local DeckLabels=require('ui.deck_labels')
local PageText=require('ui.page_text')
local Display=require('ui.display')
local HitArea=require('ui.hit_area')
local Modal=require('ui.modal')
local Codec=require('ui.codec')
local Mailbox=require('ui.mailbox')
local W=require('ui.wire_fields').library
local Fit=require('ui.text_fit')
local Input=require('ui.text_input')
local Pager=require('ui.pager')
local g=love.graphics
local Library={}
Library.__index=Library
local sorts={'name-asc','name-desc','cards-desc'}
local sortLabels={['name-asc']='Name A-Z',['name-desc']='Name Z-A',['cards-desc']='Card count'}
local saved={create='Deck created.',rename='Deck renamed.',delete='Deck deleted.'}
-- The library's pager (ui/pager.lua), anchored at the room's centre.
local PAGER={face=-135,w=270,arrow=36,h=48,fontSize=30}
local function nextValue(values,current)
  for i,v in ipairs(values) do if v==current then return values[i%#values+1] end end
  return values[1]
end
local function caption(text,size,x,y,w,colour)
  text,size=Fit.fit(text,size,w); T.text(text,size,x,y,w,colour)
end
-- The Manage button's face: three pixel dots, following the face's parallax
-- like the builder's icon buttons.
local function manageDots(b,pressed,roomWidth)
  local sx=((b.x+b.w/2-roomWidth/2)/(roomWidth/2))*1.5
  local layer=0.4-(pressed and 1.5 or 0)
  g.push(); g.translate(b.x+layer*sx*3+b.w/2,b.y-layer*4.5+b.h/2); g.scale(pressed and 0.985 or 1)
  g.setColor(T.white)
  for dot=-1,1 do g.rectangle('fill',dot*8-2,-2,4,4) end
  g.pop()
end
function Library.new(callbacks)
  return setmetatable({callbacks=callbacks,pageText=PageText.new(),phase='loading',busy=false,message='',query='',sort='name-asc',page=1,pages=1,total=0,items={},cards={},controls={},focus=0,hover=0,time=0,draft='',search='',editing=''},Library)
end
function Library:open(reduced)
  self.motion=Modal.motion(reduced)
  self.focus=0; self.hover=0; self.pressed=nil; self.drag=nil
  self.opening=true
  self:sendSize()
  self:command('open')
end
-- The TS side pages by this: four decks in portrait, twelve otherwise.
function Library:sendSize()
  local size=self.portrait and 4 or 12
  if size~=self.sentSize then self.sentSize=size;self:command('size',size) end
end
function Library:offset()
  return self.motion and self.motion.VT.y*60 or 0
end
-- The box the field a text proxy edits is drawn in, its dialog's slide included, for main.lua to
-- hand the page (audit BR6); nothing while none edits.
function Library:editBox()
  local action=self.editing=='search' and 'input-search' or self.editing=='name' and 'input-name'
  for _,b in ipairs(action and self.controls or {}) do
    if b.action==action then return b.x,b.y+(self.modal and self.modal.motion.VT.y*60 or 0),b.w,b.h end
  end
end
function Library:command(...)
  Codec.command(self.callbacks.command,...)
end
function Library:release()
  for _,card in ipairs(self.cards) do
    card.texture:release()
  end
  self.cards={}
end
function Library:layout(w,h)
  self.drag=nil; self.pressed=nil
  self.width,self.height=w,h; self.portrait=w<600
  self:makeCards(false)
  self:build()
end
function Library:makeCards(entering)
  if not self.width then return end
  self:release()
  local cols=self.portrait and 2 or 6
  local span=self.portrait and 380 or 1000
  local left=(self.width-span)/2
  for i,item in ipairs(self.items) do
    item.colour=T.blue; item.edition='dissolve'
    item.drawFace=function(w,h) CardBack.draw(item.backColour,w,h) end
    local card=Pile.new(item,i)
    card:place(left+span/cols*((i-1)%cols+0.5),(self.portrait and 280 or 240)+math.floor((i-1)/cols)*(self.portrait and 220 or 250),self.portrait and 0.68 or 0.82,false,self.width)
    card:collect(cols,(i-1)%cols,self.width/2,entering,self.time,self.reduced,self.width)
    self.cards[#self.cards+1]=card
  end
end
-- The library's state as the page draws it: loading, signed out, failed,
-- empty, no matches, or how many decks it lists.
function Library:state()
  if self.phase=='loading' then return 'Loading your library.' end
  if self.phase=='anonymous' then return 'Sign in to browse and build your collection.' end
  if self.phase~='ready' then return 'Could not load your decks.' end
  local n=self.total or 0
  if n==0 then return self.query~='' and 'No matches. Try another name.' or 'Nothing here yet. Create a deck to get started.' end
  if self.query~='' then return n..(n==1 and ' deck matches.' or ' decks match.') end
  return n..(n==1 and ' deck.' or ' decks.')
end
-- What a sync says: the page and its state on open or a phase change, then a
-- changed state, sort, page, saved change or message, each once.
function Library:changes(was,result)
  local say={}
  local function add(text) if text and text~='' then say[#say+1]=text end end
  local m=self.modal
  if m and m.pending and result=='ok' then add(saved[m.mode]) end
  local state=self:state()
  if self.opening or self.phase~=was.phase then
    add((self.phase=='ready' and (self.total or 0)>0 and 'Deck library, ' or 'Deck library. ')..state)
  else
    if state~=self.spokenState then add(state) end
    if self.sort~=was.sort then add('Sort: '..(sortLabels[self.sort] or self.sort)) end
    -- A new search or sort starts on page 1 without saying so.
    if self.page~=was.page and self.query==was.query and self.sort==was.sort then add(Pager.page(self.page,self.pages)) end
  end
  self.spokenState=state;self.opening=nil
  if self.message~='' and self.message~=self.spokenMessage then add(self.message) end
  self.spokenMessage=self.message
  return say
end
function Library:sync(raw)
  if not raw or raw==self.raw then return end
  self.raw=raw
  local lines=Codec.rows(raw)
  local H=W.header
  local f=lines[1]; if not f or #f<H.result then return end
  local was={phase=self.phase,sort=self.sort,page=self.page,query=self.query}
  self.phase,self.busy,self.message=f[H.phase],f[H.busy]=='1',f[H.message]
  self.query,self.sort=f[H.query],f[H.sort]
  self.page,self.pages,self.total=tonumber(f[H.page]),tonumber(f[H.pages]),tonumber(f[H.total])
  self.pageText:set('Page '..self.page..'/'..self.pages,self.time)
  if self.editing~='search' then self.search=self.query end
  local items={}; local signature={self.query,tostring(self.page)}
  for i=2,#lines do
    local row=lines[i]
    if row[1]=='D' then
      local d=W.deck
      -- The legality verdict is '' while it is still being checked.
      items[#items+1]={kind='deck',id=row[d.id],name=row[d.name],count=tonumber(row[d.count]) or 0,tint=tonumber(row[d.tint]) or 0,illegal=row[d.illegal]=='1'}
      signature[#signature+1]=table.concat({row[d.id],row[d.name],row[d.count],row[d.tint]},'\t')
    end
  end
  signature=table.concat(signature,'\n')
  if signature~=self.signature then
    self.signature=signature; self.items=items; self.focus=0; self.pressed=nil; self.drag=nil
    self:makeCards(true)
  else
    -- A verdict arriving later only flips the alert; the piles stay put.
    for i,item in ipairs(items) do if self.items[i] then self.items[i].illegal=item.illegal end end
  end
  local say=self:changes(was,f[H.result])
  if self.modal and self.modal.pending and f[H.result]=='ok' then self:closeModal() end
  if self.phase~='ready' and not self.busy then self:closeModal() end
  self:build()
  if #say>0 then self.callbacks.announce(table.concat(say,' ')) end
end
function Library:add(label,x,y,w,h,action,colour,extra)
  local b=extra or {}
  b.label,b.x,b.y,b.w,b.h,b.action,b.colour,b.fontSize=label,x,y,w,h,action,colour or T.red,24
  if b.disabled then b.colour=T.panel end
  self.controls[#self.controls+1]=b
  return b
end
function Library:build()
  if not self.width then return end
  self.controls={}
  local w,h,p=self.width,self.height,self.portrait
  if self.modal then
    local m=self.modal
    self.modal=nil; self:build(); self.baseControls=self.controls; self.modal=m; self.controls={}
    m.w=p and 420 or 600; m.h=m.mode=='manage' and 336 or m.mode=='delete' and 340 or 330
    m.x,m.y=(w-m.w)/2,(h-m.h)/2
    local x,y,bw=m.x+28,m.y+80,m.w-56
    if m.mode=='manage' then
      self:add('Edit deck',x,y,bw,42,'open-item',T.blue)
      self:add('Rename',x,y+56,bw,42,'rename',T.red)
      self:add('Delete '..m.item.kind,x,y+112,bw,42,'confirm-delete',T.red)
    elseif m.mode=='delete' then
      self:add('Delete '..m.item.kind,x,m.y+m.h-130,bw,42,'submit',T.red)
    else
      self:add('Name',x,y+24,bw,42,'input-name',T.ink,{input=true,placeholder='Name'})
      self:add(m.mode=='create' and 'Create' or 'Save',x,y+92,bw,42,'submit',T.red)
    end
    self:add('Back',x,m.y+m.h-62,bw,40,'close',T.orange)
    return
  end
  local contentX=p and 24 or (w-1000)/2
  self:add('Back',contentX,h-66,p and w-48 or 1000,40,'home',T.orange)
  if self.phase=='ready' then
    self:add('',contentX,48,p and 432 or 476,42,'input-search',T.ink,{input=true,placeholder='Search decks'})
    self:add('Sort: '..(sortLabels[self.sort] or 'Name A-Z'),p and 24 or contentX+490,p and 102 or 48,p and 208 or 260,42,'sort',T.blue)
    self:add('New deck',p and 248 or contentX+764,p and 102 or 48,p and 208 or 236,42,'new-deck',T.red)
    for i,card in ipairs(self.cards) do
      local s=card.baseScale
      self.controls[#self.controls+1]={label=card.item.name,x=card.homeX-D.HALF_W*s,y=card.homeY-D.HALF_H*s,w=D.W*s,h=D.H*s,action='card',card=i}
      -- Rename and Delete live in the Manage dialog: a dots button under the
      -- pile's left half (the count sits under the right), focused after its deck.
      self:add('Manage',card.homeX-D.HALF_W*s,card.homeY+D.HALF_H*s+2,40,24,'manage',T.blue,{card=i,displayLabel='',hitGrow='down'})
    end
    -- PG8: Manage answers over about 34x34 (24 CSS px at least) hanging from its face, inside
    -- the tray and clear of its pile and every other control.
    local manage={}
    for _,b in ipairs(self.controls) do if b.action=='manage' then manage[#manage+1]=b end end
    local size=math.max(34,Display.units(24,Display.collection))
    local trayWidth=p and 380 or 1000
    HitArea.inflate(manage,size,size,self.controls,nil,{x=(w-trayWidth)/2,y=p and 154 or 104,w=trayWidth,h=p and 452 or 510})
    Pager.arrows(PAGER,w/2,h-144,self.page,self.pages,function(label,ax,ay,aw,ah,dir)
      return self:add(label,ax,ay,aw,ah,dir<0 and 'previous' or 'next',T.red)
    end)
  elseif self.phase~='loading' then
    self:add(self.phase=='anonymous' and 'Sign in' or 'Try again',w/2-140,h/2+48,280,48,self.phase=='anonymous' and 'signin' or 'refresh',T.red)
  end
end
function Library:closeModal()
  self:command('finish-input'); self.modal=nil; self.editing=''; self.focus=0; self.pressed=nil; self:build()
end
function Library:openModal(mode,item)
  self:command('finish-input'); self.editing=''; self.focus=0; self.pressed=nil
  self.modal={mode=mode,item=item,motion=Modal.motion(self.reduced)}
  self.modal.motion.T.y=0
  self.draft=mode=='create' and 'Untitled Deck' or item.name
  self:build()
  self.callbacks.announce(mode=='manage' and item.name or mode=='delete' and 'Delete '..item.name..'? This deck will be permanently deleted.' or (mode=='create' and 'New ' or 'Rename ')..item.kind)
end
-- What a focused control says: its label, the value it shows, and what it acts on.
function Library:describe(b)
  if b.action=='input-search' then return 'Search decks: '..(self.search~='' and self.search or 'empty')..'. Enter to edit.' end
  if b.action=='input-name' then return 'Deck name: '..(self.draft~='' and self.draft or 'empty')..'. Enter to edit.' end
  if b.speech then return b.speech end
  local item=b.card and self.items[b.card]
  if b.action=='manage' then return 'Manage '..item.name end
  if b.action=='card' then
    return item.name..', '..item.count..(item.count==1 and ' card' or ' cards')..(item.illegal and ', not ready to play' or '')
  end
  return b.label
end
function Library:input(raw)
  if not raw or self.inputRaw==raw then return end
  self.inputRaw=raw; local f=Codec.fields(raw)
  if #f<6 then return end
  local field,action=f[2],f[6]
  if field=='search' and action~='input' and self.editing~='search' then return end
  self.editing=action=='input' and field or ''
  self.first,self.last=tonumber(f[4]),tonumber(f[5])
  if field=='search' then
    self.search=f[3]
    self.pendingSearch=self.search; self.searchDelay=action=='input' and 0.2 or 0
  elseif field=='name' and self.modal then
    self.draft=f[3]
    if action=='enter' then self:submit() end
  end
end
function Library:submit()
  local m=self.modal; if not m or self.busy then return end
  self:command('finish-input')
  if m.mode=='delete' then self:command('delete',m.item.kind,m.item.id)
  elseif m.mode=='create' then self:command('create',m.item.kind,self.draft)
  elseif m.mode=='rename' then self:command('rename',m.item.kind,m.item.id,self.draft)
  else return end
  m.pending=true
  -- The reply is heard even when it repeats the last message.
  self.spokenMessage=nil
end
function Library:activate(i)
  local b=self.controls[i]; if not b or b.disabled then return end
  if self.busy and b.action~='home' then return end
  self.callbacks.feedback('button')
  local a=b.action
  if a=='home' then self.callbacks.home()
  elseif a=='signin' then self.callbacks.signin()
  elseif a=='refresh' then self.callbacks.refresh(); self:command('refresh')
  elseif a=='input-search' then self.editing='search'; self:command('input','search',self.search)
  elseif a=='input-name' then self.editing='name'; self:command('input','name',self.draft)
  elseif a=='new-deck' then self:openModal('create',{kind='deck',name=''})
  elseif a=='manage' then self:openModal('manage',self.items[b.card])
  elseif a=='card' then
    local item=self.items[b.card]
    self:command('edit',item.id)
  elseif a=='previous' or a=='next' then self:command('page',a=='previous' and -1 or 1)
  elseif a=='sort' then self:command('sort',nextValue(sorts,self.sort))
  elseif a=='close' then self:closeModal()
  elseif a=='submit' then self:submit()
  elseif self.modal then
    local item=self.modal.item
    if a=='rename' then self:openModal('rename',item)
    elseif a=='confirm-delete' then self:openModal('delete',item)
    elseif a=='open-item' then self:closeModal(); self:command('edit',item.id) end
  else self:command(a) end
end
function Library:hit(x,y,localCoords)
  if not localCoords then y=y-self:offset() end
  if self.modal then y=y-self.modal.motion.VT.y*60 end
  for i=#self.controls,1,-1 do
    local b=self.controls[i]
    if not b.disabled and (b.action=='card' and self.cards[b.card]:hit(x,y) or b.action~='card' and Button.hit(b,x,y)) then return i end
  end
  return 0
end
function Library:update(dt,time,mx,my,reduced)
  if self.motion then self.motion:update(dt,time,false,false,reduced) end
  my=my-self:offset()
  self.time,self.mx,self.my,self.reduced=time,mx,my,reduced
  self:sendSize()
  self:sync(Mailbox.read('library'))
  self:input(Mailbox.read('libraryInput'))
  if self.pendingSearch and not self.busy then
    self.searchDelay=self.searchDelay-dt
    if self.searchDelay<=0 then self:command('search',self.pendingSearch); self.pendingSearch=nil end
  end
  if self.modal then self.modal.motion:update(dt,time,false,false,reduced) end
  self.hover=self:hit(mx,my,true)
  if self.drag then
    if not self.drag.active and (math.abs(mx-self.drag.x)+math.abs(my-self.drag.y)>10) then
      self.drag.active=true; self.callbacks.feedback('cardSlide1')
    end
    local card=self.cards[self.drag.index]
    if card then card.dragging=self.drag.active; card.targetX,card.targetY=mx+self.drag.offsetX,my+self.drag.offsetY end
  end
  for i,card in ipairs(self.cards) do
    -- Only the pile itself lifts; its Manage button does not.
    local hover,focus=self.controls[self.hover] or {},self.controls[self.focus] or {}
    local hovered=not self.modal and (hover.action=='card' and hover.card==i or self.hover==0 and focus.action=='card' and focus.card==i)
    if hovered and not card.hovered then card:juiceUp(time,0.05,0.03,reduced); self.callbacks.feedback('paper1',0.9+love.math.random()*0.2) end
    card:update(dt,time,hovered,reduced,self.width)
  end
end
function Library:cancelInteractions()
  self.drag=nil;self.pressed=nil
  for _,card in ipairs(self.cards) do card.dragging=false end
end
function Library:mousepressed(x,y)
  self.focus=0; self.pressed=self:hit(x,y)
  local b=self.controls[self.pressed]
  if b and b.action=='card' and not self.busy then
    local card=self.cards[b.card]
    self.drag={index=b.card,x=x,y=y-self:offset(),offsetX=card.x-x,offsetY=card.y-(y-self:offset())}
  end
end
function Library:mousereleased(x,y)
  local drag=self.drag
  if drag and drag.active then
    local source=self.cards[drag.index]
    if source then
      source.dragging=false
      source:juiceUp(self.time,nil,nil,self.reduced)
    end
  elseif self.pressed and self.pressed==self:hit(x,y) then self:activate(self.pressed) end
  self.drag=nil; self.pressed=nil
end
function Library:keypressed(key)
  if key=='escape' then
    if self.modal then self:closeModal()
    else self.callbacks.home() end
  elseif key=='tab' or key=='right' or key=='down' or key=='left' or key=='up' then
    local found
    self.focus,found=Controls.cycle(self.focus,Controls.backward(key) and -1 or 1,#self.controls,function(i) return Controls.unfocusable(self.controls[i]) end)
    if found then self.callbacks.announce(self:describe(self.controls[self.focus])) end
  elseif key=='return' or key=='space' then self:activate(self.focus)
  elseif key=='pageup' or key=='pagedown' then if not self.modal then self:command('page',key=='pageup' and -1 or 1) end end
end
function Library:wheelmoved(y)
  if not self.modal and not self.busy and y~=0 and WheelPager.ready(self) then self:command('page',y>0 and -1 or 1) end
end
function Library:draw(shaders)
  local w,h,p=self.width,self.height,self.portrait
  local frameW=p and w-32 or 1032
  local frameX=(w-frameW)/2
  Button.modalFrameRaised(frameX,20,frameW,h-34)
  if self.phase=='ready' then
    -- Joker collection row: G.C.BLACK, r=0.1, emboss=0.05; no drop shadow.
    local trayWidth=p and 380 or 1000
    local trayX,trayY=(w-trayWidth)/2,p and 154 or 104
    local trayH=p and 452 or 510
    Button.panel(trayX,trayY+3,trayWidth,trayH,{T.panel[1]*0.7,T.panel[2]*0.7,T.panel[3]*0.7,1})
    Button.panel(trayX,trayY,trayWidth,trayH,T.panel)
    for i,card in ipairs(self.cards) do
      card:draw()
      DeckLabels.drawCounter(card)
      DeckLabels.drawHover(card)
      if card.item.illegal and not card.dragging then Alert.drawOnCard(card,self.time,self.reduced,w,Alert.pile) end
      local labelWidth=D.W*card.baseScale+12
      local pileX,pileY=card:target(1,w,Pile.parallax())
      caption(card.item.name,22,pileX-labelWidth/2,pileY-D.HALF_H*card.baseScale-40,labelWidth)
    end
    if #self.cards==0 then
      T.text(self.query~='' and 'No matches' or 'Nothing here yet',p and 34 or 44,24,h/2-30,w-48)
      T.text(self.query~='' and 'Try another name.' or 'Create a deck to get started.',p and 22 or 26,24,h/2+24,w-48,T.paper)
    end
    -- create_option_cycle: w=4.5, h=0.8, no_pips=true; embossed center.
    Pager.draw(PAGER,w/2,h-144,self.pageText,not self.modal,self.mx,self.my,self.time,self.reduced,w)

  else
    local label=self.phase=='loading' and 'Loading your library...' or self.phase=='anonymous' and 'Your decks, all together' or 'Could not load your decks'
    T.text(label,p and 30 or 44,24,h/2-60,w-48)
    T.text(self.phase=='anonymous' and 'Sign in to browse and build your collection.' or ' ',p and 21 or 26,24,h/2,w-48,T.paper)
  end
  for i,b in ipairs(self.modal and self.baseControls or self.controls) do
    local lit=not self.modal and Controls.lit(self.hover,self.focus,i)
    if b.input then Input.draw(b,self.search,not self.modal and self.editing=='search',self.first,self.last,self.time,false,lit)
    elseif b.action~='card' then
      local pressed=not self.modal and self.pressed==i
      Button.draw(b,lit and not b.disabled,pressed,lit and self.hover==0,w)
      if b.action=='manage' then manageDots(b,pressed,w) end
    end
  end
  if not self.modal then
    if self.message~='' then Button.errorLine(self.message,23,28,h-178,w-56) end
    if self.busy then T.text('Loading...',22,24,h-178,w-48,T.paper) end
  end
  for _,card in ipairs(self.cards) do
    if card.dragging then
      card:drawDragged(shaders,self.time,self.mx,self.my,self.reduced,w)
      if card.item.illegal then Alert.drawOnCard(card,self.time,self.reduced,w,Alert.pile) end
    end
  end
end
function Library:drawModal()
  local w,p=self.width,self.portrait
  if self.modal then
    local m=self.modal
    g.push(); g.translate(0,m.motion.VT.y*60)
    Button.modalFrameRaised(m.x,m.y,m.w,m.h)
    caption(m.mode=='manage' and m.item.name or (m.mode=='create' and 'New ' or m.mode=='delete' and 'Delete ' or 'Rename ')..m.item.kind,36,m.x+20,m.y+20,m.w-40)
    if m.mode=='delete' then
      caption(m.item.name,26,m.x+24,m.y+84,m.w-48,T.paper)
      T.text('This deck will be permanently deleted.',p and 20 or 24,m.x+24,m.y+124,m.w-48,T.paper)
    end
    for i,b in ipairs(self.controls) do
      local lit=Controls.lit(self.hover,self.focus,i)
      if b.input then Input.draw(b,self.draft,self.editing=='name',self.first,self.last,self.time,false,lit)
      else Button.draw(b,lit and not b.disabled,self.pressed==i,lit and self.hover==0,w) end
    end
    if self.busy then caption('Saving...',20,m.x+20,m.y+m.h-91,m.w-40,T.paper)
    elseif self.message~='' then Button.errorLine(self.message,20,m.x+20,m.y+m.h-91,m.w-40) end
    g.pop()
  end
end
return Library
