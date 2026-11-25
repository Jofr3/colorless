local D=require('ui.card_dimensions')
-- Edit mode on the hot-seat table, mixed into ui/simulator.lua's Simulator: the HUD column turns
-- into a catalog gallery (search, pages, Back), and any of the seated player's cards drags
-- freely between the gallery, the board, the hand, the piles and an open pile tray. The host
-- turns each drop into a rules-free board edit (src/lua/simulatorEdit.ts).
local T=require('ui.theme')
local Button=require('ui.button')
local Input=require('ui.text_input')
local Layout=require('ui.sim_layout')
local PageText=require('ui.page_text')
local Pager=require('ui.pager')
local TextRecord=require('ui.text_record')
local Mailbox=require('ui.mailbox')
local Dyna=require('ui.dynatext')
local Collection=require('ui.collection_motion')
local DeckLabels=require('ui.deck_labels')
local WheelPager=require('ui.wheel_pager')
local Card=require('ui.card')
local FaceCache=require('ui.face_cache')
-- Faces the gallery keeps: its page and the four prefetched either side, as the builder keeps.
local FACE_LIMIT=72
local Simulator={}
local g=love.graphics
local GAP=10
-- The gallery's tray: the card modals' and the builder's dark inset, with room inside it for the
-- cards' fan, bob and hover lift.
local TRAY_PAD=14
local SEARCH_H=44
-- The pager and Back button match the card modals' (sim_overlay.lua): a 224 px page face with
-- 34 px arrows, 36 px tall, 12 px under the tray and 15 px above a 40 px Back button.
local PAGER_H,PAGER_FACE,PAGER_ARROW,RETURN_H=36,224,34,40
local PAGER_TOP_GAP,BACK_GAP=12,15
local SEARCH_DELAY=0.25
-- The gallery grid inside the widened column: as many columns of at least three as fit, cards
-- no larger than the table's, and as many rows as the column's height holds.
function Simulator:galleryGrid()
  local G=self.L.gallery
  if not G then return nil end
  local trayTop=G.y+SEARCH_H+GAP+6
  local trayBottom=G.bottom-RETURN_H-BACK_GAP-PAGER_H-PAGER_TOP_GAP
  local top,bottom=trayTop+TRAY_PAD,trayBottom-TRAY_PAD
  local w=G.w-2*TRAY_PAD
  local cols=3
  local scale=math.min(self.L.zones.you_hand.scale,(w-(cols-1)*GAP)/(cols*D.W))
  local rows=math.max(1,math.floor((bottom-top+GAP)/(D.H*scale+GAP)))
  -- One more row when the cards need shrink only a little to fit it, rather than leave the
  -- tray's height empty.
  local tighter=(bottom-top-rows*GAP)/((rows+1)*D.H)
  if tighter>=0.85*scale then rows,scale=rows+1,tighter end
  local gridH=rows*D.H*scale+(rows-1)*GAP
  return {cols=cols,rows=rows,scale=scale,top=top+(bottom-top-gridH)/2,x=G.x+TRAY_PAD,w=w,pagerY=trayBottom+PAGER_TOP_GAP,returnY=G.bottom-RETURN_H,
    tray={x=G.x,y=trayTop,w=G.w,h=trayBottom-trayTop}}
end
function Simulator:galleryPosition(grid,i)
  local col=(i-1)%grid.cols
  local row=math.floor((i-1)/grid.cols)
  local cw,ch=D.W*grid.scale,D.H*grid.scale
  local span=grid.cols*cw+(grid.cols-1)*GAP
  return grid.x+(grid.w-span)/2+col*(cw+GAP)+cw/2,grid.top+row*(ch+GAP)+ch/2
