local D=require('ui.card_dimensions')
local WheelPager=require('ui.wheel_pager')
local T=require('ui.theme')
local Controls=require('ui.controls')
local Button=require('ui.button')
local Card=require('ui.card')
local Collection=require('ui.collection_motion')
local CardFrame=require('ui.card_frame')
local DeckStats=require('ui.deck_stats')
local Limits=require('ui.limits')
local DeckRow=require('ui.deck_row')
local Alert=require('ui.card_alert')
local Energy=require('ui.energy')
local PageText=require('ui.page_text')
local Display=require('ui.display')
local HitArea=require('ui.hit_area')
local Modal=require('ui.modal')
local Codec=require('ui.codec')
local TextRecord=require('ui.text_record')
local Mailbox=require('ui.mailbox')
local W=require('ui.wire_fields').builder
local Fit=require('ui.text_fit')
local Input=require('ui.text_input')
local TextArea=require('ui.text_area')
local Pager=require('ui.pager')
local g=love.graphics
local Deck=require('ui.builder_deck')
local PANEL_Y,PANEL_HEIGHT=Deck.PANEL_Y,Deck.PANEL_HEIGHT
local DECK_X,DECK_WIDTH=Deck.X,Deck.WIDTH
local Builder={}; Builder.__index=Builder
local Filters=require('ui.builder_filters')
local SORT_LABELS=Filters.SORT_LABELS
-- The save caption beside the deck name, by builder.ts's saveStatus: an edit waiting for its save
-- (pending) reads as saving.
local SAVE_CAPTIONS={pending='Saving...',saving='Saving...',saved='Saved',retrying='Retrying...',failed='Not saved'}
-- The width the save caption keeps beside the deck name.
local STATUS_WIDTH=130
-- The catalog's pager (ui/pager.lua), anchored at the catalog's centre.
local CATALOG_PAGER={face=-135,w=270,arrow=36,h=44,fontSize=30}
-- The visible labels of the builder's text fields, as the host's proxy also names them.
local FIELD_LABELS={name='Deck name',query='Search cards',optionQuery='Find an option',text='Rules text',transfer='Decklist'}
-- builder.ts's placeholder while a card's rules text loads.
local LOADING_DETAILS='Loading card details...'
local function formatName(format) return format=='standard' and 'Standard' or 'Expanded' end
local MODAL_TITLES={choices='Options',transfer='Import or export decklist',clear='Clear this deck?',validation='Deck details',stats='Deck information'}
-- The printed parts the simulator cannot play yet, by the engine's gap names.
local GAP_LABELS={trainer='card effect',ability='Ability',specialEnergy='Energy effect',attack='attack effect'}
local function gapLine(gaps)
  local parts={};for gap in (gaps or ''):gmatch('[^,]+') do parts[#parts+1]=GAP_LABELS[gap] or gap end
  return #parts>0 and 'Not simulated yet: '..table.concat(parts,', ') or nil
end
local fitCaption=Fit.cached(function(text,size,w)
  text=text:gsub('%c',' ')
  size=Fit.shrink(text,size,14,w)
  local font=T.font(size)
  if font:getWidth(text)>w then text=Fit.overhang(text,w,function(s) return font:getWidth(s) end) end
  return text,size
end)
local function caption(text,size,x,y,w,colour,align)
  text,size=fitCaption(text or '',size,w)
  T.text(text,size,x,y,w,colour,align)
end
function Builder.new(callbacks)
  local self=setmetatable({callbacks=callbacks,phase='loading',time=0,hover=0,focus=0,controls={},cards={},deckCards={},deckView='list',items={},deck={},options={},fields={},art={},pageText=PageText.new(),deckPageText=PageText.new(),page=1,pages=1,total=0,count=0,name='',format='standard',message='',saveStatus='',details='',transfer='',deckPage=1,deckType='all',tab='catalog',filterPage=1,editing='',values={},validation='',groups={0,0,0},basic=0,choices={},optionKey='',optionLabel='',optionPage=1,optionPages=1},Builder)
  self.transferArea=TextArea.new('Paste a decklist here...')
  return self
end
function Builder:command(...)
  Codec.command(self.callbacks.command,...)
end
function Builder:open(reduced,id)
  if self.dragCard then self.dragCard.texture:release();self.dragCard=nil end
  self.motion=Modal.motion(reduced);self.id=id;self.modal=nil;self.focus=0;self.deckPage=1;self.deckType='all'
  self.opening=true;self.spokenSummary=self:summary('loading');self.callbacks.announce(self.spokenSummary)
  self:command('open',id or '')
end
-- What the page says when it opens or its phase changes.
function Builder:summary(phase)
  phase=phase or self.phase
  if phase=='loading' then return 'Deck builder. Opening your deck.' end
  if phase=='anonymous' then return 'Deck builder. Sign in to build your deck.' end
  if phase~='ready' then return 'Deck builder. Could not open this deck.' end
  return 'Deck builder. '..(self.name~='' and self.name or 'Untitled deck')..', '..self.count..(self.count==1 and ' card.' or ' cards.')
end
function Builder:offset() return self.motion and self.motion.VT.y*60 or 0 end
-- The box the field a text proxy edits is drawn in, its dialog's slide included, for main.lua to
-- hand the page; nothing while none edits.
function Builder:editBox()
  if self.editing=='' then return end
  for _,b in ipairs(self.controls)do
    if b.action=='input' and b.arg==self.editing then return b.x,b.y+(self.modal and self.modal.motion.VT.y*60 or 0),b.w,b.h end
  end
end
function Builder:closeModal()
  self.hpDrag=nil
  local returnTo=self.modal and self.modal.returnTo
  if self.modal and self.modal.mode=='transfer' then self:command('cancel-import')end
  self:command('finish-input');self.editing='';self.modal=nil;self.focus=0;self.pressed=nil
  if self.detailCard then self.detailCard.texture:release();self.detailCard=nil end
  if returnTo then self:openModal(returnTo)else self:build()end
end
-- What the save caption says, or nil when there is nothing to save.
function Builder:saveCaption() return SAVE_CAPTIONS[self.saveStatus] end
-- Where the save caption draws: beside the deck name, which keeps STATUS_WIDTH for it; on
-- portrait's catalog tab, which has no deck name, at the end of the message line.
function Builder:statusSlot()
  if not self.portrait then return DECK_X+DECK_WIDTH-STATUS_WIDTH,38,STATUS_WIDTH,42 end
  if self.tab=='deck' then return 456-STATUS_WIDTH,98,STATUS_WIDTH,42 end
  return 456-STATUS_WIDTH,self.height-186,STATUS_WIDTH,40
end
-- Whether portrait's catalog shows the drop hint, which takes the message line while a card is dragged.
function Builder:dropHint() return self.portrait and self.tab~='deck' and self.drag and self.drag.active or false end
-- Where builder messages draw: beside Retry above Back in landscape; in portrait above the
-- catalog's pager, before the save caption, and under the deck's Import / Clear row.
function Builder:messageLine()
  if not self.portrait then return 816,self.height-84,294 end
  if self.tab=='deck' then return 24,206,432 end
  return 24,self.height-176,456-STATUS_WIDTH-8-24
end
function Builder:layout(w,h)
  self.hpDrag=nil
  if self.dragCard then self.dragCard.texture:release();self.dragCard=nil end
  self.width,self.height=w,h;self.portrait=w<600
  self.deckPage=math.max(1,math.min(self.deckPage,math.ceil(#self:visibleDeck()/self:deckPageSize())))
  if self.detailCard then self.detailCard.texture:release();self.detailCard=nil end
  self:command('size',self.portrait and 4 or 8)
  CardFrame.open();self:makeCards(false);self:build();CardFrame.close()
end
function Builder:face(item,w,h)
  CardFrame.draw(w,h,function(aw,ah) self:artwork(item,aw,ah) end,
    CardFrame.border(self.art[item.id],T.paper))
end
function Builder:artwork(item,w,h)
  if CardFrame.scan(self.art[item.id],w,h) then return end
  if item.kind=='Energy' then return Builder.energyFace(item,w,h) end
  T.box(0,0,w,h,T.paper,4);T.box(4,4,w-8,h-8,T.ink,4)
  T.text(item.name,18,10,36,w-20,T.paper)
  T.text(item.kind or '',16,10,h-40,w-20,T.profile)
end
-- An Energy card without art (ui/energy.lua).
Builder.energyFace=Energy.face
function Builder:newCard(item,index,x,y,scale,grid)
  item.colour=T.blue;item.edition='dissolve';item.resolution=2;item.drawFace=function(w,h)self:face(item,w,h)end
  local copy={};for k,v in pairs(item)do copy[k]=v end
  local card=Card.new(copy,index);card:place(x,y,scale,false)
  if not grid then card.motion.T.r=((index-1)%4-1.5)*0.025;return card end
  -- Grid cards fan like the simulator's card modals: each page deals from
  -- the row centre and spreads with Moveable's spring (collection_motion).
  Collection.place(card,x,y-0.475*D.H*scale,grid.count,grid.column,grid.center,self.time,self.reduced or not grid.entering,self.width)
  return card
end
function Builder:makeCards(entering)
  if not self.width then return end
  for _,c in ipairs(self.cards)do c.texture:release()end;self.cards={};self.drag=nil
  if self.dragCard and not self.dragCard.returning then self.dragCard.texture:release();self.dragCard=nil end
  local p=self.portrait;local cols=p and 2 or 4
  for i,item in ipairs(self.items)do
    local x=(p and 128 or 146)+((i-1)%cols)*(p and 220 or 174)
    local y=(p and 270 or 224)+math.floor((i-1)/cols)*(p and 260 or 267)
    self.cards[i]=self:newCard(item,i,x,y,p and 1.04 or 1.08,{count=cols,column=(i-1)%cols,center=p and 238 or 407,entering=entering})
  end
  self:dimResults()
end
-- Results kept on screen while a search is out draw with the greyed card look; they stay usable.
function Builder:dimResults()
  for _,c in ipairs(self.cards)do c.greyed=self.busy==true end
end
-- The deck's quantities and the filter values, to tell what a sync changed.
function Builder:baseline()
  local deck,options={},{}
  for _,item in ipairs(self.deck)do deck[item.id]={quantity=item.quantity,name=item.name} end
  for _,o in ipairs(self.options)do options[o.key]=o.value end
  return {phase=self.phase,page=self.page,format=self.format,sort=self.fields.sort or 'name',query=self.fields.query or '',deck=deck,options=options,
    results=#self.items,busy=self.busy,count=self.count,optionKey=self.optionKey,optionPage=self.optionPage,optionQuery=self.fields.optionQuery}
end
-- What a sync changed that the page draws: an option's value, the sort, the
-- catalog page, a deck quantity, an empty search.
function Builder:changes(was)
  local say={}
  local function add(text) if text and text~='' then say[#say+1]=text end end
  local picked,listPage=self:listChanges(was)
  add(picked)
  if self.format~=was.format then add('Format: '..formatName(self.format)) end
  for _,o in ipairs(self.options)do
    if was.options[o.key] and was.options[o.key]~=o.value then add(o.label..': '..o.value) end
  end
  add(listPage)
  local sort=self.fields.sort or 'name'
  if sort~=was.sort then add('Sort: '..(SORT_LABELS[sort] or sort)) end
  -- A new search or sort starts on page 1 without saying so.
  if self.page~=was.page and sort==was.sort and (self.fields.query or '')==was.query then add(Pager.page(self.page,self.pages)) end
  local changed={}
  for _,item in ipairs(self.deck)do
    local old=was.deck[item.id]
    if not old or old.quantity~=item.quantity then changed[#changed+1]=item end
  end
  local present={};for _,item in ipairs(self.deck)do present[item.id]=true end
  for id,old in pairs(was.deck)do if not present[id] then changed[#changed+1]={id=id,name=old.name,quantity=0} end end
  if #changed==1 then
    local item=changed[1]
    add(item.quantity>0 and item.quantity..' '..item.name..' in deck' or 'No '..item.name..' in deck')
  elseif #changed>1 then add(self.count..(self.count==1 and ' card' or ' cards')..' in deck') end
  if #self.items==0 and not self.busy and (was.results>0 or was.busy) then add('No matching cards') end
  return say
end
function Builder:sync(raw)
  if not raw or raw==self.raw then return end;self.raw=raw
  local lines=Codec.rows(raw)
  local H=W.header
  local f=lines[1];if not f or #f<H.retry then return end
  local was=self:baseline()
  self.phase,self.name,self.format,self.saveStatus,self.message=f[H.phase],f[H.name],f[H.format],f[H.saveStatus],f[H.message]
  self.busy=f[H.busy]=='1';self.page,self.pages,self.total,self.count=tonumber(f[H.page]),tonumber(f[H.pages]),tonumber(f[H.total]),tonumber(f[H.count])
  self.selected,self.details=f[H.selected],f[H.details]
  if f[H.transfer]~=self.exportRaw then
    self.exportRaw=f[H.transfer];self.transfer=f[H.transfer];self.transferBaseline=f[H.transfer]
  end
  self.cover=f[H.cover];self.importing=f[H.importing]=='1';self.dirty=f[H.dirty]=='1';self.retry=f[H.retry]=='1'
  self.options={};self.choices={};self.deck={};self.items={};self.selectedItem=nil
  local optionKey=''
  local signature={tostring(self.page)}
  for i=2,#lines do local r=lines[i]
    if r[1]=='C' or r[1]=='D' or r[1]=='S' then
      local c=W.card
      local item={id=r[c.cardId],name=r[c.name],kind=r[c.supertype],subtype=r[c.subtype],quantity=tonumber(r[c.quantity]) or 0,remaining=tonumber(r[c.remaining]) or 0,
        hp=r[c.hp] or '',mark=r[c.mark] or '',number=r[c.number] or '',copyLimit=tonumber(r[c.copyLimit]) or 4,illegal=r[c.illegal]=='1',gaps=r[c.gaps] or ''}
      if r[1]=='C' then self.items[#self.items+1]=item;signature[#signature+1]=item.id
      elseif r[1]=='D' then self.deck[#self.deck+1]=item
      else self.selectedItem=item end
    elseif r[1]=='L' then local l=W.pending
      self.deck[#self.deck+1]={id=r[l.cardId],name=r[l.name],kind='',subtype='',quantity=tonumber(r[l.quantity]) or 0,remaining=0,
        hp='',mark='',number='',copyLimit=0,illegal=false,gaps='',pending=true}
    elseif r[1]=='V' then local v=W.validation;self.validation=r[v.message];self.groups={r[v.pokemon],r[v.trainer],r[v.energy]};self.basic=tonumber(r[v.basic]) or 0
    elseif r[1]=='O' then local o=W.option
      self.options[#self.options+1]={key=r[o.key],label=r[o.label],value=r[o.value],count=tonumber(r[o.count]) or 0,index=tonumber(r[o.index]) or 1,selected=r[o.selected]}
    elseif r[1]=='P' then local p=W.picker
      optionKey=r[p.key];self.optionLabel=r[p.label];self.optionPage=tonumber(r[p.page]);self.optionPages=tonumber(r[p.pages]);self.fields.optionQuery=r[p.query]
    elseif r[1]=='Q' then local q=W.choice;self.choices[#self.choices+1]={value=r[q.value],label=r[q.label],selected=r[q.selected]=='1'}
    elseif r[1]=='F' then self.fields[r[W.field.key]]=r[W.field.value] end
  end
  self.optionKey=optionKey
  signature=table.concat(signature,'|')
  if signature~=self.signature then self.signature=signature;self:makeCards(true)
  else for i,c in ipairs(self.cards)do c.item.quantity=self.items[i].quantity;c.item.remaining=self.items[i].remaining end end
  self:dimResults()
  self.deckPage=math.max(1,math.min(self.deckPage,math.ceil(#self:visibleDeck()/self:deckPageSize())))
  self.pageText:set(self.busy and 'Searching...' or 'Page '..self.page..'/'..self.pages,self.time)
  local say={}
  if self.opening or self.phase~=was.phase then
    local summary=self:summary()
    if summary~=self.spokenSummary then say[#say+1]=summary end
    self.spokenSummary=summary;self.opening=nil
  elseif self.phase=='ready' and not self.hpDrag and not (self.drag and self.drag.active) then
    say=self:changes(was)
  end
  if self.message~='' and self.message~=self.announced then say[#say+1]=self.message end;self.announced=self.message
  -- A failed save is announced by its message; the save that recovers it, once.
  if self.saveStatus=='failed' then self.saveFailed=true
  elseif self.saveStatus=='saved' and self.saveFailed then self.saveFailed=nil;say[#say+1]='Deck saved.'
  elseif self.phase~='ready' then self.saveFailed=nil end
  local m=self.modal
  -- A list's rows rebuild under the control that had focus, wherever it now is.
  local held=m and m.mode=='choices' and self.controls[self.focus]
  self:build()
  if held then
    for i,c in ipairs(self.controls)do if c.action==held.action and c.arg==held.arg then self.focus=i;break end end
  end
  if m and m.mode=='detail' and not m.heardDetails and self:detailsFor(m.id) then
    m.heardDetails=true;say[#say+1]=self:modalSpeech()
  end
  -- A list is announced once its rows arrive.
  if m and m.mode=='choices' and not m.heard and m.key and self.optionKey==m.key then
    m.heard=true;say[#say+1]=self:openingSpeech()
  end
  if #say>0 then self.callbacks.announce(table.concat(say,' ')) end
end
function Builder:add(label,x,y,w,h,action,colour,arg,extra)
  local b=extra or {};b.label,b.x,b.y,b.w,b.h,b.action,b.colour,b.arg,b.fontSize=label,x,y,w,h,action,colour or T.red,arg,24
  if b.disabled then b.colour=T.panel end
  self.controls[#self.controls+1]=b;return b
end
local function cleanDecklist(value)
  return (value or ''):gsub('\r\n','\n'):match('^%s*(.-)%s*$')
end
function Builder:refreshTransferControls()
  if not self.modal or self.modal.mode~='transfer' then return end
  local ready=self.transferBaseline~=nil and not self.importing
  local empty=cleanDecklist(self.transfer)==''
  for _,b in ipairs(self.controls)do
    if b.action=='import' then
      b.disabled=not ready or empty or cleanDecklist(self.transfer)==cleanDecklist(self.transferBaseline)
      b.colour=b.disabled and T.panel or T.blue
    elseif b.action=='copy' then
      b.disabled=not ready or empty;b.colour=b.disabled and T.panel or T.blue
    elseif b.multiline then b.disabled=not ready end
  end
end
function Builder:field(key,label,x,y,w,h,placeholder)
  return self:add(label,x,y,w,h,'input',T.ink,key,{input=true,placeholder=placeholder or ''})
end
function Builder:build()
  if not self.width then return end
  self:makeDeckCards()
  self.controls={};local p,w,h=self.portrait,self.width,self.height
  self.deckPageText:set('Page '..self.deckPage..'/'..math.max(1,math.ceil(#self:visibleDeck()/self:deckPageSize())),self.time)
  if self.modal then
    local m=self.modal;self.modal=nil;self:build();self.baseControls=self.controls;self.modal=m;self.controls={}
    m.w=p and 436 or (m.mode=='detail' and 940 or 760);m.h=p and 760 or 692;m.x=(w-m.w)/2;m.y=(h-m.h)/2
    if m.mode=='filters' then m.w=p and 436 or 680;m.h=584;m.x=(w-m.w)/2;m.y=(h-m.h)/2 end
    if m.mode=='stats' then m.w=p and 436 or 500;m.h=440;m.x=(w-m.w)/2;m.y=(h-m.h)/2 end
    local x,y,bw=m.x+24,m.y+76,m.w-48
    if m.mode=='detail' then
      local dx=p and x or x+332;local dw=p and bw or bw-332
      if not self.detailCard or self.detailCard.item.id~=m.id then
        if self.detailCard then self.detailCard.texture:release()end
        local item=self.selectedItem or m.item
        if item then self.detailCard=self:newCard(item,2,p and w/2 or x+142,p and m.y+205 or m.y+302,p and 1.25 or 1.9,false)end
      end
      local by=m.y+m.h-182
      self:add('Remove',dx,by,dw/2-6,42,self.selectedItem and self.selectedItem.kind=='' and 'discard' or 'remove',T.red,m.id,{disabled=not self.selectedItem or self.selectedItem.quantity==0})
      self:add('Add',dx+dw/2+6,by,dw/2-6,42,'add',T.blue,m.id,{disabled=not self.selectedItem or self.selectedItem.remaining==0})
      self:add(self.cover==m.id and 'Use automatic cover' or 'Use as cover',dx,by+54,dw,40,'cover',T.profile,self.cover==m.id and '' or m.id,{disabled=not self.selectedItem or self.selectedItem.quantity==0})
    elseif m.mode=='filters' then
      self:buildFilters(m,x,bw)
    elseif m.mode=='choices' then
      self:field('optionQuery','',x,y,bw,42,'Find an option')
      for i,o in ipairs(self.choices)do self:add(o.label,x,y+62+(i-1)*52,bw,40,'option-pick',o.selected and T.blue or T.red,o.value,{chosen=o.selected}).fontSize=22 end
      Pager.arrow(self:add('<',x,m.y+m.h-118,34,38,'option-page',T.red,-1),-1,self.optionPage,self.optionPages)
      Pager.arrow(self:add('>',x+bw-34,m.y+m.h-118,34,38,'option-page',T.red,1),1,self.optionPage,self.optionPages)
    elseif m.mode=='transfer' then
      self:add('',x,m.y+24,bw,m.h-208,'input',T.ink,'transfer',{multiline=true})
      self:add('Copy',x+bw-94,m.y+34,84,32,'copy',T.blue)
      self:add('Confirm',x,m.y+m.h-116,bw,42,'import',T.blue)
      self:refreshTransferControls()
    elseif m.mode=='clear' then
      self:add('Clear deck',x,m.y+m.h-130,bw,44,'clear',T.red)
    end
    self:add('Back',x,m.y+m.h-60,bw,40,'close',T.orange)
    return
  end
  -- Drawn first, reached last: Tab starts at the page's content.
  self:add('Back',p and 24 or 48,h-62,p and w-48 or w-96,40,'leave',T.orange,nil,{ringLast=true})
  if self.phase~='ready' then
    self:add(self.phase=='anonymous' and 'Sign in' or 'Try again',w/2-140,h/2+38,280,44,self.phase=='anonymous' and 'signin' or 'retry',T.red)
    return
  end
  if not p then self:field('name','',DECK_X,38,DECK_WIDTH-STATUS_WIDTH-8,42,'Deck name')end
  if p then
    self:add('Browse cards',24,38,208,42,'tab',self.tab=='catalog' and T.blue or T.red,'catalog')
    self:add('Deck '..self.count..'/'..Limits.deckSizeFor(self.format),248,38,208,42,'tab',self.tab=='deck' and T.blue or T.red,'deck')
  else
    self:add('Import / Export',816,h-132,286,44,'transfer',T.blue)
    self:add('Clear',1118,h-132,114,44,'confirm-clear',T.red)
  end
  if not p or self.tab=='catalog' then
    self:field('query','',p and 24 or 48,p and 98 or 38,p and 268 or 402,42,'Search cards')
    self:add('Filters',p and 306 or 464,p and 98 or 38,p and 150 or 116,42,'filters',T.red)
    if not p then self:add('Sort: '..SORT_LABELS[self.fields.sort or 'name'],594,38,170,42,'sort',T.blue).fontSize=22 end
    for i,c in ipairs(self.cards)do
      self.controls[#self.controls+1]={action='card',card=i,label=c.item.name,x=c.homeX-D.HALF_W*c.baseScale,y=c.homeY-D.HALF_H*c.baseScale,w=D.W*c.baseScale,h=D.H*c.baseScale}
    end
    local cx=p and w/2 or 408
    Pager.arrows(CATALOG_PAGER,cx,h-132,self.page,self.pages,function(label,ax,ay,aw,ah,dir)
      return self:add(label,ax,ay,aw,ah,'page',T.red,dir)
    end)
  end
  if not p or self.tab=='deck' then
    self:buildDeck()
    if p then
      self:field('name','',24,98,432-STATUS_WIDTH-8,42,'Deck name')
      self:add('Import / Export',24,158,290,42,'transfer',T.blue)
      self:add('Clear',328,158,128,42,'confirm-clear',T.red)
    end
  end
  -- The retry buttons keep their look, text and place (the user's rule for buttons).
  if self.saveStatus=='failed' then self:add(p and 'Retry save' or 'Retry',p and 24 or 1122,p and (self.tab=='deck' and h-124 or h-180) or h-83,p and 432 or 110,p and 36 or 18,'retry-save',T.red).fontSize=p and 24 or 16
  elseif self.retry then self:add(p and 'Retry loading' or 'Retry',p and 24 or 1122,p and (self.tab=='deck' and h-124 or h-180) or h-83,p and 432 or 110,p and 36 or 18,'retry',T.profile).fontSize=p and 24 or 16 end
  self:inflateTargets()
end
-- The deck rows' - and + and Retry answer the pointer over about 34x34 virtual pixels (24 CSS
-- px at least), around their unchanged faces and clear of every other control.
function Builder:inflateTargets()
  local small={}
  for _,b in ipairs(self.controls) do
    if b.rowAction or b.action=='retry-save' or b.action=='retry' then small[#small+1]=b end
  end
  local size=math.max(34,Display.units(24,Display.collection))
  HitArea.inflate(small,size,size,self.controls)
end
-- Portrait's catalog retry button covers the message line and the save caption's place.
function Builder:retryCoversLine()
  return self.portrait and self.tab~='deck' and (self.saveStatus=='failed' or self.retry) and true or false
end
-- Opens dialog `mode`; `focus`, when given, picks the control that takes keyboard focus.
function Builder:openModal(mode,item,focus)
  self:command('finish-input');self.editing='';self.focus=0;self.pressed=nil
  self.modal={mode=mode,item=item,id=item and item.id,key=item and item.key,motion=Modal.motion(self.reduced)}
  self:build()
  if focus then self:focusFirst(focus) end
  if mode=='detail' then self.modal.heardDetails=self:detailsFor(self.modal.id)~=nil end
  -- A list is announced by sync, once its rows arrive.
  if mode~='choices' or not self.modal.key then self.callbacks.announce(self:openingSpeech()) end
end
-- What a dialog says as it opens: what it draws, then the control focus starts on.
function Builder:openingSpeech()
  local focused=self.controls[self.focus]
  return self:modalSpeech()..(focused and ' '..self:describe(focused) or '')
end
-- The card's rules text once it has arrived for `id`, else nil.
function Builder:detailsFor(id)
  if id and self.selected==id and self.details~='' and self.details~=LOADING_DETAILS then return self.details end
end
local function sentence(parts)
  local out={}
  for _,part in ipairs(parts)do
    part=(part or ''):gsub('%s+',' '):gsub('^ ',''):gsub(' $','')
    if part~='' then out[#out+1]=part:find('[%.%?!]$') and part or part..'.' end
  end
  return table.concat(out,' ')
end
-- What an open dialog says: its title and what it draws.
function Builder:modalSpeech()
  local m=self.modal;if not m then return '' end
  if m.mode=='detail' then
    local item=(self.selectedItem and self.selectedItem.id==m.id) and self.selectedItem or m.item or {}
    local kind=table.concat({item.kind or '',item.subtype or ''},' '):gsub('^%s+',''):gsub('%s+$','')
    if (item.hp or '')~='' then kind=kind..(kind~='' and ', ' or '')..item.hp..' HP' end
    return sentence({item.name or 'Card',kind,(item.quantity or 0)..' in deck',gapLine(item.gaps) or '',self:detailsFor(m.id)})
  elseif m.mode=='filters' then
    return 'Filters, '..({'Cards','Print','Text'})[self.filterPage]..' tab. Tab moves between filters, Escape closes.'
  elseif m.mode=='stats' then
    local left,right=DeckStats.rows(self)
    local parts={MODAL_TITLES.stats}
    for _,r in ipairs(left)do parts[#parts+1]=r.label..': '..r.value:gsub('/',' of ') end
    for _,r in ipairs(right)do parts[#parts+1]=r.label..': '..r.value..r.suffix end
    return sentence(parts)
  elseif m.mode=='validation' then
    return sentence({MODAL_TITLES.validation,self.count..' of '..Limits.deckSizeFor(self.format)..' cards, '..formatName(self.format),self.validation})
  elseif m.mode=='clear' then
    return sentence({MODAL_TITLES.clear,'All cards will be removed','The deck itself will be kept','Clear deck or Back'})
  elseif m.mode=='choices' then
    return sentence({self.optionLabel~='' and self.optionLabel or MODAL_TITLES.choices,Pager.page(self.optionPage,self.optionPages)})
  end
  return sentence({MODAL_TITLES[m.mode] or m.mode,'Edit the decklist or paste one, then Confirm. Copy copies it'})
end
-- The deck entry, catalog card or selected card with this id.
function Builder:entry(id)
  for _,item in ipairs(self.deck)do if item.id==id then return item end end
  for _,item in ipairs(self.items)do if item.id==id then return item end end
  if self.selectedItem and self.selectedItem.id==id then return self.selectedItem end
  return self.modal and self.modal.item and self.modal.item.id==id and self.modal.item or nil
end
-- A deck entry as its row reads: quantity, name, and whether it breaks the format.
local function entrySpeech(item,format)
  if item.pending then return item.quantity..' x Loading card' end
  local text=item.quantity..' x '..item.name
  if item.illegal then return text..', not legal in '..formatName(format) end
  return text
end
-- A catalog card: its name, set and number, so two printings of one card differ.
local function cardSpeech(item)
  local set,number=item.id:match('^(.+)%-([^%-]+)$')
  local copies=item.quantity>0 and item.quantity..' in deck' or 'not in deck'
  return item.name..', '..(set or item.id):upper()..' '..(item.number~='' and item.number or number or '')..', '..copies
end
-- What a focused control says: its label, the value it shows, and what it acts on.
function Builder:describe(b)
  if not b then return '' end
  local a=b.action
  if b.input or b.multiline then
    local field=b.arg
    local value=field=='name' and self.name or field=='transfer' and self.transfer or self.fields[field] or ''
    local label=FIELD_LABELS[field] or field
    if field=='transfer' then
      local lines=0;for line in value:gmatch('[^\n]+')do if line:find('%S') then lines=lines+1 end end
      return label..', '..(lines==0 and 'empty' or lines..(lines==1 and ' line' or ' lines'))..'. Enter to edit.'
    end
    return label..': '..(value~='' and value or 'empty')..'. Enter to edit.'
  end
  if b.speech then return b.speech end
  if b.cycleKey then return self:cycleSpeech(b) end
  if a=='card' then return cardSpeech(self.cards[b.card].item) end
  if a=='detail' or a=='deck-card' then return entrySpeech(b.arg,self.format) end
  if a=='remove' or a=='discard' or a=='add' then
    local item=self:entry(b.arg) or {name='card',quantity=0}
    local verb=a=='add' and 'Add one ' or a=='remove' and 'Remove one ' or 'Discard '
    return verb..(item.pending and 'Loading card' or item.name)..', '..item.quantity..' in deck'
  end
  if a=='hp-slider' then
    return b.label..': '..((self.fields[b.arg] or '')~='' and self.fields[b.arg] or 'Any')..'. Left and right adjust it.'
  end
  if a=='tab' then
    local chosen=self.tab==b.arg and ', selected' or ''
    if b.arg=='deck' then return 'Deck tab'..chosen..', '..self.count..' of '..Limits.deckSizeFor(self.format)..' cards' end
    return 'Browse cards tab'..chosen
  end
  if a=='deck-type' then return b.label..' deck cards'..(self.deckType==b.arg and ', selected' or '') end
  if a=='filter-tab' then return b.label..' tab'..(self.filterPage==b.arg and ', selected' or '') end
  if a=='option-pick' then return b.label..(b.chosen and ', selected' or '') end
  if a=='transfer' then return 'Import or export decklist' end
  if a=='confirm-clear' or a=='clear' then return 'Clear deck' end
  if (a=='retry-save' or a=='retry') and b.label=='Retry' then return a=='retry' and 'Retry loading' or 'Retry save' end
  if a=='copy' then return 'Copy decklist' end
  if a=='import' then return 'Confirm import' end
  return b.label
end
-- Whether `id` is a deck entry whose card is still loading: not known to be gone, so not discarded.
function Builder:pendingEntry(id)
  for _,item in ipairs(self.deck)do if item.id==id then return item.pending==true end end
  return false
end
-- Acts on control i; `keyboard` when Enter or Space did.
function Builder:activate(i,keyboard)
  local b=self.controls[i];if not b or b.disabled or b.inert then return end
  local a,v=b.action,b.arg
  if (a=='discard' or a=='remove') and self:pendingEntry(v) then return end
  self.callbacks.feedback('button')
  if a=='input' then
    self.editing=v;local value=v=='name' and self.name or v=='transfer' and self.transfer or self.fields[v] or ''
    self.values[v]=value;self:command('input',v,value)
  elseif a=='hp-slider' then self.callbacks.announce(b.label..': use Left and Right to adjust, Home and End for the endpoints')
  elseif a=='card' then local item=self.cards[b.card].item;self:command('detail',item.id);self:openModal('detail',item)
  elseif a=='detail' or a=='deck-card' then self:command('detail',v.id);self:openModal('detail',v)
  elseif a=='close' then if self.modal and self.modal.mode=='choices' then self:closeList(keyboard) else self:closeModal() end
  elseif a=='signin' then self.callbacks.signin()
  elseif a=='filters' then self:openModal('filters')
  elseif a=='filter-tab' then self.filterPage=v;self:build();self.callbacks.announce(b.label..' tab')
  elseif a=='cycle' and keyboard and b.opensList then self:openList(v[1],b.optionTitle,true)
  elseif a=='cycle' then self:command('cycle',v[1],v[2])
  elseif a=='filter-value' then self:openList(v,b.optionTitle,keyboard)
  elseif a=='option-pick' then self.picked=v;self:command(a,v)
  elseif a=='transfer' then
    self.clipboard=nil;self.transfer='';self.transferBaseline=nil;self.exportRaw=nil
    self:openModal('transfer');self:command('export')
  elseif a=='import' then
    self:command('finish-input');self.editing='';self.clipboard=nil
    self.importing=true;self:refreshTransferControls()
    self:command('import',self.transfer)
  elseif a=='copy' then self:command('copy',self.transfer)
  elseif a=='confirm-clear' then self:openModal('clear')
  elseif a=='clear' then self:command('clear');self:closeModal()
  elseif a=='deck-info' then self:openModal('stats')
  elseif a=='validation' then self:openModal('validation')
  elseif a=='tab' then self.tab=v;self:build();self.callbacks.announce(self:describe(b))
  elseif a=='deck-type' then self.deckType=v;self.deckPage=1;self:build();self.callbacks.announce(v=='all' and 'All deck cards' or v..' deck cards')
  elseif a=='deck-view' then
    local first=(self.deckPage-1)*self:deckPageSize()
    self.deckView=self.deckView=='list' and 'cards' or 'list';self.deckPage=math.floor(first/self:deckPageSize())+1;self:build()
    self.callbacks.announce(self.deckView=='cards' and 'Deck card view' or 'Deck list view')
  elseif a=='deck-page' then self:turnDeckPage(v)
  else self:command(a,v or '') end
end
function Builder:hit(x,y,localCoords,hoverOnly)
  if not localCoords then y=y-self:offset()end
  if self.modal then y=y-self.modal.motion.VT.y*60 end
  for i=#self.controls,1,-1 do local b=self.controls[i]
    local c=b.action=='card' and self.cards[b.card] or b.action=='deck-card' and self.deckCards[b.deckCard]
    local inHoverArea=not hoverOnly or b.action~='hp-slider' or (y>=b.y+7 and y<=b.y+31)
    if inHoverArea and not b.disabled and (not b.inert or hoverOnly) and (c and c:hit(x,y) or not c and Button.hit(b,x,y))then return i end
  end;return 0
end
function Builder:update(dt,time,mx,my,reduced)
  self.time,self.reduced=time,reduced
  if self.motion then self.motion:update(dt,time,false,false,reduced)end
  my=my-self:offset();self.mx,self.my=mx,my
  CardFrame.open()
  for _,file in ipairs({'builder','builderInput','art','builderClipboard'})do
    local raw=Mailbox.read(file)
    if raw then
      if file=='builder' then self:sync(raw)
      elseif file=='builderInput' then
        local r=TextRecord.read(self,raw)
        if r then self.editing=r.action=='input' and r.field or '';self.values[r.field]=r.value;self.first,self.last=r.selectionStart,r.selectionEnd;if r.field=='transfer'then self.transfer=r.value;self.clipboard=nil end end
      elseif file=='art' and raw~=self.artRaw then
        self.artRaw=raw;local old=self.art;self.art=Mailbox.artMap(raw)
        for _,c in ipairs(self.cards)do if self.art[c.item.id] and old[c.item.id]~=self.art[c.item.id]then c:rebuild()end end
        for _,c in ipairs(self.deckCards)do if self.art[c.item.id] and old[c.item.id]~=self.art[c.item.id]then c:rebuild()end end
        if self.dragCard and self.art[self.dragCard.item.id]~=old[self.dragCard.item.id]then self.dragCard:rebuild()end
        if self.detailCard and self.art[self.detailCard.item.id]~=old[self.detailCard.item.id]then self.detailCard:rebuild()end
      elseif file=='builderClipboard' and raw~=self.clipboardRaw then self.clipboardRaw=raw;self.clipboard=Codec.fields(raw)[2] or raw end
    end
  end
  CardFrame.close()
  self:refreshTransferControls()
  if self.modal then self.modal.motion:update(dt,time,false,false,reduced)end
  self.hover=self:hit(mx,my,true,true)
  if self.hpDrag then self:slideHP(self.hpDrag,mx)end
  if self.drag then
    if math.abs(mx-self.drag.x)+math.abs(my-self.drag.y)>10 then self.drag.active=true end
    local c=self.drag.source=='deck' and self.dragCard or self.cards[self.drag.index]
    if self.drag.source=='deck' and self.drag.active and not c then
      c=self:newCard(self.drag.item,1,self.drag.homeX,self.drag.homeY,self.drag.scale,false);self.dragCard=c
      c.motion.T.r=self.drag.rotation or 0
      c.motion.VT.r=c.motion.T.r
      self:command('detail',self.drag.item.id)
    end
    if c then c.dragging=self.drag.active;c.targetX,c.targetY=mx,my end
  end
  for i,c in ipairs(self.cards)do
    local pointed=not self.modal and (self.controls[self.hover] or {}).card==i
    local focused=not self.modal and self.hover==0 and (self.controls[self.focus] or {}).card==i
    local active=pointed or focused
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.callbacks.feedback('paper1',1)end
    Collection.target(c,time,reduced,self.width)
    c:update(dt,time,active,reduced,focused)
  end
  for i,c in ipairs(self.deckCards)do
    local pointed=not self.modal and (self.controls[self.hover] or {}).deckCard==i
    local focused=not self.modal and self.hover==0 and (self.controls[self.focus] or {}).deckCard==i
    local active=pointed or focused
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.callbacks.feedback('paper1',1)end
    Collection.target(c,time,reduced,self.width)
    c:update(dt,time,active,reduced,focused)
  end
  if self.dragCard then
    local c=self.dragCard
    if c.returning then
      -- A sync may rearrange the visible deck while this card is returning.
      for _,home in ipairs(self.deckCards)do
        if home.item.id==c.item.id then c.homeX,c.homeY=home.homeX,home.homeY;c.motion.T.r=home.motion.T.r;break end
      end
    end
    c:update(dt,time,false,reduced)
    -- Keep the visible transform alive until Moveable has settled, including
    -- the drag enlargement and rotation. Reduced motion settles immediately.
    if c.returning and (reduced or (math.abs(c.x-c.homeX)<0.5 and math.abs(c.y-c.homeY)<0.5
      and math.abs(c.motion.VT.r-c.motion.T.r)<0.01 and math.abs(c.motion.VT.scale-1)<0.01))then
      c.texture:release();self.dragCard=nil
    end
  end
  if self.detailCard then self.detailCard:update(dt,time,self.detailCard:hit(mx,my-(self.modal and self.modal.motion.VT.y*60 or 0)),reduced)end
end
-- Drops any press, card drag or HP drag in progress.
function Builder:cancelInteractions()
  self.drag=nil;self.hpDrag=nil;self.pressed=nil
  if self.dragCard then self.dragCard.texture:release();self.dragCard=nil end
  for _,card in ipairs(self.cards) do card.dragging=false end
end
function Builder:mousepressed(x,y)
  self.focus=0;self.pressed=self:hit(x,y);local b=self.controls[self.pressed]
  if b and b.action=='hp-slider' then
    if self.editing~='' then self:command('finish-input');self.editing='' end
    self.hpDrag=b;self:slideHP(b,x)
  elseif b and b.action=='card' then self.drag={index=b.card,x=x,y=y-self:offset()}
  elseif b and (b.action=='detail' or b.action=='deck-card') then
    if self.dragCard then self.dragCard.texture:release();self.dragCard=nil end
    local home=b.deckCard and self.deckCards[b.deckCard]
    self.drag={source='deck',item=b.arg,x=x,y=y-self:offset(),
      homeX=home and home.homeX or b.x+b.w/2,homeY=home and home.homeY or b.y+b.h/2,
      scale=home and home.baseScale or 0.82,rotation=home and home.motion.T.r or 0}
  end
end
function Builder:mousereleased(x,y)
  if self.hpDrag then
    local control=self.hpDrag;self:slideHP(control,x);self.hpDrag=nil;self.pressed=nil
    self.callbacks.feedback('button');self.callbacks.announce(control.label..': '..((self.fields[control.arg] or '')~='' and self.fields[control.arg] or 'Any'));return
  end
  if self.drag and self.drag.active then
    local c=self.drag.source=='deck' and self.dragCard or self.cards[self.drag.index]
    if self.drag.source=='deck' then
      if c then c.dragging=false;c.returning=true end
      if self.portrait and y>self.height-160 or not self.portrait and x<800 then self:command('remove',self.drag.item.id);self.callbacks.feedback('cardSlide1')end
    elseif c then c.dragging=false;if self.portrait and y>self.height-160 or not self.portrait and x>800 then self:command('add',c.item.id);self.callbacks.feedback('cardSlide1')end end
  elseif self.pressed and self.pressed==self:hit(x,y)then self:activate(self.pressed)end
  self.drag=nil;self.pressed=nil
end
-- The page's shortcuts, listed in its canvas description: '/' opens the card search, 'D' focuses
-- the deck list, '-' and '+' change the focused deck entry by a copy. None works under a dialog.
-- Returns whether `key` is one.
local MINUS,PLUS={['-']=true,['kp-']=true},{['+']=true,['=']=true,['kp+']=true}
function Builder:focusFirst(pred)
  for i,b in ipairs(self.controls)do if pred(b) and not Controls.unfocusable(b) then self.focus=i;return i,b end end
end
function Builder:shortcut(key)
  if self.modal or self.phase~='ready' then return false end
  if key=='/' then
    if self.portrait and self.tab~='catalog' then self.tab='catalog';self:build() end
    local i=self:focusFirst(function(b) return b.input and b.arg=='query' end)
    if i then self:activate(i) end
  elseif key=='d' then
    if self.portrait and self.tab~='deck' then self.tab='deck';self:build() end
    local i,b=self:focusFirst(function(c) return c.deckRow or c.action=='deck-card' end)
    if not i then i,b=self:focusFirst(function(c) return c.action=='deck-type' and c.arg==self.deckType end) end
    if i then self.callbacks.announce(self:describe(b)) end
  elseif MINUS[key] or PLUS[key] then
    local b=self.controls[self.focus] or {}
    local item=(b.deckRow or b.action=='deck-card') and b.arg or b.rowAction and self:entry(b.arg)
    if not item or item.pending then return true end
    -- What the row's own - (x for an unavailable card) and + buttons send.
    if MINUS[key] and item.quantity>0 then self.callbacks.feedback('button');self:command(item.kind=='' and 'discard' or 'remove',item.id)
    elseif PLUS[key] and item.remaining>0 then self.callbacks.feedback('button');self:command('add',item.id) end
  else return false end
  return true
end
function Builder:keypressed(key)
  if self.editing~='' then return end
  local control=self.controls[self.focus]
  if control and control.action=='hp-slider' and (key=='left' or key=='right' or key=='home' or key=='end')then
    self:setHP(control.arg,key=='home' and 0 or key=='end' and 400 or self:hpValue(control.arg)+(key=='left' and -10 or 10))
    self.callbacks.announce(control.label..': '..((self.fields[control.arg] or '')~='' and self.fields[control.arg] or 'Any'))
  elseif control and control.cycleKey and (key=='left' or key=='right') then
    local dir=key=='left' and -1 or 1
    if control.action=='cycle' then self:command('cycle',control.cycleKey,dir) else self:command(control.action,dir) end
  elseif self:shortcut(key) then return
  elseif key=='escape' then if self.modal and self.modal.mode=='choices' then self:closeList(true) elseif self.modal then self:closeModal() else self:command('leave')end
  elseif key=='tab' or key=='right' or key=='down' or key=='left' or key=='up' then
    if #self.controls==0 then return end
    local found
    self.focus,found=Controls.move(self.focus,key,self.controls,nil,Controls.first(self.controls))
    if found then self.callbacks.announce(self:describe(self.controls[self.focus])) end
  elseif key=='return' or key=='space'then self:activate(self.focus,true)
  elseif not self.modal and (key=='pagedown' or key=='pageup')then self:command('page',key=='pageup' and -1 or 1)end
end
function Builder:wheelmoved(y)
  if self.modal then self.modal.scroll=math.max(0,(self.modal.scroll or 0)-y*36);return end
  if y==0 or not WheelPager.ready(self) then return end
  if not self.portrait and self.mx>800 or self.portrait and self.tab=='deck'then
    self:turnDeckPage(y>0 and -1 or 1)
  elseif not self.busy then self:command('page',y>0 and -1 or 1)end
end
function Builder:drawControls(controls,active)
  self:drawControlFaces(controls,active)
  -- Alerts sit on draw_layer 1: above every row face and action in the list.
  for _,b in ipairs(controls)do
    if b.deckRow and b.arg.illegal then DeckRow.drawAlert(b,self.time,self.reduced,self.width) end
  end
end
function Builder:drawControlFaces(controls,active)
  for i,b in ipairs(controls)do
    local lit=active and Controls.lit(self.hover,self.focus,i)
    if b.deckRow then
      DeckRow.draw(b,lit,self.width)
    elseif b.rowAction then
      DeckRow.action(b,lit,active and self.pressed==i,self.width)
    elseif b.input then
      local value=b.arg=='name' and self.name or self.fields[b.arg] or ''
      if self.editing==b.arg then value=self.values[b.arg] or value end
      Input.draw(b,value,active and self.editing==b.arg,self.first,self.last,self.time,b.disabled,lit)
    elseif b.action=='hp-slider' then
      local value=self:hpValue(b.arg)
      local label=(self.fields[b.arg] or '')~='' and self.fields[b.arg] or 'Any'
      Button.slider(b.x,b.y+7,b.w,value/400,label,lit)
    elseif b.cycleCentre then
      caption(b.optionTitle,24,b.x-36,b.y-30,b.cycleWidth,T.white)
      local spacing=b.pipCount>15 and 5.76 or 7.2
      local pips=b.pipCount>1 and b.pipCount<=25 and (b.pipCount-1)*spacing+4.8<=b.w-12
      Button.optionCycle(b.x,b.y,b.w,b.h,{hovered=active and self.hover==i,text=b.cycleText,textHeight=pips and 29 or b.h,
        time=self.time,reduced=self.reduced,roomWidth=self.width,
        pips=pips and {count=b.pipCount,spacing=spacing,index=b.pipIndex,set=b.pipSelected,off=T.panel} or nil})
    elseif b.multiline then
      self.transferArea:draw(b,self.transfer,active,self.editing=='transfer',self.first,self.last,self.time,lit,self.modal)
    elseif b.action~='card' and b.action~='deck-card' then
      local original=b.label
      b.label,b.fontSize=Fit.label(b.label,b.fontSize,b.w-16)
      Button.draw(b,lit and not b.disabled,active and self.pressed==i,lit and self.hover==0,self.width);b.label=original
      if b.icon then Button.icon(b,b.icon,active and self.pressed==i,self.width) end
      if (b.action=='deck-type' and b.arg==self.deckType) or (b.action=='filter-tab' and b.arg==self.filterPage) then Button.chosen(b,self.time,active and self.pressed==i,self.width,self.reduced)end
    end
  end
end
function Builder:draw(shaders)
  local w,h,p=self.width,self.height,self.portrait;Button.modalFrameRaised(p and 12 or 30,20,p and w-24 or w-60,h-30)
  if self.phase=='ready'then
    if not p or self.tab=='catalog'then
      Button.panel(p and 24 or 48,p and 155 or PANEL_Y,p and 432 or 716,p and 538 or PANEL_HEIGHT,T.panel)
      for _,c in ipairs(self.cards)do if not c.dragging then c:draw(shaders,self.time,self.mx,self.my,self.reduced,w)end end
      for _,c in ipairs(self.cards)do caption(c.item.quantity>0 and c.item.quantity..' in deck' or '',19,c.homeX-65,c.homeY+D.HALF_H*c.baseScale+12,130,T.paper)end
      if #self.cards==0 then T.text(self.busy and 'Loading cards...' or 'No matching cards',28,p and 24 or 48,360,p and 432 or 716,T.paper)end
      local cx=p and w/2 or 408
      Pager.draw(CATALOG_PAGER,cx,h-132,self.pageText,not self.modal,self.mx,self.my,self.time,self.reduced,w)
      if self:dropHint() then local mx,_,mw=self:messageLine();T.text(self.drag.source=='deck' and 'Drop here to remove one copy' or 'Drop here to add to deck',20,mx,h-170,mw,T.blue)end
    end
    if not p or self.tab=='deck'then
      self:drawDeck(shaders)
    end
    local mx,my,mw=self:messageLine();local covered=self:retryCoversLine()
    if self.message~='' and not self:dropHint() and not covered then caption(self.message,18,mx,my,mw,T.paper,'left')end
    local status=self:saveCaption()
    if status and not covered then
      local sx,sy,sw,sh=self:statusSlot();local failed=self.saveStatus=='failed'
      caption(status,18,sx,sy+(sh-18)/2,sw,failed and T.red or T.paper,'center')
    end
  else
    T.text(self.phase=='loading' and 'Opening your deck...' or self.phase=='anonymous' and 'Sign in to build your deck' or 'Could not open this deck',p and 28 or 40,24,h/2-42,w-48)
  end
  local controls=self.modal and self.baseControls or self.controls
  self:drawControls(controls,not self.modal)
  for _,c in ipairs(self.cards)do if c.dragging then c:draw(shaders,self.time,self.mx,self.my,self.reduced,w)end end
  if self.dragCard then
    self.dragCard:draw(shaders,self.time,self.mx,self.my,self.reduced,w)
    if self.dragCard.item.illegal then Alert.drawOnCard(self.dragCard,self.time,self.reduced,w,Alert.gallery) end
  end
end
function Builder:drawModal(shaders)
  local m=self.modal;if not m then return end
  local p,w=self.portrait,self.width;g.push();g.translate(0,m.motion.VT.y*60);Button.modalFrameRaised(m.x,m.y,m.w,m.h)
  local x,y,bw=m.x+24,m.y+76,m.w-48
  if m.mode=='detail'then
    local item=self.selectedItem or m.item
    caption(item and item.name or 'Card',34,x,m.y+20,bw)
    if self.detailCard then self.detailCard:draw(shaders,self.time,self.mx,self.my-m.motion.VT.y*60,self.reduced,w)end
    local dx=p and x or x+332;local dw=p and bw or bw-332;local dy=p and m.y+342 or y
    caption(item and (item.kind..'  '..item.subtype..(item.hp~='' and '  '..item.hp..' HP' or '')) or '',22,dx,dy,dw,T.paper)
    caption(item and (item.quantity..' in deck  |  '..item.id) or '',20,dx,dy+32,dw,T.paper)
    Button.panel(dx,dy+70,dw,(p and 166 or 330),T.panel)
    local warning=item and gapLine(item.gaps);local top=warning and 25 or 0
    if warning then caption(warning,20,dx+12,dy+80,dw-24,T.red,'left')end
    local _,lines=T.font(22):getWrap(self.details,dw-24);local max=(p and 5 or 12)-(warning and 1 or 0)
    local start=math.max(1,math.min(math.max(1,#lines-max+1),math.floor((m.scroll or 0)/25)+1))
    for i=start,math.min(#lines,start+max-1)do T.text(lines[i],22,dx+12,dy+80+top+(i-start)*25,dw-24,T.paper,'left')end
  elseif m.mode=='filters'then
    self:drawFilters(m,bw)
  elseif m.mode=='choices'then
    caption(self.optionLabel,32,x,m.y+22,bw)
    T.text('Page '..self.optionPage..'/'..self.optionPages,24,x+44,m.y+m.h-113,bw-88,T.paper)
  elseif m.mode=='stats'then
    DeckStats.draw(self,m,p)
  elseif m.mode=='validation'then
    T.text('Deck details',36,x,m.y+22,bw)
    T.text(self.count..'/'..Limits.deckSizeFor(self.format)..' cards - '..self.format,28,x,y,bw,T.paper)
    local _,lines=T.font(24):getWrap(self.validation,bw-24);local max=16;local start=math.max(1,math.min(math.max(1,#lines-max+1),math.floor((m.scroll or 0)/28)+1))
    for i=start,math.min(#lines,start+max-1)do T.text(lines[i],24,x+12,y+60+(i-start)*28,bw-24,T.paper,'left')end
  elseif m.mode=='clear'then
    T.text('Clear this deck?',36,x,m.y+22,bw);T.text('All cards will be removed.\nThe deck itself will be kept.',28,x,y+130,bw,T.paper)
  end
  self:drawControls(self.controls,true)
  if m.mode=='transfer' then caption(self.clipboard or self.message,20,x,m.y+m.h-174,bw,T.paper)end
  g.pop()
end
-- The deck panel's and the filters dialog's methods (ui/builder_deck.lua, ui/builder_filters.lua).
for _,part in ipairs({Deck,Filters}) do
  for name,method in pairs(part.methods) do Builder[name]=method end
end
return Builder
