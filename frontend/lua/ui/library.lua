local T=require('ui.theme')
local Button=require('ui.button')
local Pile=require('ui.deck_pile')
local Alert=require('ui.card_alert')
local DeckLabels=require('ui.deck_labels')
local PageText=require('ui.page_text')
local Modal=require('ui.modal')
local Codec=require('ui.account')
local Input=require('ui.text_input')
local g=love.graphics
local Library={}
Library.__index=Library
local sorts={'name-asc','name-desc','cards-desc'}
local sortLabels={['name-asc']='Name A-Z',['name-desc']='Name Z-A',['cards-desc']='Card count'}
local function nextValue(values,current)
  for i,v in ipairs(values) do if v==current then return values[i%#values+1] end end
  return values[1]
end
local function fit(text,size,width)
  text=text:gsub('%c',' ')
  while size>14 and T.font(size):getWidth(text)>width do size=size-1 end
  if T.font(size):getWidth(text)>width then
    local out=''
    for c in text:gmatch('[%z\1-\127\194-\244][\128-\191]*') do
      if T.font(size):getWidth(out..c..'...')>width then break end
      out=out..c
    end
    text=out..'...'
  end
  return text,size
end
local function caption(text,size,x,y,w,colour)
  text,size=fit(text,size,w); T.text(text,size,x,y,w,colour)
end
function Library.new(callbacks)
  return setmetatable({callbacks=callbacks,pageText=PageText.new(),phase='loading',busy=false,message='',query='',sort='name-asc',page=1,pages=1,total=0,items={},cards={},controls={},focus=0,hover=0,time=0,draft='',search='',editing=''},Library)
end
function Library:open(reduced)
  self.motion=Modal.motion(reduced)
  self.focus=0; self.hover=0; self.pressed=nil; self.drag=nil
  self:command('open')
end
function Library:offset()
  return self.motion and self.motion.VT.y*60 or 0
end
function Library:command(...)
  local args={...}
  for i,v in ipairs(args) do args[i]=Codec.encode(v) end
  self.callbacks.command(table.concat(args,'\t'))
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
  self:command('size',self.portrait and 4 or 12)
  self:makeCards(false)
  self:build()
end
function Library:face(item,w,h)
  if not self.backs then
    self.backs=g.newImage('assets/textures/2x/Enhancers.png')
    self.backs:setFilter('nearest','nearest')
    self.backQuad=g.newQuad(0,0,142,190,self.backs:getDimensions())
    self.blueBackQuad=g.newQuad(0,380,142,190,self.backs:getDimensions())
  end
  local quad=item.backColour=='blue' and self.blueBackQuad or self.backQuad
  g.setColor(1,1,1); g.draw(self.backs,quad,0,0,0,w/142,h/190)
end
function Library:makeCards(entering)
  if not self.width then return end
  self:release()
  local cols=self.portrait and 2 or 6
  local span=self.portrait and 380 or 1000
  local left=(self.width-span)/2
  for i,item in ipairs(self.items) do
    item.colour=T.blue; item.edition='dissolve'
    item.drawFace=function(w,h) self:face(item,w,h) end
    local card=Pile.new(item,i)
    card:place(left+span/cols*((i-1)%cols+0.5),(self.portrait and 280 or 240)+math.floor((i-1)/cols)*(self.portrait and 220 or 250),self.portrait and 0.68 or 0.82,false,self.width)

    if entering and not self.reduced then card:enterCollection(self.width/2) end
    self.cards[#self.cards+1]=card
  end
end
function Library:sync(raw)
  if not raw or raw==self.raw then return end
  self.raw=raw
  local lines={}; for line in raw:gmatch('[^\n]+') do lines[#lines+1]=Codec.fields(line) end
  local f=lines[1]; if not f or #f<14 then return end
  self.phase,self.busy,self.message=f[2],f[3]=='1',f[4]
  self.query,self.sort=f[6],f[8]
  self.page,self.pages,self.total=tonumber(f[9]),tonumber(f[10]),tonumber(f[11])
  self.pageText:set('Page '..self.page..'/'..self.pages,self.time)
  if self.editing~='search' then self.search=self.query end
  local items={}; local signature={self.query,tostring(self.page)}
  for i=2,#lines do
    local row=lines[i]
    if row[1]=='D' then
      -- Field 8 is the legality verdict: '' while it is still being checked.
      items[#items+1]={kind='deck',id=row[2],name=row[3],parent=row[4],count=tonumber(row[5]) or 0,tint=tonumber(row[6]) or 0,cover=row[7] or '',illegal=row[8]=='1'}
      signature[#signature+1]=table.concat(row,'\t',1,7)
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
  if self.modal and self.modal.pending and f[14]=='ok' then self:closeModal() end
  if self.phase~='ready' and not self.busy then self:closeModal() end
  self:build()
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
      self.controls[#self.controls+1]={label=card.item.name,x=card.homeX-71*card.baseScale,y=card.homeY-95*card.baseScale,w=142*card.baseScale,h=190*card.baseScale,action='card',card=i}
    end
    self:add('<',w/2-177,h-144,36,48,'previous',T.red).fontSize=30
    self:add('>',w/2+141,h-144,36,48,'next',T.red).fontSize=30
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
  self.callbacks.announce(mode=='manage' and item.name or mode..' '..item.kind)
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
  if love.filesystem.getInfo('__library.txt') then self:sync(love.filesystem.read('__library.txt')) end
  if love.filesystem.getInfo('__library_input.txt') then self:input(love.filesystem.read('__library_input.txt')) end
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
    local hovered=not self.modal and ((self.controls[self.hover] or {}).card==i or (self.controls[self.focus] or {}).card==i)
    if hovered and not card.hovered then card:juiceUp(time,0.05,0.03,reduced); self.callbacks.feedback('paper1',0.9+love.math.random()*0.2) end
    card:update(dt,time,hovered,reduced,self.width)
  end
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
    local backwards=key=='left' or key=='up' or (key=='tab' and love.keyboard.isDown('lshift','rshift'))
    for _=1,#self.controls do
      self.focus=(self.focus-1+(backwards and -1 or 1))%#self.controls+1
      if not self.controls[self.focus].disabled then break end
    end
    local b=self.controls[self.focus]; if b then self.callbacks.announce((b.action=='manage' and 'Manage '..self.items[b.card].name) or b.label~='' and b.label or 'Search decks') end
  elseif key=='return' or key=='space' then self:activate(self.focus)
  elseif key=='pageup' or key=='pagedown' then if not self.modal then self:command('page',key=='pageup' and -1 or 1) end end
end
function Library:wheelmoved(y)
  if not self.modal and not self.busy and y~=0 then self:command('page',y>0 and -1 or 1) end
end
function Library:draw(shaders)
  local w,h,p=self.width,self.height,self.portrait
  local frameW=p and w-32 or 1032
  local frameX=(w-frameW)/2
  Button.panel(frameX,26,frameW,h-34,{0.525,0.546,0.585,1},2.4)
  Button.panel(frameX,20,frameW,h-34,{191/255,199/255,213/255,1},2.4)
  Button.panel(frameX+4,24,frameW-8,h-42,T.tray,2.4)
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
      local labelWidth=142*card.baseScale+12
      local pileX,pileY=card:target(1,w,Pile.parallax())
      caption(card.item.name,22,pileX-labelWidth/2,pileY-95*card.baseScale-40,labelWidth)
    end
    if #self.cards==0 then
      T.text(self.query~='' and 'No matches' or 'Nothing here yet',p and 34 or 44,24,h/2-30,w-48)
      T.text(self.query~='' and 'Try another name.' or 'Create a deck to get started.',p and 22 or 26,24,h/2+24,w-48,T.paper)
    end
    do
      -- create_option_cycle: w=4.5, h=0.8, no_pips=true; embossed center.
      local x,y=w/2-135,h-144
      local hovered=not self.modal and Button.hit({x=x,y=y,w=270,h=48},self.mx or -1,self.my or -1)
      Button.cycleFace(x,y,270,48,hovered)
      self.pageText:draw(self.time,self.reduced,x,y,270,48,w)
    end

  else
    local label=self.phase=='loading' and 'Loading your library...' or self.phase=='anonymous' and 'Your decks, all together' or 'Could not load your decks'
    T.text(label,p and 30 or 44,24,h/2-60,w-48)
    T.text(self.phase=='anonymous' and 'Sign in to browse and build your collection.' or ' ',p and 21 or 26,24,h/2,w-48,T.paper)
  end
  for i,b in ipairs(self.modal and self.baseControls or self.controls) do
    if b.input then Input.draw(b,self.search,not self.modal and self.editing=='search',self.first,self.last,self.time,false,not self.modal and self.hover==i)
    elseif b.action~='card' then Button.draw(b,not self.modal and not b.disabled and (self.hover==i or self.focus==i),not self.modal and self.pressed==i,false,w) end
  end
  if not self.modal then
    if self.message~='' then caption(self.message,23,28,h-178,w-56,T.red) end
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
    Button.panel(m.x,m.y+6,m.w,m.h,{0.525,0.546,0.585,1},2.4)
    Button.panel(m.x,m.y,m.w,m.h,{191/255,199/255,213/255,1},2.4)
    Button.panel(m.x+4,m.y+4,m.w-8,m.h-8,T.tray,2.4)
    caption(m.mode=='manage' and m.item.name or (m.mode=='create' and 'New ' or m.mode=='delete' and 'Delete ' or 'Rename ')..m.item.kind,36,m.x+20,m.y+20,m.w-40)
    if m.mode=='delete' then
      caption(m.item.name,26,m.x+24,m.y+84,m.w-48,T.paper)
      T.text('This deck will be permanently deleted.',p and 20 or 24,m.x+24,m.y+124,m.w-48,T.paper)
    end
    for i,b in ipairs(self.controls) do
      if b.input then Input.draw(b,self.draft,self.editing=='name',self.first,self.last,self.time,false,self.hover==i)
      else Button.draw(b,not b.disabled and (self.hover==i or self.focus==i),self.pressed==i,false,w) end
    end
    caption(self.busy and 'Saving...' or self.message,20,m.x+20,m.y+m.h-91,m.w-40,self.busy and T.paper or T.red)
    g.pop()
  end
end
return Library