end
-- Gallery cards take their faces from a cache keyed by what they show, so a page turned to adopts
-- the faces preloadGallery drew ahead (the builder's face_cache scheme).
function Simulator:galleryFaces()
  self.faceCache=self.faceCache or FaceCache.new(FACE_LIMIT)
  return self.faceCache
end
function Simulator:galleryItem(it,i)
  local item={id='gallery:'..i,cardId=it.cardId,name=it.name,owner='gallery',zone='gallery',index=i-1,hidden=false,
    category=it.category,trainerType=it.trainerType,stage=it.stage,scan=true,edition='dissolve'}
  item.drawFace=function(w,h) self:face(item,w,h) end
  return item
end
-- What a gallery face shows: its card, the scan it draws, its raster, and whether its text (the
-- placeholder face's colours) had arrived.
function Simulator:galleryFaceKey(item)
  local w,h=Card.raster({item=item})
  return item.cardId..'\t'..tostring(Card.scanPath(self.art,item,item.cardId))..'\t'..w..'x'..h..'\t'..(self.info[item.cardId] and '+' or '')
end
function Simulator:acquireGalleryFace(item,index)
  return self:galleryFaces():acquire(self:galleryFaceKey(item),function()
    local c=Card.new(item,index);return {texture=c.texture,resolution=c.resolution}
  end)
end
function Simulator:repaintGallery(c)
  local old=c.face
  c.face=self:acquireGalleryFace(c.item,c.index);c.texture,c.resolution=c.face.texture,c.face.resolution
  if old then self.faceCache:release(old) end
end
function Simulator:releaseGallery()
  for _,c in ipairs(self.galleryCards or {}) do if c.face then self.faceCache:release(c.face) end end
  self.galleryCards={};self.galleryKey=nil
end
-- Drops every cached face: leaving edit mode, or a resize, which empties every canvas.
function Simulator:dropGalleryFaces()
  self:releaseGallery()
  if self.faceCache then self.faceCache:trim(0) end
end
-- One face a frame for the prefetched pages, in the order the host stages their scans; those
-- already drawn count as just used, so the cache keeps them over faces from farther pages.
function Simulator:preloadGallery()
  for _,item in ipairs(self.galleryNearby or {}) do
    local key=self:galleryFaceKey(item)
    if self:galleryFaces():has(key) then self.faceCache:touch(key)
    elseif Card.scanPath(self.art,item,item.cardId) then
      self.faceCache:release(self:acquireGalleryFace(item,1));return
    end
  end
end
-- Called once a snapshot is applied: turns edit mode on or off (relaying the table out) and
-- rebuilds the gallery page when it changed. True when the layout changed.
function Simulator:syncEdit(m)
  self.editState=m.edit
  self.galleryItems=m.gallery
  self.galleryNearby={}
  for i,it in ipairs(m.galleryNearby or {}) do self.galleryNearby[i]=self:galleryItem(it,i) end
  local editing=(m.edit and m.edit.on and not self.portrait) or false
  local changed=editing~=(self.editing or false)
  self.editing=editing
  if changed then
    if self.editDrag then self:dropEditDrag() end
    if not editing then
      if self.searchEditing then self:command('finish-input') end
      self.searchEditing=false;self.pendingSearch=nil
      self:dropGalleryFaces();self.galleryIds=nil
    else
      self.searchText=m.edit.query
      self.highlight=nil;self.luaTargeting=nil
    end
    if self.width then self.L=Layout.for_size(self.width,self.height,editing,self.sideMargin) end
    if self.overlay then self.overlay:layout() end
  end
  if editing then
    if not self.searchEditing and not self.pendingSearch then self.searchText=m.edit.query end
    self.galleryText=self.galleryText or PageText.new()
    self.galleryText:set('Page '..m.edit.page..'/'..m.edit.pages,self.time)
    self:buildGallery(m.gallery,changed)
  end
  return changed
end
-- `force` rebuilds the cards even when only their text changed; `settle` places them at rest
-- (a resize), where a new page otherwise deals.
function Simulator:buildGallery(items,force,settle)
  local grid=self:galleryGrid()
  if not grid then return end
  local perPage=grid.cols*grid.rows
  if perPage~=self.galleryPerPage then
    self.galleryPerPage=perPage
    self:command('edit-page',self.editState.page,perPage)
  end
  local ids,keys={},{}
  for _,it in ipairs(items) do ids[#ids+1]=it.cardId;keys[#keys+1]=it.cardId..(self.info[it.cardId] and '+' or '') end
  local idKey=table.concat(ids,',')..'@'..grid.scale
  local key=table.concat(keys,',')..'@'..grid.scale
  if key==self.galleryKey and not force then return end
  -- A new page deals its cards out like the builder's and the card modals' (collection_motion);
  -- the same page rebuilt for its card text keeps its cards where they rest.
  local entering=idKey~=self.galleryIds and not settle
  if not entering and not force and #self.galleryCards==math.min(#items,perPage) then
    -- Only the cards' text arrived: repaint the faces where they are, mid-deal or at rest.
    self.galleryKey=key
    for i,c in ipairs(self.galleryCards) do
      local it=items[i]
      c.item.category,c.item.trainerType,c.item.stage=it.category,it.trainerType,it.stage
      c.gallery=it;self:repaintGallery(c)
    end
    return
  end
  self:releaseGallery();self.galleryKey=key;self.galleryIds=idKey
  local count=math.min(#items,perPage)
  local centre=grid.x+grid.w/2
  for i=1,count do
    local it=items[i]
    local x,y=self:galleryPosition(grid,i)
    local column=(i-1)%grid.cols
    local rowCount=math.min(grid.cols,count-math.floor((i-1)/grid.cols)*grid.cols)
    local item=self:galleryItem(it,i)
    local face=self:acquireGalleryFace(item,i)
    local c=self:newCard(item,i,x,y,grid.scale,face)
    c.face=face
    local rowX=centre+(column-(rowCount-1)/2)*(D.W*grid.scale+GAP)
    Collection.place(c,rowX,y-0.475*D.H*grid.scale,rowCount,column,centre,self.time,self.reduced or not entering,self.boardW)
    c.gallery=it
    self.galleryCards[#self.galleryCards+1]=c
  end
  if entering and count>0 and not self.reduced then self.callbacks.feedback('cardSlide1',0.95+love.math.random()*0.1) end
end
-- The Edit mode button under the HUD's counters, and while editing, the gallery's controls (the
-- search field draws itself; the page arrows and Back are ordinary buttons).
function Simulator:buildEditButton(L)
  if L.portrait or not self.editState then return end
  local b=self.hud:bottomLayout(L)
  local x,w=L.hud.x+L.hud.inset+8,L.hud.w-2*L.hud.inset-16
  self:add('Edit mode',x,b.bottom+14,w,48,'edit-open',T.green,{fontSize=26,disabled=not self.editState.available})
end
function Simulator:buildEdit()
  local L=self.L
  local grid=self:galleryGrid()
  if not grid then return end
  local G=L.gallery
  self.searchControl=self:add('',G.x,G.y,G.w,SEARCH_H,'edit-search',T.ink,{input=true,invisible=true,placeholder='Search cards'})
  local e=self.editState
  local cx=G.x+G.w/2
  local face=math.min(PAGER_FACE,G.w-2*(PAGER_ARROW+4))
  Pager.arrow(self:add('<',cx-face/2-4-PAGER_ARROW,grid.pagerY,PAGER_ARROW,PAGER_H,'edit-prev',T.red,{disabled=e.page<=1}),-1,e.page,e.pages)
  Pager.arrow(self:add('>',cx+face/2+4,grid.pagerY,PAGER_ARROW,PAGER_H,'edit-next',T.red,{disabled=e.page>=e.pages}),1,e.page,e.pages)
  self.galleryPager={x=cx-face/2,y=grid.pagerY,w=face,h=PAGER_H,cx=cx}
  self:add('Back',G.x,grid.returnY,G.w,RETURN_H,'edit-return',T.orange,{fontSize=26})
  for _,owner in ipairs({'you'}) do
    local dz=L.zones.you_discard
    self:add('',dz.well.x,dz.well.y,dz.well.w,dz.well.h,'pile',nil,{owner=owner,invisible=true,disabled=((self.sides.you or {}).discard or 0)==0})
    local kz=L.zones.you_deck
    self:add('',kz.well.x,kz.well.y,kz.well.w,kz.well.h,'edit-deck',nil,{invisible=true,disabled=((self.sides.you or {}).deck or 0)==0})
  end
end
function Simulator:activateEdit(a)
  local e=self.editState or {page=1,pages=1}
  if a=='edit-open' then self:command('edit-mode','on')
  elseif a=='edit-return' then
    if self.searchEditing then self:command('finish-input') end
    self.searchEditing=false
    self:command('edit-mode','off')
  elseif a=='edit-search' then
    self.searchEditing=true
    self:command('input','search',self.searchText or '')
  elseif a=='edit-prev' then self:command('edit-page',e.page-1,self.galleryPerPage or 12)
  elseif a=='edit-next' then self:command('edit-page',e.page+1,self.galleryPerPage or 12)
  elseif a=='edit-deck' then self.callbacks.feedback('cardSlide2',1);self.pileOwner='deck';self:command('pile','deck')
  else return false end
  return true
end
-- The search field's box, for the page to put its text proxy over it.
function Simulator:editBox()
  local b=self.searchEditing and self.searchControl
  if not b then return end
  return self.ox+b.x*self.zoom,self.oy+b.y*self.zoom,b.w*self.zoom,b.h*self.zoom
end
function Simulator:readSearch()
  local r=TextRecord.read(self,Mailbox.read('simulatorInput'))
  if not r or r.field~='search' then return end
  if r.action~='input' and not self.searchEditing then return end
  self.searchEditing=r.action=='input'
  self.searchFirst,self.searchLast=r.selectionStart,r.selectionEnd
  if r.value~=self.searchText or r.action~='input' then
    self.searchText=r.value
    self.pendingSearch=r.value;self.searchDelay=r.action=='input' and SEARCH_DELAY or 0
  end
end
-- An open pile tray trades cards with the gallery while editing: the table behind it is dimmed
-- and takes no input, and only the column and the tray answer. Any other overlay stays modal.
function Simulator:editTray()
  return self.editing and self.overlay and self.overlay.kind=='pile' and not self.peek and self.overlay or nil
end
-- Whether a table control takes the pointer: while a tray is open only the column's do.
function Simulator:editControlLive(b)
  return not self:editTray() or Layout.inside(self.L.hud,b.x+b.w/2,b.y+b.h/2)
end
-- The modal backdrop over everything but the column, which stays live beside the tray.
function Simulator:drawEditBackdrop()
  local h=self.L.hud
  local far=4000
  g.setColor(95/255,115/255,119/255,0.7)
  g.rectangle('fill',-far,-far,far+h.x,2*far)
  g.rectangle('fill',h.x+h.w,-far,far,2*far)
end
function Simulator:updateEdit(dt,time,mx,my,reduced)
  if not self.editing then return end
  self:readSearch()
  if self.pendingSearch then
    self.searchDelay=(self.searchDelay or 0)-dt
    if self.searchDelay<=0 then self:command('edit-search',self.pendingSearch);self.pendingSearch=nil end
  end
  for _,c in ipairs(self.galleryCards or {}) do
    local active=c==self.hoverCard and not self.editDrag
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.callbacks.feedback('paper1',0.9+love.math.random()*0.2) end
    if c.collection then Collection.target(c,time,reduced,self.boardW) end
    c:update(dt,time,active,reduced)
  end
  local d=self.editDrag
  if d then
    if not d.moved and (mx-d.x)^2+(my-d.y)^2>36 then
      d.moved=true
      if not d.card then d.card=d.make() end
      -- A card lifted out of a tray leaves its place there empty while it is held; a grouped
      -- stack keeps showing the copies left in it.
      if d.trayCard and (d.trayCard.item.count or 1)<=1 then d.trayCard.editHidden=true end
      d.card.dragging=true;self.highlight=nil
      self.callbacks.feedback('cardSlide1',0.95)
    end
    if d.moved then
      d.card.targetX,d.card.targetY=mx-d.dx,my-d.dy
      if d.own then d.card:update(dt,time,true,reduced) end
      self.editDrop=self:editDropAt(mx,my)
    end
  end
end
function Simulator:redealGallery()
  self.galleryIds=nil
  self:buildGallery(self.galleryItems or {},true)
end
-- The wheel over the column turns the gallery's page, as it turns the builder's.
function Simulator:galleryWheel(y)
  if not self.editing or y==0 or not Layout.inside(self.L.hud,self.mx or -1,self.my or -1) then return false end
  if not WheelPager.ready(self) then return true end
  local e=self.editState
  local page=e.page+(y>0 and -1 or 1)
  if page>=1 and page<=e.pages then self:command('edit-page',page,self.galleryPerPage or 12) end
  return true
end
function Simulator:galleryHit(x,y)
  if not self.editing then return nil end
  for i=#(self.galleryCards or {}),1,-1 do
    local c=self.galleryCards[i]
    if c:hit(x,y) then return c end
  end
end
-- The card a press would pick up: a gallery card (a copy follows the pointer), a card in the open
-- pile tray, or one of the seated player's cards on the table, the shared Stadium included.
function Simulator:startEditDrag(x,y)
  local g=self:galleryHit(x,y)
  if g then
    self.editDrag={kind='add',cardId=g.item.cardId,x=x,y=y,dx=0,dy=0,own=true,source=g,
      make=function() local c=self:newCard({id='drag',cardId=g.item.cardId,name=g.item.name,owner='gallery',zone='gallery',hidden=false,scan=true},1,g.x,g.y,self.L.zones.you_hand.scale);return c end}
    return true
  end
  local tray=self:editTray()
  if tray then
    for i=#tray.cards,1,-1 do
      local c=tray.cards[i]
      local uid=c.item.id
      if c:hit(x,y) and self.pileOwner~='opponent' and uid and not uid:match('^opt') then
        self.editDrag={kind='move',uid=uid,from=self.pileOwner=='deck' and 'deck' or 'discard',x=x,y=y,dx=0,dy=0,own=true,trayCard=c,
          make=function() return self:newCard({id='drag',cardId=c.item.cardId,name=c.item.name,owner='you',zone='tray',hidden=false,scan=true},1,c.x,c.y,self.L.zones.you_hand.scale) end}
        return true
      end
    end
    return false
  end
  local c=self:cardHit(x,y)
  if c and not c.item.hidden and (c.item.owner=='you' or c.item.zone=='stadium') and c.item.zone~='gallery' then
    self.editDrag={kind='move',uid=c.item.id,from=c.item.zone,x=x,y=y,dx=x-c.x,dy=y-c.y,card=c,make=function() return c end,table=true}
    return true
  end
  return false
end
function Simulator:dropEditDrag()
  local d=self.editDrag
  if not d then return end
  if d.card then d.card.dragging=false end
  if d.own and d.card then d.card.texture:release() end
  if d.trayCard then d.trayCard.editHidden=nil end
  self.editDrag=nil;self.editDrop=nil
end
-- The seated player's Pokémon under the pointer, other than the one held.
local function bodyAt(self,x,y,held)
  for _,c in ipairs(self.cards) do
    if c~=held and c.item.owner=='you' and (c.item.zone=='active' or c.item.zone=='bench') and c:hit(x,y) then return c end
  end
end
-- Where a drop at (x,y) lands: a zone the host knows (deck, hand, discard, prizes, active, bench,
-- stadium, or onto a Pokémon) with the well to outline, or the gallery, which takes a card out
-- of the game.
function Simulator:editDropAt(x,y)
  local d=self.editDrag
  if not d then return nil end
  local L,Z=self.L,self.L.zones
  local held=d.table and d.card or nil
  if Layout.inside(L.hud,x,y) then return d.kind=='move' and {zone='gallery'} or nil end
  local tray=self:editTray()
  if tray and Button.hit(tray,x,y) then
    if self.pileOwner=='opponent' then return nil end
    local zone=self.pileOwner=='deck' and 'deck' or 'discard'
    return {zone=zone}
  end
  if tray then return nil end
  local body=bodyAt(self,x,y,held)
  if body then
    return {zone='onto',index=body.item.zone=='active' and -1 or body.item.index,card=body}
  end
  if Layout.inside(Z.you_active.well,x,y) then return {zone='active',well=Z.you_active.well} end
  if Layout.inside(Z.you_bench.well,x,y) then return {zone='bench',well=Z.you_bench.well} end
  if Layout.inside(Z.stadium.well,x,y) then return {zone='stadium',well=Z.stadium.well} end
  if Layout.inside(Z.you_deck.well,x,y) then return {zone='deck',well=Z.you_deck.well} end
  if Layout.inside(Z.you_discard.well,x,y) then return {zone='discard',well=Z.you_discard.well} end
  if Layout.inside(Z.you_prizes.well,x,y) then return {zone='prizes',well=Z.you_prizes.well} end
  local hand=Z.you_hand
  if x>=L.table.x and y>=hand.y-D.HALF_H*hand.scale-18 then
    return {zone='hand',well={x=L.table.x+8,y=hand.y-D.HALF_H*hand.scale-12,w=L.table.w-16,h=L.h-(hand.y-D.HALF_H*hand.scale-12)}}
  end
  return nil
end
-- A drop the host would only bounce: a card onto the zone it is already in.
local function samePlace(d,zone)
  if zone.zone=='onto' then return d.table and zone.card and zone.card==d.card end
  local from=d.from
  if from=='prize' then from='prizes' end
  return d.kind=='move' and from==zone.zone and zone.zone~='bench'
end
function Simulator:finishEditDrag(x,y)
  local d=self.editDrag
  if not d or not d.moved then return false end
  local zone=self:editDropAt(x,y)
  if zone and not samePlace(d,zone) then
    self.callbacks.feedback('card1',1)
    -- A card new to the table (from the gallery or a tray) enters from where it was dropped.
    if d.own then self.editLanding={x=d.card and d.card.x or x,y=d.card and d.card.y or y,at=self.time} end
    if zone.zone=='gallery' then
      self:command('edit','remove',d.uid)
      if not d.own then self.editRemoved={uid=d.uid,at=self.time} end
    elseif d.kind=='add' then self:command('edit','add',d.cardId,zone.zone,zone.index or '')
    else self:command('edit','move',d.uid,zone.zone,zone.index or '') end
    -- A card taken from or given to the gallery deals its page again, as a pile tray deals its
    -- cards again when one comes or goes.
    if zone.zone=='gallery' or d.kind=='add' then self:redealGallery() end
  elseif d.card and not d.own then d.card:juiceUp(self.time,nil,nil,self.reduced) end
  self:dropEditDrag()
  return true
end
-- Any of the seated player's Prizes under the pointer, face down or up.
function Simulator:editPrizeHit(x,y)
  local z=self.L.zones.you_prizes
  local side=self.sides.you or {prizes=0}
  local w,h=D.W*z.scale,D.H*z.scale
  for i=0,side.prizes-1 do
    local px,py=Layout.prize(z,i)
    if x>=px-w/2-4 and x<=px+w/2+4 and y>=py-h/2-4 and y<=py+h/2+4 then return i end
  end
end
function Simulator:editPressed(x,y)
  local tray=self:editTray()
  if tray and Button.hit(tray,x,y) then
    self.pressedOverlay=tray:press(x,y)
    self:startEditDrag(x,y)
    return
  end
  self.pressed=self:hit(x,y)
  if self.pressed>0 then return end
  if tray then self:startEditDrag(x,y);return end
  local prize=self:editPrizeHit(x,y)
  local faceUp=false
  for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='prize' and c:hit(x,y) then faceUp=true end end
  if prize and not faceUp then self.clickedPrize=prize;return end
  if not self:startEditDrag(x,y) and prize then self.clickedPrize=prize end
end
function Simulator:editReleased(x,y)
  local tray=self:editTray()
  if self:finishEditDrag(x,y) then
    self.pressedOverlay=nil
  elseif tray and self.pressedOverlay then
    if self.pressedOverlay>0 and self.pressedOverlay==tray:hit(x,y) then tray:activate(self.pressedOverlay) end
    self.pressedOverlay=nil
  elseif self.pressed and self.pressed>0 then
    if self.pressed==self:hit(x,y) then self:activate(self.pressed) end
  elseif self.clickedPrize~=nil then
    if self.clickedPrize==self:editPrizeHit(x,y) then self.callbacks.feedback('card1',1.1);self:command('edit','flip',self.clickedPrize) end
  elseif self.editDrag and self.editDrag.table and not self.editDrag.moved then
    local c=self.editDrag.card
    if c.item.zone=='discard' then self.callbacks.feedback('cardSlide2',1);self:openPile('you')
    elseif c.item.zone=='prize' then self.callbacks.feedback('card1',1.1);self:command('edit','flip',c.item.index) end
  end
  if self.editDrag then self:dropEditDrag() end
  self.pressed=nil;self.clickedPrize=nil
end
function Simulator:drawEditColumn(shaders,rw)
  local G=self.L.gallery
  local grid=self:galleryGrid()
  if not G or not grid then return end
  local b=self.searchControl
  if b then
    local lit=self.hover>0 and self.controls[self.hover]==b
    b.label=''
    Input.draw(b,self.searchText or '',self.searchEditing,self.searchFirst,self.searchLast,self.time,false,lit)
  end
  local t=grid.tray
  Button.panel(t.x,t.y+3,t.w,t.h,{T.panel[1]*0.7,T.panel[2]*0.7,T.panel[3]*0.7,1})
  Button.panel(t.x,t.y,t.w,t.h,T.panel)
  local e=self.editState or {}
  if #(self.galleryCards or {})==0 then
    local text=e.failed and 'Card search failed' or (e.busy and 'Loading cards...' or 'No matching cards')
    Dyna.static(text,0.4,G.x,grid.top+40,G.w,40,T.jokerGrey,{roomWidth=rw,fit=true})
  end
  for _,c in ipairs(self.galleryCards or {}) do
    if c~=self.hoverCard then c:draw(shaders,self.time,self.mx or 0,self.my or 0,self.reduced,rw) end
  end
  if self.hoverCard and self.hoverCard.item.zone=='gallery' then self.hoverCard:draw(shaders,self.time,self.mx or 0,self.my or 0,self.reduced,rw) end
  local p=self.galleryPager
  if p and self.galleryText then
    Button.cycleFace(p.x,p.y,p.w,p.h,false)
    self.galleryText:draw(self.time,self.reduced,p.x,p.y,p.w,p.h,rw,0.4)
  end
end
-- The decks page's "View Deck" badge over the seated player's deck pile, and "View Prize" (or
-- "Hide Prize") over the Prize under the pointer, while no drag or tray is in the way.
function Simulator:drawEditHints()
  if self.editDrag and self.editDrag.moved or self:editTray() or self.overlay then return end
  local mx,my=self.mx or -1,self.my or -1
  local deckZone=self.L.zones.you_deck
  for _,p in ipairs(self.piles) do
    if p.owner=='you' and p.item.kind=='deck' and (p.item.count or 0)>0 and Layout.inside(deckZone.well,mx,my) then
      DeckLabels.drawHover({hovered=true,x=p.x,y=p.y,angle=p.angle or 0,unit=p.unit})
    end
  end
  local slot=self:editPrizeHit(mx,my)
  if slot then
    local up=false
    for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='prize' and c.item.index==slot then up=true end end
    local px,py=Layout.prize(self.L.zones.you_prizes,slot)
    local unit=D.W*deckZone.scale/D.TILE_W
    DeckLabels.drawHover({hovered=true,x=px,y=py,angle=0,unit=unit},{up and 'Hide' or 'View','Prize'})
  end
end
function Simulator:drawEditDrag(shaders,rw)
  local d=self.editDrag
  if self.editDrop and self.editDrop.well and d and d.moved then
    local w=self.editDrop.well
    g.setLineWidth(2.5);Button.outline(w.x-2,w.y-2,w.w+4,w.h+4,T.white,1.2)
    Button.panel(w.x,w.y,w.w,w.h,{1,1,1,0.08},1.2)
  elseif self.editDrop and self.editDrop.card and d and d.moved then
    self.editDrop.card:drawOutline(T.white,4,2.5)
  end
  if d and d.moved and d.card then
    if d.table then self:drawAttached(d.card) end
    d.card:draw(shaders,self.time,self.mx,self.my,self.reduced,rw)
  end
end
return Simulator
