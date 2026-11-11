-- The builder's deck panel: its type tabs, the list or card view of the deck, its pager and the
-- view and information buttons. Its functions are Builder methods (builder.lua installs them).
local D=require('ui.card_dimensions')
local T=require('ui.theme')
local Button=require('ui.button')
local Alert=require('ui.card_alert')
local DeckLabels=require('ui.deck_labels')
local Pager=require('ui.pager')
local Deck={methods={}}
local Builder=Deck.methods
-- The landscape panel's place, shared with the catalog's panel and the save caption.
Deck.PANEL_Y,Deck.PANEL_HEIGHT=95,554
Deck.X,Deck.WIDTH=808,424
local PANEL_Y,PANEL_HEIGHT=Deck.PANEL_Y,Deck.PANEL_HEIGHT
local DECK_X,DECK_WIDTH=Deck.X,Deck.WIDTH
-- Portrait's deck panel starts below the message line under Import / Clear; its contents keep
-- their places within it.
local PORTRAIT_DECK_Y=232
local deckTypes={{key='all',label='All'},{key='Pokémon',label='Pokemon'},{key='Trainer',label='Trainer'},{key='Energy',label='Energy'}}
-- The deck's pager (ui/pager.lua), anchored at deckPager()'s left arrow.
local DECK_PAGER={face=36,w=170,arrow=30,h=36,fontSize=26,emboss=5}
function Builder:visibleDeck()
  if self.deckType=='all' then return self.deck end
  local visible={}
  for _,item in ipairs(self.deck)do
    if item.kind==self.deckType then visible[#visible+1]=item end
  end
  return visible
end
function Builder:deckPageSize() return self.deckView=='cards' and 6 or (self.portrait and 8 or 9) end
function Builder:deckPages() return math.max(1,math.ceil(#self:visibleDeck()/self:deckPageSize())) end
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
      local cy=(p and PORTRAIT_DECK_Y+154 or 269)+math.floor((i-1)/3)*(p and 170 or 201)
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
function Builder:turnDeckPage(delta)
  local page=self.deckPage
  self.deckPage=math.max(1,math.min(self:deckPages(),self.deckPage+delta));self:build()
  if self.deckPage~=page then self.callbacks.announce(Pager.page(self.deckPage,self:deckPages(),'Deck')) end
end
-- The panel's controls, after the catalog's: type tabs, rows or cards, pager, view and info.
function Builder:buildDeck()
  local p=self.portrait
  local x=p and 24 or DECK_X+8;local bw=p and 432 or DECK_WIDTH-16;local y=p and PORTRAIT_DECK_Y+78 or 179
  local allWidth=56
  local tabWidth=(bw-40-allWidth)/3
  local tabX=x+8
  for i,kind in ipairs(deckTypes)do
    local width=i==1 and allWidth or tabWidth
    self:add(kind.label,tabX,p and PORTRAIT_DECK_Y+24 or PANEL_Y+24,width,44,'deck-type',T.red,kind.key).fontSize=24
    tabX=tabX+width+8
  end
  local pageSize=self:deckPageSize();local visible=self:visibleDeck()
  if self.deckView=='list' then
    for i=(self.deckPage-1)*pageSize+1,math.min(#visible,self.deckPage*pageSize)do local item=visible[i];local yy=y+((i-1)%pageSize)*(p and 42 or 45)
      local rowWidth=bw-16
      self:add(item.name,x+8,yy,rowWidth-81,36,'detail',T.panel,item,{deckRow=true,rowWidth=rowWidth})
      -- A loading entry is not known to be unavailable, so it offers no discard.
      if not item.pending then self:add(item.kind=='' and 'x' or '-',x+8+rowWidth-78,yy+6,34,24,item.kind=='' and 'discard' or 'remove',T.red,item.id,{rowAction=true}) end
      self:add('+',x+8+rowWidth-40,yy+6,34,24,'add',T.blue,item.id,{rowAction=true,disabled=item.remaining==0})
    end
  else
    for i,c in ipairs(self.deckCards)do
      self.controls[#self.controls+1]={action='deck-card',deckCard=i,arg=c.item,label=c.item.quantity..' x '..c.item.name,x=c.homeX-D.HALF_W*c.baseScale,y=c.homeY-D.HALF_H*c.baseScale,w=D.W*c.baseScale,h=D.H*c.baseScale}
    end
  end
  local pagerX,pagerY=self:deckPager()
  local deckPages=self:deckPages()
  Pager.arrows(DECK_PAGER,pagerX,pagerY,self.deckPage,deckPages,function(label,ax,ay,aw,ah,dir)
    return self:add(label,ax,ay,aw,ah,'deck-page',T.red,dir)
  end)
  self:add(self.deckView=='list' and 'Show cards' or 'Show list',pagerX+256,pagerY,40,36,'deck-view',T.profile,nil,{icon=self.deckView=='list' and 'cards' or 'list',displayLabel=''})
  self:add('Deck information',pagerX+308,pagerY,40,36,'deck-info',T.profile,nil,{icon='info',displayLabel=''})
end
-- The panel, its pager, its cards in the card view and its empty-tab text.
function Builder:drawDeck(shaders)
  local w,p=self.width,self.portrait
  local x=p and 24 or DECK_X;local bw=p and 432 or DECK_WIDTH;local y=p and PORTRAIT_DECK_Y or PANEL_Y
  Button.panel(x,y,bw,p and 709-PORTRAIT_DECK_Y or PANEL_HEIGHT,T.panel)
  local pagerX,pagerY=self:deckPager()
  Pager.draw(DECK_PAGER,pagerX,pagerY,self.deckPageText,not self.modal,self.mx,self.my,self.time,self.reduced,w)
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
return Deck
