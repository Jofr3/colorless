local D=require('ui.card_dimensions')
local WheelPager=require('ui.wheel_pager')
local T=require('ui.theme')
local Controls=require('ui.controls')
local Button=require('ui.button')
local Card=require('ui.card')
local Collection=require('ui.collection_motion')
local CardFrame=require('ui.card_frame')
local DeckLabels=require('ui.deck_labels')
local DeckStats=require('ui.deck_stats')
local Limits=require('ui.limits')
local DeckRow=require('ui.deck_row')
local Alert=require('ui.card_alert')
local Energy=require('ui.energy')
local PageText=require('ui.page_text')
local Modal=require('ui.modal')
local Codec=require('ui.codec')
local Mailbox=require('ui.mailbox')
local W=require('ui.wire_fields').builder
local Fit=require('ui.text_fit')
local Input=require('ui.text_input')
local g=love.graphics
local PANEL_Y,PANEL_HEIGHT=95,554
local DECK_X,DECK_WIDTH=808,424
local deckTypes={{key='all',label='All'},{key='Pokémon',label='Pokemon'},{key='Trainer',label='Trainer'},{key='Energy',label='Energy'}}
local Builder={}; Builder.__index=Builder
-- The printed parts the simulator cannot play yet, by the engine's gap names.
local GAP_LABELS={trainer='card effect',ability='Ability',specialEnergy='Energy effect',attack='attack effect'}
local function gapLine(gaps)
  local parts={};for gap in (gaps or ''):gmatch('[^,]+') do parts[#parts+1]=GAP_LABELS[gap] or gap end
  return #parts>0 and 'Not simulated yet: '..table.concat(parts,', ') or nil
end
local function caption(text,size,x,y,w,colour,align)
  text=(text or ''):gsub('%c',' ')
  size=Fit.shrink(text,size,14,w)
  if T.font(size):getWidth(text)>w then
    local out='';for c in Fit.chars(text) do
      if T.font(size):getWidth(out..'...')>w then break end;out=out..c
    end;text=out..'...'
  end
  T.text(text,size,x,y,w,colour,align)
end
function Builder.new(callbacks)
  return setmetatable({callbacks=callbacks,phase='loading',time=0,hover=0,focus=0,controls={},cards={},deckCards={},deckView='list',items={},deck={},options={},fields={},art={},pageText=PageText.new(),deckPageText=PageText.new(),page=1,pages=1,total=0,count=0,name='',format='standard',message='',saveStatus='',details='',transfer='',deckPage=1,deckType='all',tab='catalog',filterPage=1,editing='',values={},validation='',groups={0,0,0},choices={},optionLabel='',optionPage=1,optionPages=1},Builder)
end
function Builder:command(...)
  Codec.command(self.callbacks.command,...)
end
function Builder:open(reduced,id)
  if self.dragCard then self.dragCard.texture:release();self.dragCard=nil end
  self.motion=Modal.motion(reduced);self.id=id;self.modal=nil;self.focus=0;self.deckPage=1;self.deckType='all'
  self:command('open',id or '')
end
function Builder:offset() return self.motion and self.motion.VT.y*60 or 0 end
function Builder:closeModal()
  self.hpDrag=nil
  local returnTo=self.modal and self.modal.returnTo
  if self.modal and self.modal.mode=='transfer' then self:command('cancel-import')end
  self:command('finish-input');self.editing='';self.modal=nil;self.focus=0;self.pressed=nil
  if self.detailCard then self.detailCard.texture:release();self.detailCard=nil end
  if returnTo then self:openModal(returnTo)else self:build()end
end
function Builder:visibleDeck()
  if self.deckType=='all' then return self.deck end
  local visible={}
  for _,item in ipairs(self.deck)do
    local kind=item.kind=='Pokemon' and 'Pokémon' or item.kind
    if kind==self.deckType then visible[#visible+1]=item end
  end
  return visible
end
function Builder:deckPageSize() return self.deckView=='cards' and 6 or (self.portrait and 8 or 9) end
function Builder:deckPager()
  local cx=self.portrait and self.width/2 or DECK_X+DECK_WIDTH/2
  return cx-174,self.portrait and 655 or PANEL_Y+500
end
function Builder:makeDeckCards()
  local items={};local signature={self.deckView,tostring(self.width),tostring(self.deckPage),self.deckType}
  if self.deckView=='cards' and self.phase=='ready' then
    local visible=self:visibleDeck()
    local pageSize=self:deckPageSize()
    for i=(self.deckPage-1)*pageSize+1,math.min(#visible,self.deckPage*pageSize)do items[#items+1]=visible[i];signature[#signature+1]=table.concat({visible[i].id,visible[i].name,visible[i].kind or ''},':') end
  end
  signature=table.concat(signature,'|')
  if signature~=self.deckCardSignature then
    self.deckCardSignature=signature
    for _,c in ipairs(self.deckCards)do c.texture:release()end;self.deckCards={}
    local p=self.portrait;local left=p and 24 or DECK_X;local span=p and 432 or DECK_WIDTH
    for i,item in ipairs(items)do
      local cx=left+span*((i-1)%3+0.5)/3
      local cy=(p and 367 or 269)+math.floor((i-1)/3)*(p and 170 or 201)
      self.deckCards[i]=self:newCard(item,i,cx,cy,p and 0.72 or 0.84,{count=3,column=(i-1)%3,center=left+span/2,entering=true})
    end
  else
    for i,c in ipairs(self.deckCards)do c.item.quantity=items[i].quantity;c.item.remaining=items[i].remaining;c.item.copyLimit=items[i].copyLimit;c.item.illegal=items[i].illegal end
  end
  local ids={};for _,item in ipairs(items)do ids[#ids+1]=item.id end
  -- Stage the artwork of the deck pages either side, nearest first.
  local nearby={}
  if #items>0 then
    local visible,pageSize=self:visibleDeck(),self:deckPageSize()
    for _,d in ipairs({1,-1,2,-2})do
      local page=self.deckPage+d
      for i=(page-1)*pageSize+1,page*pageSize do if i>=1 and visible[i] then nearby[#nearby+1]=visible[i].id end end
    end
  end
  local preview=table.concat(ids,'\n')..'\t'..table.concat(nearby,'\n')
  if preview~=self.deckPreview then self.deckPreview=preview;self:command('preview-cards',table.concat(ids,'\n'),table.concat(nearby,'\n'))end
end
function Builder:layout(w,h)
  self.hpDrag=nil
  if self.dragCard then self.dragCard.texture:release();self.dragCard=nil end
  self.width,self.height=w,h;self.portrait=w<600
  self.deckPage=math.max(1,math.min(self.deckPage,math.ceil(#self:visibleDeck()/self:deckPageSize())))
  if self.detailCard then self.detailCard.texture:release();self.detailCard=nil end
  self:command('size',self.portrait and 4 or 8)
  self:makeCards(false);self:build()
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
-- tcgdex ships no art for basic Energy (sve, mee, mfb), so an Energy without
-- art gets a generated face in its type's colour: the name across the top,
-- the pixel pip large in the middle, and the subtype at the foot.
function Builder.energyFace(item,w,h)
  local kind=Energy.normalise((item.name or ''):gsub('%s*Energy%s*$',''))
  local c=Energy.colour(kind)
  local light=kind=='Colorless' or kind=='Metal' or kind=='Lightning' or kind=='Special'
  local text=light and T.ink or T.white
  T.box(0,0,w,h,T.paper,4)
  T.box(4,4,w-8,h-8,c,4)
  -- A darker inner field, stippled like the generated card faces.
  g.setColor(0,0,0,0.18);T.box(10,30,w-20,h-66,{0,0,0,0.18},3)
  g.setColor(0,0,0,0.12)
  for x=16,w-20,8 do for y=36,h-44,8 do g.rectangle('fill',x,y,2,2) end end
  T.text(item.name,17,8,8,w-16,text)
  Energy.pip(w/2,h/2-4,34,kind)
  T.text(item.subtype~='' and item.subtype or 'Basic Energy',14,8,h-28,w-16,text)
end
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
end
function Builder:sync(raw)
  if not raw or raw==self.raw then return end;self.raw=raw
  local lines=Codec.rows(raw)
  local H=W.header
  local f=lines[1];if not f or #f<H.dirty then return end
  self.phase,self.name,self.format,self.saveStatus,self.message=f[H.phase],f[H.name],f[H.format],f[H.saveStatus],f[H.message]
  self.busy=f[H.busy]=='1';self.page,self.pages,self.total,self.count=tonumber(f[H.page]),tonumber(f[H.pages]),tonumber(f[H.total]),tonumber(f[H.count])
  self.selected,self.details=f[H.selected],f[H.details]
  if f[H.transfer]~=self.exportRaw then
    self.exportRaw=f[H.transfer];self.transfer=f[H.transfer];self.transferBaseline=f[H.transfer]
  end
  self.cover=f[H.cover];self.importing=f[H.importing]=='1';self.dirty=f[H.dirty]=='1'
  self.options={};self.choices={};self.deck={};self.items={};self.selectedItem=nil
  local signature={tostring(self.page)}
  for i=2,#lines do local r=lines[i]
    if r[1]=='C' or r[1]=='D' or r[1]=='S' then
      local c=W.card
      local item={id=r[c.cardId],name=r[c.name],kind=r[c.supertype],subtype=r[c.subtype],quantity=tonumber(r[c.quantity]) or 0,remaining=tonumber(r[c.remaining]) or 0,
        hp=r[c.hp] or '',mark=r[c.mark] or '',number=r[c.number] or '',copyLimit=tonumber(r[c.copyLimit]) or 4,illegal=r[c.illegal]=='1',gaps=r[c.gaps] or ''}
      if r[1]=='C' then self.items[#self.items+1]=item;signature[#signature+1]=item.id
      elseif r[1]=='D' then self.deck[#self.deck+1]=item
      else self.selectedItem=item end
    elseif r[1]=='V' then local v=W.validation;self.validation=r[v.message];self.groups={r[v.pokemon],r[v.trainer],r[v.energy]}
    elseif r[1]=='O' then local o=W.option
      self.options[#self.options+1]={key=r[o.key],label=r[o.label],value=r[o.value],count=tonumber(r[o.count]) or 0,index=tonumber(r[o.index]) or 1,selected=r[o.selected]}
    elseif r[1]=='P' then local p=W.picker
      self.optionLabel=r[p.label];self.optionPage=tonumber(r[p.page]);self.optionPages=tonumber(r[p.pages]);self.fields.optionQuery=r[p.query]
    elseif r[1]=='Q' then local q=W.choice;self.choices[#self.choices+1]={value=r[q.value],label=r[q.label],selected=r[q.selected]=='1'}
    elseif r[1]=='F' then self.fields[r[W.field.key]]=r[W.field.value] end
  end
  signature=table.concat(signature,'|')
  if signature~=self.signature then self.signature=signature;self:makeCards(true)
  else for i,c in ipairs(self.cards)do c.item.quantity=self.items[i].quantity;c.item.remaining=self.items[i].remaining end end
  self.deckPage=math.max(1,math.min(self.deckPage,math.ceil(#self:visibleDeck()/self:deckPageSize())))
  self.pageText:set('Page '..self.page..'/'..self.pages,self.time)
  if self.message~='' and self.message~=self.announced then self.callbacks.announce(self.message) end;self.announced=self.message
  self:build()
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
function Builder:filterCycle(label,value,key,y,count,index,selected,x,width)
  width=width or 264;x=x or self.width/2-width/2
  local centreWidth=width-72
  local action=key=='format' and 'format' or 'cycle'
  self:add('<',x,y,28.8,38.4,action,T.red,key=='format' and -1 or {key,-1}).fontSize=24
  self.filterTexts=self.filterTexts or {}
  local text=self.filterTexts[key] or PageText.new();self.filterTexts[key]=text
  -- Keep long catalog values within the original narrow cycle.
  local display=value
  local limit=(centreWidth-12)/(0.4*0.3)
  if T.font(200):getWidth(display)>limit then
    display=Fit.ellipsize(value,limit,function(s) return T.font(200):getWidth(s) end)
  end
  text:set(display,self.time)
  self:add(value,x+36,y,centreWidth,38.4,'filter-value',T.red,key,
    {cycleCentre=true,inert=true,cycleWidth=width,optionTitle=label,cycleText=text,pipCount=count or 0,pipIndex=index or 1,pipSelected=selected})
  self:add('>',x+width-28.8,y,28.8,38.4,action,T.red,key=='format' and 1 or {key,1}).fontSize=24
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
      local labels={'Cards','Print','Text'}
      local tw,gap=p and 114 or 150,p and 8 or 12
      local left=m.x+(m.w-3*tw-2*gap)/2
      for i,label in ipairs(labels)do self:add(label,left+(i-1)*(tw+gap),m.y+34,tw,48,'filter-tab',T.red,i).fontSize=p and 24 or 30 end
      if self.filterPage<3 then
        local inputs={}
        if self.filterPage==1 then inputs[1]={label='Format',value=self.format=='standard' and 'Standard' or 'Expanded',key='format',count=2,index=self.format=='standard' and 1 or 2}end
        local first=self.filterPage==1 and 1 or 7;local last=self.filterPage==1 and 6 or 10
        for i=first,last do if self.options[i]then inputs[#inputs+1]=self.options[i]end end
        local columnGap=p and 12 or 24
        local columnWidth=(bw-columnGap)/2
        local cycleWidth=math.min(264,columnWidth)
        for i,o in ipairs(inputs)do
          local cx=x+((i-1)%2)*(columnWidth+columnGap)+(columnWidth-cycleWidth)/2
          local cy=m.y+124+math.floor((i-1)/2)*90
          self:filterCycle(o.label,o.value,o.key,cy,o.count,o.index,o.selected,cx,cycleWidth)
        end
      else
        local fw=math.min(360,bw);local fx=m.x+(m.w-fw)/2
        self:field('text','Rules text',fx,m.y+164,fw,44,'Search abilities and attacks')
        self:add('Minimum HP',self.width/2-148,m.y+270,240,40,'hp-slider',T.red,'hpMin')
        self:add('Maximum HP',self.width/2-148,m.y+376,240,40,'hp-slider',T.red,'hpMax')
      end
      self:add('Reset filters',x,m.y+m.h-106,bw,34,'reset',T.profile)
    elseif m.mode=='choices' then
      self:field('optionQuery','',x,y,bw,42,'Find an option')
      for i,o in ipairs(self.choices)do self:add(o.label,x,y+62+(i-1)*52,bw,40,'option-pick',o.selected and T.blue or T.red,o.value).fontSize=22 end
      self:add('<',x,m.y+m.h-118,34,38,'option-page',T.red,-1)
      self:add('>',x+bw-34,m.y+m.h-118,34,38,'option-page',T.red,1)
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
  self:add('Back',p and 24 or 48,h-62,p and w-48 or w-96,40,'leave',T.orange)
  if self.phase~='ready' then
    self:add(self.phase=='anonymous' and 'Sign in' or 'Try again',w/2-140,h/2+38,280,44,self.phase=='anonymous' and 'signin' or 'retry',T.red)
    return
  end
  if not p then self:field('name','',DECK_X,38,DECK_WIDTH,42,'Deck name')end
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
    if not p then self:add('Sort: '..({name='Name',['hp-desc']='HP',set='Set'})[self.fields.sort or 'name'],594,38,170,42,'sort',T.blue).fontSize=22 end
    for i,c in ipairs(self.cards)do
      self.controls[#self.controls+1]={action='card',card=i,label=c.item.name,x=c.homeX-D.HALF_W*c.baseScale,y=c.homeY-D.HALF_H*c.baseScale,w=D.W*c.baseScale,h=D.H*c.baseScale}
    end
    local cx=p and w/2 or 408
    self:add('<',cx-177,h-132,36,44,'page',T.red,-1).fontSize=30
    self:add('>',cx+141,h-132,36,44,'page',T.red,1).fontSize=30
  end
  if not p or self.tab=='deck' then
    local x=p and 24 or DECK_X+8;local bw=p and 432 or DECK_WIDTH-16;local y=p and 291 or 179
    local allWidth=56
    local tabWidth=(bw-40-allWidth)/3
    local tabX=x+8
    for i,kind in ipairs(deckTypes)do
      local width=i==1 and allWidth or tabWidth
      self:add(kind.label,tabX,p and 237 or PANEL_Y+24,width,44,'deck-type',T.red,kind.key).fontSize=24
      tabX=tabX+width+8
    end
    local pageSize=self:deckPageSize();local visible=self:visibleDeck()
    if self.deckView=='list' then
    for i=(self.deckPage-1)*pageSize+1,math.min(#visible,self.deckPage*pageSize)do local item=visible[i];local yy=y+((i-1)%pageSize)*(p and 42 or 45)
      local rowWidth=bw-16
      self:add(item.name,x+8,yy,rowWidth-81,36,'detail',T.panel,item,{deckRow=true,rowWidth=rowWidth})
      self:add(item.kind=='' and 'x' or '-',x+8+rowWidth-78,yy+6,34,24,item.kind=='' and 'discard' or 'remove',T.red,item.id,{rowAction=true})
      self:add('+',x+8+rowWidth-40,yy+6,34,24,'add',T.blue,item.id,{rowAction=true,disabled=item.remaining==0})
    end
    else
      for i,c in ipairs(self.deckCards)do
        self.controls[#self.controls+1]={action='deck-card',deckCard=i,arg=c.item,label=c.item.quantity..' x '..c.item.name,x=c.homeX-D.HALF_W*c.baseScale,y=c.homeY-D.HALF_H*c.baseScale,w=D.W*c.baseScale,h=D.H*c.baseScale}
      end
    end
    local pagerX,pagerY=self:deckPager()
    self:add('<',pagerX,pagerY,30,36,'deck-page',T.red,-1).fontSize=26
    self:add('>',pagerX+212,pagerY,30,36,'deck-page',T.red,1).fontSize=26
    self:add(self.deckView=='list' and 'Show cards' or 'Show list',pagerX+256,pagerY,40,36,'deck-view',T.profile,nil,{icon=self.deckView=='list' and 'cards' or 'list',displayLabel=''})
    self:add('Deck information',pagerX+308,pagerY,40,36,'deck-info',T.profile,nil,{icon='info',displayLabel=''})
    if p then
      self:field('name','',24,98,432,42,'Deck name')
      self:add('Import / Export',24,158,290,42,'transfer',T.blue)
      self:add('Clear',328,158,128,42,'confirm-clear',T.red)
    end
  end
  if self.saveStatus=='failed' then self:add(p and 'Retry save' or 'Retry',p and 24 or 1122,p and (self.tab=='deck' and h-124 or h-180) or h-86,p and 432 or 110,p and 36 or 20,'retry-save',T.red).fontSize=p and 24 or 18
  elseif self.message~='' then self:add(p and 'Retry loading' or 'Retry',p and 24 or 1122,p and (self.tab=='deck' and h-124 or h-180) or h-86,p and 432 or 110,p and 36 or 20,'retry',T.profile).fontSize=p and 24 or 18 end
end
function Builder:openModal(mode,item)
  self:command('finish-input');self.editing='';self.focus=0;self.pressed=nil
  self.modal={mode=mode,item=item,id=item and item.id,motion=Modal.motion(self.reduced)}
  self:build()
end
function Builder:activate(i)
  local b=self.controls[i];if not b or b.disabled or b.inert then return end
  local a,v=b.action,b.arg;self.callbacks.feedback('button')
  if a=='input' then
    self.editing=v;local value=v=='name' and self.name or v=='transfer' and self.transfer or self.fields[v] or ''
    self.values[v]=value;self:command('input',v,value)
  elseif a=='hp-slider' then self.callbacks.announce(b.label..': use Left and Right to adjust, Home and End for the endpoints')
  elseif a=='card' then local item=self.cards[b.card].item;self:command('detail',item.id);self:openModal('detail',item)
  elseif a=='detail' or a=='deck-card' then self:command('detail',v.id);self:openModal('detail',v)
  elseif a=='close' then local choices=self.modal and self.modal.mode=='choices';self:closeModal();if choices then self:openModal('filters')end
  elseif a=='signin' then self.callbacks.signin()
  elseif a=='filters' then self:openModal('filters')
  elseif a=='filter-tab' then self.filterPage=v;self:build()
  elseif a=='cycle' then self:command('cycle',v[1],v[2])
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
  elseif a=='tab' then self.tab=v;self:build()
  elseif a=='deck-type' then self.deckType=v;self.deckPage=1;self:build();self.callbacks.announce(v=='all' and 'All deck cards' or v..' deck cards')
  elseif a=='deck-view' then
    local first=(self.deckPage-1)*self:deckPageSize()
    self.deckView=self.deckView=='list' and 'cards' or 'list';self.deckPage=math.floor(first/self:deckPageSize())+1;self:build()
    self.callbacks.announce(self.deckView=='cards' and 'Deck card view' or 'Deck list view')
  elseif a=='deck-page' then self.deckPage=math.max(1,math.min(math.max(1,math.ceil(#self:visibleDeck()/self:deckPageSize())),self.deckPage+v));self:build()
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
  for _,file in ipairs({'builder','builderInput','art','builderClipboard'})do
    local raw=Mailbox.read(file)
    if raw then
      if file=='builder' then self:sync(raw)
      elseif file=='builderInput' and raw~=self.inputRaw then
        self.inputRaw=raw;local f=Codec.fields(raw);self.editing=f[6]=='input' and f[2] or '';self.values[f[2]]=f[3];self.first,self.last=tonumber(f[4]),tonumber(f[5]);if f[2]=='transfer'then self.transfer=f[3];self.clipboard=nil end
      elseif file=='art' and raw~=self.artRaw then
        self.artRaw=raw;local old=self.art;self.art=Mailbox.artMap(raw)
        for _,c in ipairs(self.cards)do if self.art[c.item.id] and old[c.item.id]~=self.art[c.item.id]then c:rebuild()end end
        for _,c in ipairs(self.deckCards)do if self.art[c.item.id] and old[c.item.id]~=self.art[c.item.id]then c:rebuild()end end
        if self.dragCard and self.art[self.dragCard.item.id]~=old[self.dragCard.item.id]then self.dragCard:rebuild()end
        if self.detailCard and self.art[self.detailCard.item.id]~=old[self.detailCard.item.id]then self.detailCard:rebuild()end
      elseif file=='builderClipboard' and raw~=self.clipboardRaw then self.clipboardRaw=raw;self.clipboard=Codec.fields(raw)[2] or raw end
    end
  end
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
    local active=not self.modal and ((self.controls[self.hover] or {}).card==i or (self.controls[self.focus] or {}).card==i)
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.callbacks.feedback('paper1',1)end
    Collection.target(c,time,reduced,self.width)
    c:update(dt,time,active,reduced)
  end
  for i,c in ipairs(self.deckCards)do
    local active=not self.modal and ((self.controls[self.hover] or {}).deckCard==i or (self.controls[self.focus] or {}).deckCard==i)
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.callbacks.feedback('paper1',1)end
    Collection.target(c,time,reduced,self.width)
    c:update(dt,time,active,reduced)
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
-- Ten-HP steps; the minimum's left endpoint and maximum's right endpoint
-- restore the unbounded filter (Any), including cards with no HP field.
function Builder:hpValue(key)
  return tonumber(self.fields[key]) or (key=='hpMin' and 0 or 400)
end
function Builder:setHP(key,value)
  value=math.max(0,math.min(400,math.floor(value/10+0.5)*10))
  if key=='hpMin' and tonumber(self.fields.hpMax)then value=math.min(value,tonumber(self.fields.hpMax))end
  if key=='hpMax' and tonumber(self.fields.hpMin)then value=math.max(value,tonumber(self.fields.hpMin))end
  local text=(key=='hpMin' and value==0 or key=='hpMax' and value==400) and '' or tostring(value)
  if text~=(self.fields[key] or '')then self.fields[key]=text;self:command('filter',key,text)end
end
function Builder:slideHP(control,x)
  self:setHP(control.arg,400*(x-control.x)/control.w)
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
function Builder:keypressed(key)
  if self.editing~='' then return end
  local control=self.controls[self.focus]
  if control and control.action=='hp-slider' and (key=='left' or key=='right' or key=='home' or key=='end')then
    self:setHP(control.arg,key=='home' and 0 or key=='end' and 400 or self:hpValue(control.arg)+(key=='left' and -10 or 10))
    self.callbacks.announce(control.label..': '..((self.fields[control.arg] or '')~='' and self.fields[control.arg] or 'Any'))
  elseif key=='escape' then if self.modal then local choices=self.modal.mode=='choices';self:closeModal();if choices then self:openModal('filters')end else self:command('leave')end
  elseif key=='tab' or key=='right' or key=='down' or key=='left' or key=='up' then
    if #self.controls==0 then return end
    self.focus=Controls.cycle(self.focus,Controls.backward(key) and -1 or 1,#self.controls,function(i) return self.controls[i].disabled or self.controls[i].inert end)
    self.callbacks.announce(self.controls[self.focus].label)
  elseif key=='return' or key=='space'then self:activate(self.focus)
  elseif not self.modal and (key=='pagedown' or key=='pageup')then self:command('page',key=='pageup' and -1 or 1)end
end
function Builder:wheelmoved(y)
  if self.modal then self.modal.scroll=math.max(0,(self.modal.scroll or 0)-y*36);return end
  if y==0 or not WheelPager.ready(self) then return end
  if not self.portrait and self.mx>800 or self.portrait and self.tab=='deck'then
    self.deckPage=math.max(1,math.min(math.max(1,math.ceil(#self:visibleDeck()/self:deckPageSize())),self.deckPage+(y>0 and -1 or 1)));self:build()
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
    if b.deckRow then
      DeckRow.draw(b,active and (self.hover==i or self.focus==i),self.width)
    elseif b.rowAction then
      DeckRow.action(b,active and (self.hover==i or self.focus==i),active and self.pressed==i,self.width)
    elseif b.input then
      local value=b.arg=='name' and self.name or self.fields[b.arg] or ''
      if self.editing==b.arg then value=self.values[b.arg] or value end
      Input.draw(b,value,active and self.editing==b.arg,self.first,self.last,self.time,b.disabled,active and self.hover==i)
    elseif b.action=='hp-slider' then
      local highlighted=active and self.hover==i
      local value=self:hpValue(b.arg)
      local label=(self.fields[b.arg] or '')~='' and self.fields[b.arg] or 'Any'
      Button.slider(b.x,b.y+7,b.w,value/400,label,highlighted)
    elseif b.cycleCentre then
      caption(b.optionTitle,24,b.x-36,b.y-30,b.cycleWidth,T.white)
      local hovered=active and self.hover==i
      local depth=hovered and 0.5 or 0.7
      Button.panel(b.x,b.y+6,b.w,b.h,{T.red[1]*depth,T.red[2]*depth,T.red[3]*depth,1})
      Button.panel(b.x,b.y,b.w,b.h,Button.hoverColour(T.red,hovered))
      local spacing=b.pipCount>15 and 5.76 or 7.2
      local pips=b.pipCount>1 and b.pipCount<=25 and (b.pipCount-1)*spacing+4.8<=b.w-12
      b.cycleText:draw(self.time,self.reduced,b.x,b.y,b.w,pips and 29 or b.h,self.width,0.4)
      if pips then
        for pip=1,b.pipCount do
          local selected=b.pipSelected and (','..b.pipSelected..','):find(','..pip..',',1,true) or (not b.pipSelected and pip==b.pipIndex)
          Button.panel(b.x+(b.w-((b.pipCount-1)*spacing+4.8))/2+(pip-1)*spacing,b.y+28,4.8,4.8,selected and T.white or T.panel,0.6)
        end
      end
    elseif b.multiline then
      Input.background(b,active and self.editing=='transfer',b.disabled,active and self.hover==i)
      local font=T.font(22);local value=self.transfer;local lines={};local base=0
      local display=value~='' and value or 'Paste a decklist here...'
      for paragraph in (display..'\n'):gmatch('(.-)\n')do
        local _,wrapped=font:getWrap(paragraph,b.w-24);if #wrapped==0 then wrapped={''}end
        local cursor=1
        for _,line in ipairs(wrapped)do
          local at=paragraph:find(line,cursor,true) or cursor
          lines[#lines+1]={text=line,first=base+at-1,last=base+at-1+#line};cursor=at+#line
        end
        base=base+#paragraph+1
      end
      local first=#Codec.utf16Prefix(value,self.first or 0);local last=#Codec.utf16Prefix(value,self.last or 0)
      local caretLine=1
      for i,line in ipairs(lines)do if last>=line.first then caretLine=i end end
      local visible=math.floor((b.h-20)/25)
      local start=math.max(1,math.min(math.max(1,#lines-visible+1),math.floor((self.modal.scroll or 0)/25)+1))
      if self.editing=='transfer' and (self.caretByte~=last or self.caretValue~=value)then
        if caretLine<start then start=caretLine elseif caretLine>=start+visible then start=caretLine-visible+1 end
        self.modal.scroll=(start-1)*25;self.caretByte,self.caretValue=last,value
      end
      for n=start,math.min(#lines,start+visible-1)do
        local line=lines[n];local ly=b.y+10+(n-start)*25
        if self.editing=='transfer' and last>first and first<=line.last and last>=line.first then
          local left=font:getWidth(line.text:sub(1,math.max(0,first-line.first)))
          local right=font:getWidth(line.text:sub(1,math.min(#line.text,last-line.first)))
          g.setColor(T.blue);g.rectangle('fill',b.x+12+left,ly,math.max(2,right-left),25)
        end
        T.text(line.text,22,b.x+12,ly,b.w-24,T.paper,'left')
        if self.editing=='transfer' and n==caretLine and math.floor(self.time*2)%2==0 then
          local px=font:getWidth(line.text:sub(1,math.max(0,last-line.first)))
          g.setColor(T.white);g.rectangle('fill',b.x+12+px,ly,2,22)
        end
      end
    elseif b.action~='card' and b.action~='deck-card' then
      local original=b.label;local size=b.fontSize
      size=Fit.shrink(b.label,size,14,b.w-16)
      if T.font(size):getWidth(b.label)>b.w-16 then
        b.label=Fit.ellipsize(b.label,b.w-16,function(s) return T.font(size):getWidth(s) end)
      end
      b.fontSize=size;Button.draw(b,active and not b.disabled and (self.hover==i or self.focus==i),active and self.pressed==i,false,self.width);b.label=original
      if b.icon then
        local pressed=active and self.pressed==i
        local sx=((b.x+b.w/2-self.width/2)/(self.width/2))*1.5
        local layer=0.4-(pressed and 1.5 or 0)
        g.push();g.translate(b.x+layer*sx*3+b.w/2,b.y-layer*4.5+b.h/2);g.scale(pressed and 0.985 or 1)
        g.setColor(T.white)
        if b.icon=='info' then
          g.rectangle('fill',-2,-11,5,5);g.rectangle('fill',-2,-3,5,14)
          g.rectangle('fill',-5,-3,8,3);g.rectangle('fill',-5,8,11,3)
        elseif b.icon=='cards' then
          for col=0,1 do for row=0,1 do g.rectangle('fill',-10+col*12,-11+row*13,8,10)end end
        else
          for row=0,2 do g.rectangle('fill',-10,-9+row*7,3,3);g.rectangle('fill',-3,-9+row*7,13,3)end
        end
        g.pop()
      end
      if (b.action=='deck-type' and b.arg==self.deckType) or (b.action=='filter-tab' and b.arg==self.filterPage) then Button.chosen(b,self.reduced and 12 or self.time,active and self.pressed==i,self.width)end
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
      local hovered=not self.modal and Button.hit({x=cx-135,y=h-132,w=270,h=44},self.mx or -1,self.my or -1)
      Button.cycleFace(cx-135,h-132,270,44,hovered)
      self.pageText:draw(self.time,self.reduced,cx-135,h-132,270,44,w)
      if self.drag and self.drag.active and p then T.text(self.drag.source=='deck' and 'Drop here to remove one copy' or 'Drop here to add to deck',20,24,h-170,w-48,T.blue)end
    end
    if not p or self.tab=='deck'then
      local x=p and 24 or DECK_X;local bw=p and 432 or DECK_WIDTH;local y=p and 213 or PANEL_Y
      Button.panel(x,y,bw,p and 496 or PANEL_HEIGHT,T.panel)
      local pagerLeft,pagerY=self:deckPager();local pagerX=pagerLeft+36
      local hovered=not self.modal and Button.hit({x=pagerX,y=pagerY,w=170,h=36},self.mx or -1,self.my or -1)
      Button.cycleFace(pagerX,pagerY,170,36,hovered,5)
      self.deckPageText:draw(self.time,self.reduced,pagerX,pagerY,170,36,w)
      if self.deckView=='cards' then
        for _,c in ipairs(self.deckCards)do
          if not (self.dragCard and self.dragCard.item.id==c.item.id)then
            c:draw(shaders,self.time,self.mx,self.my,self.reduced,w)
            if c.item.illegal then Alert.drawOnCard(c,self.time,self.reduced,w,Alert.gallery) end
          end
          DeckLabels.drawQuantity(c)
        end
      end
      if #self:visibleDeck()==0 then
        local empty=self.deckType=='all'
        T.text(empty and 'Your next deck starts here' or 'No '..self.deckType..' cards',26,x+24,y+170,bw-48,T.paper)
        T.text(empty and 'Inspect a card to add it,\nor drag it into this tray.' or 'Add cards from the catalog\nor choose another tab.',22,x+24,y+220,bw-48,T.profile)
      end
    end
    if self.message~='' and not p then caption(self.message,18,816,h-84,294,T.paper,'left')end
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
    if self.filterPage==3 then
      local fw=math.min(360,bw);local fx=m.x+(m.w-fw)/2
      for i,label in ipairs({'Rules text','Minimum HP','Maximum HP'})do T.text(label,24,fx,m.y+130+(i-1)*106,fw)end
    end
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
return Builder
