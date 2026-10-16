-- The sandbox table, built like Balatro's run screen: the HUD column on the
-- left, transparent CardArea wells on the felt, the hand fanned along the
-- bottom edge, the deck at the bottom right, hover popups, click-to-highlight
-- cards with attached action buttons, drag-and-drop plays, attention-text
-- juice for damage and prizes, and generic-options overlays for prompts.
-- The browser host (LuaSimulator) owns the rules; Lua owns everything seen.
local T=require('ui.theme')
local Button=require('ui.button')
local Card=require('ui.card')
local Pile=require('ui.deck_pile')
local Library=require('ui.library')
local Codec=require('ui.account')
local Modal=require('ui.modal')
local Dyna=require('ui.dynatext')
local Energy=require('ui.energy')
local Layout=require('ui.sim_layout')
local Hud=require('ui.sim_hud')
local Overlay=require('ui.sim_overlay')
local Fx=require('ui.sim_fx')
local Popup=require('ui.popup')
local Simulator={};Simulator.__index=Simulator
local g=love.graphics
local JOKER_GREY={191/255,199/255,213/255,1}
local MONEY={243/255,185/255,88/255,1}
local PURPLE={136/255,103/255,165/255,1}
local CHANCE={75/255,194/255,146/255,1}
local STATUS_ROTATION={asleep=-math.pi/2,paralyzed=math.pi/2,confused=math.pi}
local function prefix(owner) return owner=='opponent' and 'opp_' or owner=='global' and '' or 'you_' end
local function fieldsOf(raw)
  local rows={}
  for line in raw:gmatch('[^\n]+') do rows[#rows+1]=Codec.fields(line) end
  return rows
end
function Simulator.new(callbacks)
  local self=setmetatable({callbacks=callbacks,phase='empty',items={},sides={},info={},actions={},cardActions={},cards={},byUid={},ghosts={},piles={},art={},controls={},time=0,focus=0,hover=0,
    message='',title='',hint='',outcome='',outcomeDetail='',gamePhase='',turn=0,turnIndex=0,turnCount=0,waiting='',activePlayer='',viewerSeat='',allow={}},Simulator)
  self.hud=Hud.new()
  self.fx=Fx.new({feedback=function(name,pitch) callbacks.feedback(name,pitch) end,jiggle=function(amount) if callbacks.jiggle then callbacks.jiggle(amount) end end})
  return self
end
function Simulator:command(...)
  local fields={...};for i,v in ipairs(fields) do fields[i]=Codec.encode(tostring(v)) end
  self.callbacks.command(table.concat(fields,'\t'))
end
function Simulator:open(reduced)
  self.reduced=reduced;self.drag=nil;self.focus=0;self.raw=nil;self.previous=nil;self.highlight=nil;self.targeting=nil;self.luaTargeting=nil
  if self.overlay then self.overlay:release();self.overlay=nil end
  -- Forget the last game so a reopened page never diffs against it.
  for _,c in ipairs(self.cards) do c.texture:release() end
  for _,c in ipairs(self.ghosts) do c.texture:release() end
  for _,p in pairs(self.pendingPiles or {}) do p.texture:release() end;self.pendingPiles={}
  self.cards={};self.byUid={};self.ghosts={};self.items={};self.sides={};self.actions={};self.cardActions={}
  self.phase='empty';self.viewerSeat='';self.outcome='';self.menu=nil;self.menuId=nil;self.message='';self.turn=0
  self.fx:clear();self.fx:background('setup',true)
  self:command('open')
end
function Simulator:layout(w,h)
  self.width,self.height=w,h
  self.portrait=w<600
  self.L=Layout.for_size(w,h)
  self.boardW,self.boardH=self.L.w,self.L.h
  self.zoom=math.min(w/self.boardW,h/self.boardH)
  self.ox,self.oy=(w-self.boardW*self.zoom)/2,(h-self.boardH*self.zoom)/2
  self.drag=nil;self.highlight=nil
  -- A browser resize goes through love.window.setMode, which empties every
  -- Canvas in love.js; card faces are canvases, so repaint them.
  for _,c in ipairs(self.cards) do c:rebuild() end
  for _,c in ipairs(self.ghosts) do c:rebuild() end
  self:placeCards(true)
  if self.overlay then self.overlay:layout() end
  self:build()
end
function Simulator:point(x,y) return (x-self.ox)/self.zoom,(y-self.oy)/self.zoom end
-- Card faces: the scan when the browser cache has it, otherwise a pixel
-- placeholder in the card's type colour; hidden cards use the Balatro back.
function Simulator:face(item,w,h)
  if item.hidden or item.cardId=='' or item.cardId=='hidden' then Library.face(self,item,w,h);return end
  local path=self.art[item.cardId]
  if path and love.filesystem.getInfo(path) then
    local ok,img=pcall(g.newImage,path)
    if ok then img:setFilter('linear','linear');g.setColor(1,1,1);g.draw(img,0,0,0,w/img:getWidth(),h/img:getHeight());img:release();return end
  end
  local info=self.info[item.cardId] or {}
  local types=Energy.split(info.types)
  local colour=info.category=='Trainer' and (Popup.badgeColours[info.trainerType or ''] or T.blue) or Energy.colour(types[1] or 'Colorless')
  T.box(0,0,w,h,T.ink,5);T.box(2,2,w-4,h-4,T.paper,4)
  T.box(7,7,w-14,h-14,colour,3);T.box(10,10,w-20,h-20,T.paper,3)
  T.box(10,10,w-20,30,colour,3)
  local name=item.name or ''
  local size=16
  while size>9 and T.font(size):getWidth(name)>w-26 do size=size-1 end
  T.text(name,size,12,14,w-24,T.white)
  if info.category=='Pokemon' then
    if (info.hp or '')~='' then T.text(info.hp..' HP',14,12,44,w-24,T.ink,'right') end
    Energy.pip(w/2,h/2+6,24,types[1] or 'Colorless')
    local st=tostring(info.stage or '')
    if st~='' then T.text(st=='Stage1' and 'Stage 1' or st=='Stage2' and 'Stage 2' or st,13,12,h-34,w-24,T.ink) end
  elseif info.category=='Energy' then
    Energy.pip(w/2,h/2+6,30,types[1] or 'Special')
  else
    T.text((info.trainerType or 'Trainer'):upper(),13,12,h/2-2,w-24,colour)
  end
  g.setColor(colour[1],colour[2],colour[3],0.12)
  for x=16,w-20,8 do for y=48,h-44,8 do g.rectangle('fill',x,y,2,2) end end
end
function Simulator:newCard(item,index,x,y,scale)
  item.edition='dissolve';item.resolution=2
  item.drawFace=function(w,h) self:face(item,w,h) end
  local c=Card.new(item,index);c:place(x,y,scale,false)
  c.motion.T.r=0;c.motion.VT.r=0
  return c
end
-- ---------------------------------------------------------------- snapshot
function Simulator:sync(raw)
  if not raw or raw==self.raw then return end
  self.raw=raw
  local rows=fieldsOf(raw)
  local f=rows[1];if not f then return end
  local previous={items=self.items,sides=self.sides,turn=self.turn,viewerSeat=self.viewerSeat,outcome=self.outcome,phase=self.phase,activePlayer=self.activePlayer,menuId=self.menuId,revision=self.revision,message=self.message,gamePhase=self.gamePhase}
  self.revision=tonumber(f[1]) or 0
  self.phase,self.you,self.opponent=f[2],f[3],f[4]
  self.turn=tonumber(f[5]) or 0;self.gamePhase=f[6] or '';self.message=f[7] or '';self.title=f[8] or '';self.hint=f[9] or ''
  self.turnIndex=tonumber(f[10]) or 0;self.turnCount=tonumber(f[11]) or 0
  self.waiting,self.activePlayer,self.viewerSeat=f[12] or '',f[13] or '',f[14] or ''
  self.allow={energy=f[15]=='1',supporter=f[16]=='1',retreated=f[17]=='1'}
  self.outcome,self.outcomeDetail=f[18] or '',f[19] or ''
  self.shuffled=f[20] or ''
  self.items={};self.sides={};self.actions={};self.cardActions={};self.info=self.info or {}
  local menu
  for i=2,#rows do
    local r=rows[i]
    if r[1]=='S' then self.sides[r[2]]={deck=tonumber(r[3]) or 0,prizes=tonumber(r[4]) or 0,hand=tonumber(r[5]) or 0,discard=tonumber(r[6]) or 0,mulligan=tonumber(r[7]) or 0}
    elseif r[1]=='C' then
      -- Attached cards: "type|uid|cardId" per Energy, "uid|cardId" per Tool.
      local energies,energyCards={},{}
      for _,part in ipairs(Energy.split(r[14])) do
        local kind,uid,cardId=part:match('^([^|]*)|?([^|]*)|?(.*)$')
        energies[#energies+1]=kind
        if uid and uid~='' then energyCards[#energyCards+1]={id=uid,cardId=cardId,kind=kind} end
      end
      local toolCards={}
      for _,part in ipairs(Energy.split(r[15])) do
        local uid,cardId=part:match('^([^|]*)|?(.*)$')
        if uid and uid~='' and not tonumber(uid) then toolCards[#toolCards+1]={id=uid,cardId=cardId} end
      end
      self.items[#self.items+1]={id=r[2],cardId=r[3],name=r[4],owner=r[5],zone=r[6],index=tonumber(r[7]) or 0,hidden=r[8]=='true',category=r[9] or '',trainerType=r[10] or '',stage=r[11] or '',
        hp=tonumber(r[12]),damage=tonumber(r[13]) or 0,energies=energies,energyCards=energyCards,tools=#toolCards,toolCards=toolCards,status=r[16] or '',types=r[17] or '',draggable=r[18]=='true'}
    elseif r[1]=='I' then
      self.info[r[2]]={category=r[3] or '',trainerType=r[4] or '',stage=r[5] or '',hp=r[6] or '',types=r[7] or '',retreat=r[8] or '',weakness=r[9] or '',resistance=r[10] or '',effect=r[11] or '',abilities=r[12] or '',attacks=r[13] or '',energyType=r[14] or '',name=r[15] or ''}
    elseif r[1]=='A' then self.actions[#self.actions+1]={token=r[2],label=r[3],colour=T[r[4]] or T.blue,disabled=r[5]=='true',slot=r[6] or 'minor'}
    elseif r[1]=='K' then
      local list=self.cardActions[r[3]] or {};self.cardActions[r[3]]=list
      list[#list+1]={token=r[2],uid=r[3],label=r[4],colour=T[r[5]] or T.blue,disabled=r[6]=='true',targetUid=r[7] or '',group=r[8] or '',cost=Energy.split(r[9]),damage=r[10] or ''}
    elseif r[1]=='M' then menu={kind=r[2],title=r[3],note=r[4],mandatory=r[5]=='true',id=r[6] or r[3],options={},footer={}}
    elseif (r[1]=='O' or r[1]=='F') and menu then
      local list=r[1]=='O' and menu.options or menu.footer
      list[#list+1]={token=r[2],label=r[3],colour=T[r[4]] or T.blue,disabled=r[5]=='true',selected=r[6]=='true',cardId=r[7] or '',uid=r[8] or ''}
    end
  end
  self.menu=menu
  self.menuId=menu and menu.id or nil
  if self.drag then self.drag.card.dragging=false;self.drag=nil end
  self.highlight=nil
  self:placeCards(false,previous)
  self:react(previous)
  self:applyMenu(previous)
  -- A shuffle riffles the owner's deck pile (CardArea shuffle_amt), with the
  -- fan sound; the riffle survives a snapshot arriving mid-animation.
  if self.shuffled~='' and self.revision~=previous.revision then
    self.shuffleAt=self.shuffleAt or {}
    for _,owner in ipairs({'you','opponent'}) do
      if self.shuffled=='both' or self.shuffled==owner then self.shuffleAt[owner]=self.time end
    end
    if not self.reduced then self.callbacks.feedback('cardFan2',0.95+love.math.random()*0.1) end
  end
  for _,p in ipairs(self.piles) do
    local at=self.shuffleAt and self.shuffleAt[p.owner]
    if p.item.kind=='deck' and at and self.time-at<Pile.SHUFFLE_TIME then p:shuffle(at) end
  end
  self.hud:sync(self,self.time)
  self:build()
  self.callbacks.announce(self.message~='' and self.message or (menu and menu.title) or self.title)
end
-- Lay out every card for the current snapshot. Cards keep their Moveable
-- across snapshots, so zone changes slide; new cards start at their source.
function Simulator:placeCards(resize,previous)
  if not self.L then return end
  local L=self.L
  local old=self.byUid;self.byUid={};self.cards={}
  local counts={}
  for _,item in ipairs(self.items) do local key=item.owner..item.zone;counts[key]=(counts[key] or 0)+1 end
  local prevByUid={}
  -- Bench slots pack tightly; a slot only widens where an attached card
  -- peeks out of it (Energy on the right, Tools on the left).
  local benchX={}
  for _,owner in ipairs({'you','opponent'}) do
    local zone=L.zones[prefix(owner)..'bench']
    local list={}
    for _,it in ipairs(self.items) do if it.owner==owner and it.zone=='bench' then list[#list+1]=it end end
    table.sort(list,function(a,b) return a.index<b.index end)
    local cardW=142*zone.scale
    local peek=26
    local total,gaps=#list*cardW,{}
    for i=2,#list do
      local g=8+((#(list[i-1].energyCards or {})>0) and peek or 0)+((#(list[i].toolCards or {})>0) and peek or 0)
      gaps[i]=g;total=total+g
    end
    local x=zone.x-total/2+cardW/2
    benchX[owner]={}
    for i,it in ipairs(list) do
      if i>1 then x=x+cardW+gaps[i] end
      benchX[owner][it.index]=x
    end
  end
  if previous and previous.items then for _,it in ipairs(previous.items) do prevByUid[it.owner..':'..it.id]=it end end
  -- Where a card attached to a Pokémon was last seen: under that Pokémon.
  -- A discarded Energy or Tool starts its slide there, together with the
  -- retreat or swap that paid it, not from the hand.
  local attachedFrom={}
  if previous and previous.items then
    for _,it in ipairs(previous.items) do
      local host=old[it.owner..':'..it.id]
      if host then
        for _,list in ipairs({it.energyCards or {},it.toolCards or {}}) do
          for _,a in ipairs(list) do attachedFrom[it.owner..':'..a.id]={x=host.x,y=host.y} end
        end
      end
    end
  end
  -- Evolution gives the in-play stack the new top card's uid. A Pokémon that
  -- appears on a spot whose previous occupant is nowhere in this snapshot is
  -- that occupant evolved: it takes over the old card's place rather than
  -- sliding in while the Basic ghosts to the discard.
  local nowByUid={}
  for _,it in ipairs(self.items) do nowByUid[it.owner..':'..it.id]=it end
  local prevBySpot,occupied={},{}
  if previous and previous.items then
    for _,it in ipairs(previous.items) do
      if it.zone=='active' or it.zone=='bench' then
        occupied[it.owner..':'..it.zone..':'..it.index]=true
        if not nowByUid[it.owner..':'..it.id] then prevBySpot[it.owner..':'..it.zone..':'..it.index]=it end
      end
    end
  end
  local youPrizesTaken=previous and previous.sides and previous.sides.you and self.sides.you and self.sides.you.prizes<previous.sides.you.prizes
  -- A hot-seat flip mirrors the whole table: every card is re-created in
  -- place, with no entrance slide and no ghosts.
  local flipped=previous and previous.viewerSeat and previous.viewerSeat~='' and previous.viewerSeat~=self.viewerSeat
  -- The first snapshot of a (re)loaded game has nothing to diff against: cards
  -- in play and piles simply appear; only the hand is dealt in from the deck.
  local fresh=not previous or previous.phase~='ready'
  for i,item in ipairs(self.items) do
    item.edition='dissolve';item.resolution=2;item.drawFace=function(w,h) self:face(item,w,h) end
    local zone=L.zones[prefix(item.owner)..(item.zone=='prize' and 'prizes' or item.zone)] or L.zones.playmat
    if item.zone=='discard' then
      -- The discard is a pile (below); a card arriving from a hand slides in
      -- as a short-lived ghost. Cards leaving the table already ghost there.
      local prev=prevByUid[item.owner..':'..item.id]
      if not fresh and previous.items and not resize and not flipped and not self.reduced and (not prev or prev.zone=='hand') then
        local from=attachedFrom[item.owner..':'..item.id] or L.zones[prefix(item.owner)..'hand']
        local c=self:newCard(item,i,from.x,from.y,zone.scale)
        c.ghost={start=self.time,target=zone}
        self.ghosts[#self.ghosts+1]=c
      end
    elseif not (item.zone=='hand' and zone.hidden) then
      local n=counts[item.owner..item.zone] or 1
      local x,y,rotation=zone.x,zone.y,0
      local scale=zone.scale or 0.6
      if item.zone=='hand' then
        x,y,rotation=Layout.hand(zone,n,item.index)
        if item.owner=='opponent' then rotation=-rotation;y=zone.y-(y-zone.y) end
      elseif item.zone=='bench' then x,y=(benchX[item.owner] or {})[item.index] or Layout.bench(zone,n,item.index),zone.y
      elseif item.zone=='prize' then x,y=Layout.prize(zone,item.index)
      end
      local key=item.owner..':'..item.id
      local c=old[key];old[key]=nil
      if c and (c.item.cardId~=item.cardId or c.item.hidden~=item.hidden) then c.texture:release();c=nil end
      if (item.zone=='active' or item.zone=='bench') and not item.hidden then
        local was=prevBySpot[item.owner..':'..item.zone..':'..item.index]
        local oldKey=was and (item.owner..':'..was.id)
        if oldKey and old[oldKey] then
          item.evolvedFrom=was
          if c then
            -- The Stage card slides from the hand onto the spot; the Basic
            -- underneath simply stops being drawn.
            old[oldKey].texture:release();old[oldKey]=nil
          else
            c=old[oldKey];old[oldKey]=nil
            c.texture:release();c.item=item;c.index=i;c:rebuild()
          end
        end
      end
      if not c then
        c=self:newCard(item,i,x,y,scale)
        local prev=prevByUid[key]
        if not self.reduced and previous and previous.items and not resize and not flipped and (not fresh or item.zone=='hand') then
          -- A card entering the table starts where it came from.
          local from
          if item.zone=='hand' then from=youPrizesTaken and item.owner=='you' and L.zones.you_prizes or L.zones[prefix(item.owner)..'deck']
          elseif item.zone=='discard' then from=prev and L.zones[prefix(item.owner)..prev.zone] or L.zones[prefix(item.owner)..'hand']
          elseif (item.zone=='active' or item.zone=='bench') and occupied[item.owner..':'..item.zone..':'..item.index] then
            -- A Pokémon reappearing on an occupied spot (an undone evolution
            -- putting the Basic back) was there all along: no entrance.
            from=nil
          elseif item.owner=='opponent' then from=L.zones.opp_hand
          else from=L.zones.you_deck end
          if from then c.motion.VT.x=from.x/c.unit;c.motion.VT.y=from.y/c.unit end
        end
      else
        c.item=item
        if resize or math.abs(c.baseScale-scale)>0.001 then
          local px,py=c.x,c.y;c:place(x,y,scale,false);c.motion.VT.x=px/c.unit;c.motion.VT.y=py/c.unit
        else c.homeX,c.homeY=x,y end
      end
      c.baseY=y;c.baseRotation=rotation
      c.fan=item.zone=='hand' and (item.index-(n-1)/2)/n or nil
      c.lift=0;c.dragging=false
      local statusRotation=0
      for _,s in ipairs(Energy.split(item.status)) do statusRotation=STATUS_ROTATION[s] or statusRotation end
      c.statusRotation=statusRotation
      c.motion.T.r=rotation+statusRotation
      c.zoneKey=item.owner..'_'..item.zone
      self.cards[#self.cards+1]=c
      self.byUid[key]=c
    end
  end
  -- Cards that left the table become ghosts: KO'd Pokémon dissolve where they
  -- stood, everything else slides to its owner's discard pile.
  for key,c in pairs(old) do
    local item=c.item
    if not resize and not flipped and previous and previous.items and not self.reduced and item.zone~='hand' and item.zone~='prize' and item.zone~='discard' and not item.hidden then
      local koed=item.hp and item.damage and item.damage>=item.hp and item.zone~='stadium'
      local target=L.zones[(item.owner=='global' and 'you_' or prefix(item.owner))..'discard']
      c.ghost={start=self.time,koed=koed,target=target}
      c.dragging=false;c.lift=0
      if koed then c.burn1={1,0.4,0.3,1};c.burn2={0.95,0.6,0.1,1} end
      self.ghosts[#self.ghosts+1]=c
    else c.texture:release() end
  end
  -- Textures for attached Energy and Tool cards, keyed by uid.
  self.attached=self.attached or {}
  local keep={}
  for _,item in ipairs(self.items) do
    for _,list in ipairs({item.energyCards or {},item.toolCards or {}}) do
      for _,a in ipairs(list) do
        keep[a.id]=true
        if not self.attached[a.id] or self.attached[a.id].item.cardId~=a.cardId then
          if self.attached[a.id] then self.attached[a.id].texture:release() end
          local info=self.info[a.cardId] or {}
          local card={id=a.id,cardId=a.cardId,name=info.name or ((a.kind or 'Pokémon')..(a.kind and ' Energy' or ' Tool')),edition='dissolve',resolution=2}
          card.drawFace=function(w,h) self:face(card,w,h) end
          self.attached[a.id]=Card.new(card,1)
        end
      end
    end
  end
  for uid,c in pairs(self.attached) do if not keep[uid] then c.texture:release();self.attached[uid]=nil end end
  -- Deck piles, and the discard piles showing their top card face up. A
  -- discard pile with a card still sliding towards it keeps its old face and
  -- count until that card lands (the new pile waits in `pendingPiles`).
  local oldPiles={}
  for _,p in ipairs(self.piles) do oldPiles[p.owner..':'..p.item.kind]=p end
  self.piles={};self.pendingPiles=self.pendingPiles or {}
  local landing={}
  for _,c in ipairs(self.ghosts) do
    if c.ghost and c.ghost.target and not c.ghost.koed and self.time-c.ghost.start<0.7 then
      landing[(c.item.owner=='global' and 'you' or c.item.owner)]=true
    end
  end
  for _,owner in ipairs({'opponent','you'}) do
    local side=self.sides[owner]
    local zone=L.zones[prefix(owner)..'deck']
    if side and zone then
      local item={id=owner..'deck',owner=owner,kind='deck',count=side.deck,name='Deck',drawFace=function(w,h) Library.face(self,{},w,h) end}
      local p=Pile.new(item,1);p:place(zone.x,zone.y,zone.scale,false,self.boardW);p.owner=owner
      self.piles[#self.piles+1]=p
    end
    local dzone=L.zones[prefix(owner)..'discard']
    local top
    for _,it in ipairs(self.items) do if it.owner==owner and it.zone=='discard' then top=it end end
    if side and dzone and top then
      local item={id=owner..'discard',owner=owner,kind='discard',count=math.max(1,side.discard),name='Discard',drawFace=function(w,h) self:face(top,w,h) end}
      local p=Pile.new(item,1);p:place(dzone.x,dzone.y,dzone.scale,false,self.boardW);p.owner=owner;p.topItem=top
      if landing[owner] and not resize then
        if self.pendingPiles[owner] then self.pendingPiles[owner].texture:release() end
        self.pendingPiles[owner]=p
        local keep=oldPiles[owner..':discard']
        if keep then self.piles[#self.piles+1]=keep;oldPiles[owner..':discard']=nil end
      else
        self.piles[#self.piles+1]=p
        if self.pendingPiles[owner] then self.pendingPiles[owner].texture:release();self.pendingPiles[owner]=nil end
      end
    end
  end
  for _,p in pairs(oldPiles) do p.texture:release() end
end
-- Diff the previous snapshot into juice: damage pops, heals, KO sounds,
-- prize chips, errors and background colour.
function Simulator:react(previous)
  local fx=self.fx
  local L=self.L
  if self.phase~='ready' then fx:background('setup');return end
  if self.outcome~='' then fx:background(self.outcome=='win' and 'win' or self.outcome=='loss' and 'loss' or 'opponent')
  elseif self.gamePhase:sub(1,6)=='setup:' then fx:background('setup')
  else fx:background(self.activePlayer=='opponent' and 'opponent' or 'you') end
  if not previous or not previous.items or previous.phase~='ready' then
    if self.outcome~='' and self.outcome~=previous.outcome then self:openGameOver() end
    return
  end
  if self.message~='' and (self.message~=previous.message or self.revision~=previous.revision) then
    fx:attention({text=self.message,scale=0.5,colour=T.white,backdrop=T.red,x=L.banner.x,y=L.banner.y,hold=1.6,sound='cancel',jiggle=0.5,maxw=L.table.w-40})
  end
  -- Public uids are stable across a hot-seat flip; hidden cards are positional.
  local prev={}
  for _,it in ipairs(previous.items) do prev[it.hidden and (it.owner..':'..it.id) or it.id]=it end
  local delay=0
  for _,item in ipairs(self.items) do
    local key=item.owner..':'..item.id
    local was=prev[item.hidden and key or item.id]
    local c=self.byUid[key]
    if c and was and (item.zone=='active' or item.zone=='bench') and (was.zone=='active' or was.zone=='bench') then
      if item.damage>was.damage then
        local amount=item.damage-was.damage
        fx:after(delay,function()
          fx:attention({text='-'..amount,scale=0.9,colour=T.white,backdrop=T.red,follow=function() return c.x,c.y end,offsetY=-0.15*190*c.baseScale,hold=0.8,sound='multhit1',pitch=0.9+math.min(amount,120)/400,jiggle=0.7})
          c:juiceUp(self.time,0.6,0.1,self.reduced)
        end)
        delay=0.35
      elseif item.damage<was.damage then
        local amount=was.damage-item.damage
        fx:after(delay,function()
          fx:attention({text='+'..amount,scale=0.8,colour=T.white,backdrop=CHANCE,follow=function() return c.x,c.y end,offsetY=-0.15*190*c.baseScale,hold=0.7,sound='chips1'})
          c:juiceUp(self.time,0.3,0.05,self.reduced)
        end)
        delay=0.3
      end
      if item.status~=was.status and item.status~='' then
        local label=item.status:gsub('^%l',string.upper):gsub(',%s*',' + ')
        fx:after(delay,function()
          fx:attention({text=label,scale=0.6,colour=T.white,backdrop=PURPLE,follow=function() return c.x,c.y end,offsetY=0.2*190*c.baseScale,hold=0.9,sound='tarot2',pitch=0.9})
        end)
        delay=0.3
      end
      if #item.energies>#was.energies then
        self.callbacks.feedback('card1',1.05)
        c:juiceUp(self.time,0.4,0.08,self.reduced)
      end
      if item.cardId~=was.cardId then
        fx:after(delay,function()
          fx:attention({text='Evolved',scale=0.6,colour=T.white,backdrop=T.blue,follow=function() return c.x,c.y end,offsetY=-0.15*190*c.baseScale,hold=0.8,sound='highlight1'})
          c:juiceUp(self.time,0.5,0.1,self.reduced)
        end)
        delay=0.3
      end
    elseif c and not was and item.evolvedFrom then
      fx:after(delay,function()
        fx:attention({text='Evolved',scale=0.6,colour=T.white,backdrop=T.blue,follow=function() return c.x,c.y end,offsetY=-0.15*190*c.baseScale,hold=0.8,sound='highlight1'})
        c:juiceUp(self.time,0.5,0.1,self.reduced)
      end)
      delay=0.3
    elseif c and not was and (item.zone=='bench' or item.zone=='active') and not item.hidden then
      self.callbacks.feedback('cardSlide1',1)
    elseif c and not was and item.zone=='hand' and item.owner=='you' and not self.reduced then
      self.callbacks.feedback('card1',0.9+love.math.random()*0.2)
    end
  end
  for _,c in ipairs(self.ghosts) do
    if c.ghost and c.ghost.start==self.time then
      if c.ghost.koed then
        fx:after(delay,function()
          fx:attention({text='KNOCKED OUT',scale=0.75,colour=T.white,backdrop=T.red,x=c.x,y=c.y-0.1*190*c.baseScale,hold=1.1,sound='glass2',jiggle=1.5})
        end)
        delay=0.5
      else self.callbacks.feedback('cardSlide2',0.95) end
    end
  end
  for _,owner in ipairs({'you','opponent'}) do
    local now,was=self.sides[owner],previous.sides and previous.sides[owner]
    if now and was and now.prizes<was.prizes then
      local zone=L.zones[(owner=='you' and 'you' or 'opp')..'_prizes']
      local taken=was.prizes-now.prizes
      fx:after(delay,function()
        fx:attention({text='+'..taken..(taken>1 and ' PRIZES' or ' PRIZE'),scale=0.7,colour=T.white,backdrop=MONEY,x=zone.well.x+zone.well.w/2,y=zone.well.y+zone.well.h/2,hold=1.0,sound='coin3',jiggle=1})
      end)
      delay=0.4
    end
  end
  -- A hot-seat flip passes the table straight to the next player: the
  -- TURN banner (after the attack juice) is the only announcement.
  local flipped=self.viewerSeat~=previous.viewerSeat and previous.viewerSeat~=''
  if (self.turn~=previous.turn or flipped) and self.turn>0 and self.gamePhase=='turn:action' and self.outcome=='' then
    fx:after(delay,function()
      fx:attention({text='TURN '..self.turn,scale=0.9,colour=T.white,backdrop=self.activePlayer=='you' and T.blue or T.red,x=L.banner.x,y=L.banner.y,hold=0.9,sound='cardFan2',jiggle=1})
    end)
  end
  if self.outcome~='' and self.outcome~=previous.outcome then
    fx:after(delay+0.3,function() self:openGameOver() end)
  end
end
function Simulator:openGameOver()
  if self.overlay then self.overlay:release() end
  local you,opp=self.sides.you or {prizes=0},self.sides.opponent or {prizes=0}
  local winner=self.outcome=='win' and self.you or self.outcome=='loss' and self.opponent or 'Nobody'
  local rows={
    {label='Winner',value=winner,colour=self.outcome=='win' and T.blue or T.red},
    {label='Reason',value=self.outcomeDetail~='' and self.outcomeDetail or 'Game over'},
    {label='Turns played',value=tostring(self.turn),colour=MONEY},
    {label='Your prizes left',value=tostring(you.prizes),colour=T.blue},
    {label='Opponent prizes left',value=tostring(opp.prizes),colour=T.red},
    {label='Cards in hand',value=tostring(you.hand)},
  }
  self.overlay=Overlay.new(self,'gameover',{title=self.outcome=='win' and 'YOU WIN!' or self.outcome=='loss' and 'GAME OVER' or 'DRAW',rows=rows,mandatory=true})
  self.callbacks.feedback(self.outcome=='win' and 'win' or 'cancel',self.outcome=='win' and 1 or 0.8)
  if self.callbacks.jiggle then self.callbacks.jiggle(2) end
end
-- Menus from the host become overlays, or (for board targets and prizes)
-- a targeting banner over the live table.
function Simulator:applyMenu(previous)
  local menu=self.menu
  if self.overlay and self.overlay.kind=='gameover' and not (menu and menu.kind=='coin') then return end
  if not menu then
    if self.overlay and self.overlay.kind~='options' and self.overlay.kind~='inspect' and self.overlay.kind~='gameover' then
      local kind=self.overlay.kind
      self.overlay:release();self.overlay=nil
    end
    self.targeting=nil
    return
  end
  if menu.kind=='board' or menu.kind=='prizes' then
    if self.overlay and self.overlay.kind~='gameover' then self.overlay:release();self.overlay=nil end
    self.targeting={menu=menu}
    return
  end
  self.targeting=nil
  if self.overlay and self.overlay.data and self.overlay.data.id==menu.id and self.overlay.kind==menu.kind then self.overlay:refresh(menu);return end
  if self.overlay then self.overlay:release() end
  self.overlay=Overlay.new(self,menu.kind,menu)
  if self.callbacks.jiggle then self.callbacks.jiggle(1) end
end
function Simulator:closeOverlay(fromBack)
  if not self.overlay then return end
  local kind=self.overlay.kind
  self.overlay:release();self.overlay=nil
  if fromBack and self.menu and kind==self.menu.kind and not self.menu.mandatory then self:command('dismiss') end
  self:build()
end
function Simulator:invoke(token)
  if token and token~='' then self:command('invoke',self.revision,token) end
end
-- ---------------------------------------------------------------- controls
function Simulator:add(label,x,y,w,h,action,colour,extra)
  local b=extra or {}
  b.label,b.x,b.y,b.w,b.h,b.action=label,x,y,w,h,action
  b.colour=b.disabled and T.panel or colour or T.blue
  b.fontSize=b.fontSize or 24
  -- UIBox_button labels shrink to their minw rather than wrapping.
  local shown=b.uppercase and label:upper() or label
  while b.fontSize>12 and T.font(b.fontSize):getWidth(shown)>w-14 do b.fontSize=b.fontSize-1 end
  self.controls[#self.controls+1]=b
  return b
end
function Simulator:build()
  self.controls={}
  if not self.L then return end
  local L=self.L
  -- HUD buttons: Run Info -> Game log, Options.
  local hb=self.hud:buttons(L)
  self:add(hb.log.label or 'Log',hb.log.x,hb.log.y,hb.log.w,hb.log.h,'log',T.red,{lines=hb.log.lines,fontSize=hb.log.fontSize or 24,disabled=self.phase~='ready'})
  self:add(hb.options.label or 'Options',hb.options.x,hb.options.y,hb.options.w,hb.options.h,'options',T.orange,{lines=hb.options.lines,fontSize=hb.options.fontSize or 20})
  -- Action cluster (create_UIBox_buttons): primary blue, danger red, minors.
  -- Desktop: the cluster lives in the HUD's action panel; portrait keeps
  -- its horizontal strip under the table.
  local cl=(not L.portrait and hb.cluster) or L.cluster
  local primaries,dangers,minors={},{},{}
  for _,a in ipairs(self.actions) do
    if a.slot=='primary' then primaries[#primaries+1]=a elseif a.slot=='danger' then dangers[#dangers+1]=a else minors[#minors+1]=a end
  end
  if cl.horizontal then
    local all={}
    for _,a in ipairs(primaries) do all[#all+1]=a end
    for _,a in ipairs(minors) do all[#all+1]=a end
    for _,a in ipairs(dangers) do all[#all+1]=a end
    local n=#all
    if n>0 then
      local bw=(cl.w-(n-1)*6)/n
      for i,a in ipairs(all) do self:add(a.label,cl.x+(i-1)*(bw+6),cl.y+8,bw,44,'invoke',a.colour,{token=a.token,disabled=a.disabled,fontSize=math.min(24,math.max(14,math.floor(bw/5)))}) end
    end
  else
    local y=cl.y
    for _,a in ipairs(primaries) do self:add(a.label,cl.x,y,cl.w,44,'invoke',a.colour,{token=a.token,disabled=a.disabled,fontSize=24});y=y+50 end
    for _,a in ipairs(dangers) do self:add(a.label,cl.x,y,cl.w,40,'invoke',a.colour,{token=a.token,disabled=a.disabled,fontSize=22});y=y+46 end
    -- With one tall button (Ready / Choose decks) the panel still looks filled.
    if #primaries+#dangers==1 and #minors==0 then self.controls[#self.controls].h=56;self.controls[#self.controls].y=cl.y+(cl.h-56)/2 end
    local n=#minors
    if n>0 then
      local cols=math.min(2,n)
      local bw=(cl.w-(cols-1)*6)/cols
      for i,a in ipairs(minors) do
        local col=(i-1)%cols;local row=math.floor((i-1)/cols)
        self:add(a.label,cl.x+col*(bw+6),y+row*38,bw,32,'invoke',a.colour,{token=a.token,disabled=a.disabled,fontSize=19})
      end
    end
  end
  -- Pile clicks.
  for _,owner in ipairs({'opponent','you'}) do
    local z=L.zones[(owner=='you' and 'you' or 'opp')..'_discard']
    if z then self:add('',z.well.x,z.well.y,z.well.w,z.well.h,'pile',nil,{owner=owner,invisible=true,disabled=self.phase~='ready'}) end
  end
  -- Targeting banner: footer buttons and Back live in a floating panel.
  if self.targeting then
    local m=self.targeting.menu
    local bx,by,bw=L.banner.x-(L.portrait and 220 or 300),L.banner.y-(L.portrait and 100 or 96),L.portrait and 440 or 600
    local n=#m.footer+(m.mandatory and 0 or 1)
    if n>0 then
      local fw=(bw-24-(n-1)*8)/n
      local i=0
      for _,o in ipairs(m.footer) do self:add(o.label,bx+12+i*(fw+8),by+70,fw,34,'invoke',o.colour,{token=o.token,disabled=o.disabled,fontSize=22});i=i+1 end
      if not m.mandatory then self:add('Cancel',bx+12+i*(fw+8),by+70,fw,34,'dismiss',T.orange,{fontSize=22}) end
    end
    self.targeting.panel={x=bx,y=by,w=bw,h=n>0 and 112 or 70}
  elseif self.luaTargeting then
    local bx,by,bw=L.banner.x-(L.portrait and 220 or 300),L.banner.y-(L.portrait and 100 or 96),L.portrait and 440 or 600
    self:add('Cancel',bx+bw/2-80,by+70,160,34,'cancelTargeting',T.orange,{fontSize=22})
    self.luaTargeting.panel={x=bx,y=by,w=bw,h=112}
  end
  -- Attached buttons for the highlighted card (use/sell buttons).
  if self.highlight and self.highlight.item then self:buildAttached(self.highlight) end
  if self.focus>#self.controls then self.focus=0 end
end
local function groupLabel(group)
  local labels={attach='Attach',evolve='Evolve',tool='Attach',rareCandy='Rare Candy',ability='Ability'}
  return labels[group] or (group:gsub('^%l',string.upper))
end
function Simulator:buildAttached(card)
  local item=card.item
  local list=self.cardActions[item.id] or {}
  local buttons={}
  local groups={}
  for _,a in ipairs(list) do
    if a.group~='' and a.targetUid~='' then
      local gk=a.group
      if not groups[gk] then groups[gk]={label=groupLabel(gk),colour=a.colour,actions={},disabled=true};buttons[#buttons+1]=groups[gk] end
      groups[gk].actions[#groups[gk].actions+1]=a
      if not a.disabled then groups[gk].disabled=false end
    else buttons[#buttons+1]={label=a.label,colour=a.colour,token=a.token,disabled=a.disabled,cost=a.cost,damage=a.damage} end
  end
  if not item.hidden and item.cardId~='' then buttons[#buttons+1]={label='View',colour=T.profile,view=true} end
  local scale=card.baseScale
  local cw,ch=142*scale,190*scale
  local bw,bh=math.max(cw+20,120),36
  for _,b in ipairs(buttons) do if (b.cost and #b.cost>0) or (b.damage and b.damage~='') then bw=math.max(bw,200) end end
  local above=item.zone=='hand' or (self.portrait and item.owner=='you')
  local x,y
  -- The highlighted card lifts 0.2 card heights once update runs; lay the
  -- column out above that lifted position.
  local lift=0.2*190*scale
  if above then x=card.homeX-bw/2;y=card.homeY-lift-ch/2-10-#buttons*(bh+6)
  else
    x=card.homeX+cw/2+10;y=card.homeY-ch/2
    if x+bw>self.boardW-8 then x=card.homeX-cw/2-10-bw end
  end
  x=math.max(4,math.min(self.boardW-bw-4,x))
  if y<4 then y=4 end
  for i,b in ipairs(buttons) do
    local action=b.view and 'inspect' or (b.actions and 'target' or 'cardAction')
    local added=self:add(b.label,x,y+(i-1)*(bh+6),bw,bh,action,b.colour,{token=b.token,disabled=b.disabled,fontSize=21,attached=true,card=card,group=b,cost=b.cost,damage=b.damage})
    if b.disabled then added.colour={95/255,115/255,119/255,1} end -- G.C.GREY, not the panel black
  end
end
function Simulator:hit(x,y)
  for i=#self.controls,1,-1 do
    local b=self.controls[i]
    if not b.disabled and Button.hit(b,x,y) then return i end
  end
  return 0
end
function Simulator:cardHit(x,y)
  if self.overlay then return nil end
  local best
  for i=#self.cards,1,-1 do
    local c=self.cards[i]
    if c:hit(x,y) then
      if c.item.zone=='hand' and c.item.owner=='you' then return c end
      best=best or c
    end
  end
  return best
end
-- Candidates in targeting mode: host prompts name board uids or prize slots;
-- Lua targeting names the cards a grouped action can be applied to.
function Simulator:targetFor(card)
  if self.luaTargeting then
    for _,a in ipairs(self.luaTargeting.actions) do if a.targetUid==card.item.id and not a.disabled then return a end end
    return nil
  end
  if self.targeting then
    local m=self.targeting.menu
    for _,o in ipairs(m.options) do
      if not o.disabled and ((m.kind=='board' and o.uid==card.item.id) or (m.kind=='prizes' and card.prizeSlot and o.uid=='prize:'..card.prizeSlot)) then return o end
    end
  end
  return nil
end
function Simulator:isCandidate(card) return self:targetFor(card)~=nil end
function Simulator:prizeSlotHit(x,y)
  if not self.targeting or self.targeting.menu.kind~='prizes' then return nil end
  local z=self.L.zones.you_prizes
  local side=self.sides.you or {prizes=0}
  for i=0,side.prizes-1 do
    local px,py=Layout.prize(z,i)
    local w,h=142*z.scale,190*z.scale
    if x>=px-w/2-4 and x<=px+w/2+4 and y>=py-h/2-4 and y<=py+h/2+4 then return i end
  end
  return nil
end
-- ---------------------------------------------------------------- update
function Simulator:update(dt,time,mx,my,reduced)
  self.time,self.reduced=time,reduced
  if love.filesystem.getInfo('__simulator.txt') then self:sync(love.filesystem.read('__simulator.txt')) end
  if love.filesystem.getInfo('__builder_art.txt') then
    local raw=love.filesystem.read('__builder_art.txt')
    if raw~=self.artRaw then
      self.artRaw=raw;local art={}
      for line in raw:gmatch('[^\n]+') do local r=Codec.fields(line);if r[2] then art[r[1]]=r[2] end end
      local old=self.art;self.art=art
      for _,c in ipairs(self.cards) do if old[c.item.cardId]~=art[c.item.cardId] then c:rebuild() end end
      -- Discard piles paint their top card's scan, which can arrive after a reload.
      for _,p in ipairs(self.piles) do if p.topItem and old[p.topItem.cardId]~=art[p.topItem.cardId] then p:rebuild() end end
      for _,c in pairs(self.attached or {}) do if old[c.item.cardId]~=art[c.item.cardId] then c:rebuild() end end
      if self.overlay then for _,c in ipairs(self.overlay.cards) do if old[c.item.cardId]~=art[c.item.cardId] then c:rebuild() end end end
    end
  end
  mx,my=self:point(mx,my);self.mx,self.my=mx,my
  -- Table juice waits behind an open coin flip, like Balatro's event queue.
  self.fx:update(dt,time,reduced,self.overlay and self.overlay.kind=='coin')
  self.hud:update(dt,time,reduced)
  local blocked=self.overlay and not self.peek
  if self.overlay then self.overlay:update(dt,time,blocked and mx or -1000,blocked and my or -1000,reduced) end
  self.hover=blocked and 0 or self:hit(mx,my)
  local hovered=(not blocked and self.hover==0) and self:cardHit(mx,my) or nil
  if self.drag then
    local d=self.drag
    if not d.moved and (mx-d.x)^2+(my-d.y)^2>36 then d.moved=true;d.card.dragging=true;self.callbacks.feedback('cardSlide1',0.95);self.highlight=nil;self:build() end
    if d.moved then d.card.targetX,d.card.targetY=mx-d.dx,my-d.dy;self.dropZone=self:dropZoneAt(mx,my,d.card) end
  end
  self.hoverCard=hovered
  for _,c in ipairs(self.cards) do
    local active=not blocked and (c==hovered or self.focusCard==c)
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.callbacks.feedback('paper1',0.9+love.math.random()*0.2) end
    c.held=(self.drag~=nil and self.drag.card==c) or nil
    local breathe=reduced and 0 or 1
    if c.fan then
      local sign=c.item.owner=='opponent' and -1 or 1
      c.motion.T.r=c.baseRotation+breathe*0.02*math.sin(2*time+c.homeX/c.unit)*sign
      c.homeY=c.baseY+breathe*0.03*math.sin(0.666*time+c.homeX/c.unit)*c.unit*sign
    elseif c.item.zone=='bench' or c.item.zone=='active' or c.item.zone=='stadium' then
      c.motion.T.r=c.baseRotation+c.statusRotation+breathe*0.0*math.sin(time)
      c.homeY=c.baseY+breathe*0.03*math.sin(0.666*time+c.homeX/c.unit)*c.unit*0.5
    end
    local candidate=self:isCandidate(c)
    if candidate and not reduced then
      c.candidateClock=(c.candidateClock or 0)+dt
      if c.candidateClock>0.8 then c.candidateClock=0;c:juiceUp(time,0.1,0.1,reduced) end
    end
    c.lift=(c==self.highlight) and 0.2*190*c.baseScale or 0
    c.tint=nil
    if (self.targeting or self.luaTargeting) and not candidate and c.item.owner~='global' and c.item.zone~='hand' and c.item.zone~='prize' then c.tint={0.6,0.6,0.6,1} end
    c:update(dt,time,active,reduced)
  end
  for i=#self.ghosts,1,-1 do
    local c=self.ghosts[i]
    local age=time-c.ghost.start
    if c.ghost.koed then
      c.dissolve=math.min(1,age/0.9)
      c:update(dt,time,false,reduced)
      if age>1.0 then c.texture:release();table.remove(self.ghosts,i) end
    else
      if c.ghost.target then c.homeX,c.homeY=c.ghost.target.x,c.ghost.target.y;c.motion.T.r=0 end
      c:update(dt,time,false,reduced)
      if age>0.7 then
        c.texture:release();table.remove(self.ghosts,i)
        -- The card has landed: the pile it joined shows its new face.
        local owner=c.item.owner=='global' and 'you' or c.item.owner
        local pending=self.pendingPiles and self.pendingPiles[owner]
        if pending then
          for k=#self.piles,1,-1 do local p=self.piles[k];if p.owner==owner and p.item.kind=='discard' then p.texture:release();table.remove(self.piles,k) end end
          self.piles[#self.piles+1]=pending;self.pendingPiles[owner]=nil
        end
      end
    end
  end
  for _,p in ipairs(self.piles) do p:update(dt,time,false,reduced,self.boardW) end
  -- Hover popup (card_h_popup) for face-up cards with catalogue info.
  self.popup=nil
  if hovered and hovered~=self.highlight and not hovered.item.hidden and not self.drag and self.info[hovered.item.cardId] and not blocked then
    local key=hovered.item.owner..':'..hovered.item.id..':'..(hovered.item.damage or 0)..':'..(hovered.item.status or '')
    if self.popupKey~=key then self.popupKey=key;self.popupBox=Popup.build(self.info[hovered.item.cardId],hovered.item,self.portrait and 236 or 270,self.boardW) end
    self.popup=hovered
  end
end
function Simulator:dropZoneAt(x,y,card)
  local L=self.L;local item=card.item
  local Z=L.zones
  if item.zone=='hand' then
    if Layout.inside(Z.you_active.well,x,y) then return {zone='active',index=0,well=Z.you_active.well} end
    if Layout.inside(Z.you_bench.well,x,y) then
      local count=0;local onto
      for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='bench' then count=count+1;if c~=card and c:hit(x,y) then onto=c end end end
      local index=onto and onto.item.index or Layout.benchIndex(Z.you_bench,count,x)
      return {zone='bench',index=index,well=Z.you_bench.well,card=onto}
    end
    if Layout.inside(Z.stadium.well,x,y) then return {zone='stadium',index=0,well=Z.stadium.well} end
    if Layout.inside(Z.playmat.well,x,y) or Layout.inside(Z.opp_active.well,x,y) then return {zone='playmat',index=0,well=Z.playmat.well} end
  elseif item.zone=='bench' then
    if Layout.inside(Z.you_bench.well,x,y) then
      local count=0;for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='bench' then count=count+1 end end
      return {zone='bench',index=math.min(count-1,Layout.benchIndex(Z.you_bench,count,x)),well=Z.you_bench.well}
    end
    -- A Benched Pokémon dropped on the Active spot swaps in: the Active
    -- retreats to this one, paying its cost from the attached Energy.
    if Layout.inside(Z.you_active.well,x,y) then return {zone='retreat',index=item.index,well=Z.you_active.well} end
  elseif item.zone=='active' then
    for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='bench' and c:hit(x,y) then return {zone='retreat',index=c.item.index,well=Z.you_bench.well,card=c} end end
    if Layout.inside(Z.you_bench.well,x,y) then return {zone='retreat',index=-1,well=Z.you_bench.well} end
  end
  return nil
end
-- ---------------------------------------------------------------- input
function Simulator:activate(index)
  local b=self.controls[index];if not b or b.disabled then return end
  if b.action~='pile' then self.callbacks.feedback('button') end
  local a=b.action
  if a=='invoke' then self:invoke(b.token)
  elseif a=='log' then self:command('log')
  elseif a=='options' then self:openOptions()
  elseif a=='pile' then self.callbacks.feedback('cardSlide2',1);self:command('pile',b.owner)
  elseif a=='dismiss' then self:command('dismiss')
  elseif a=='cancelTargeting' then self.luaTargeting=nil;self:build()
  elseif a=='inspect' then self:openInspect(b.card)
  elseif a=='cardAction' then self:runCardAction(b.group)
  elseif a=='target' then
    self.luaTargeting={actions=b.group.actions,title=b.group.label..' to which Pokémon?',card=b.card}
    self.highlight=nil;self:build()
  end
end
function Simulator:runCardAction(action)
  if not action or action.disabled then return end
  if action.actions then self.luaTargeting={actions=action.actions,title=action.label..' to which Pokémon?'};self.highlight=nil;self:build();return end
  self.highlight=nil
  self:invoke(action.token)
end
function Simulator:openOptions()
  if self.overlay then self.overlay:release() end
  self.highlight=nil;self.luaTargeting=nil
  self.overlay=Overlay.new(self,'options',{title='Options',mandatory=false})
  if self.callbacks.jiggle then self.callbacks.jiggle(1) end
  self:build()
end
function Simulator:openInspect(card)
  if not card or card.item.hidden then return end
  if self.overlay then self.overlay:release() end
  local actions={}
  for _,a in ipairs(self.cardActions[card.item.id] or {}) do
    if a.group=='' or a.targetUid=='' then actions[#actions+1]={label=a.label,colour=a.colour,token=a.token,disabled=a.disabled} end
  end
  local groups={}
  for _,a in ipairs(self.cardActions[card.item.id] or {}) do
    if a.group~='' and a.targetUid~='' then
      if not groups[a.group] then groups[a.group]={label=groupLabel(a.group),colour=a.colour,actions={},disabled=true};actions[#actions+1]=groups[a.group] end
      groups[a.group].actions[#groups[a.group].actions+1]=a
      if not a.disabled then groups[a.group].disabled=false end
    end
  end
  self.highlight=nil
  self.overlay=Overlay.new(self,'inspect',{title=card.item.name,item=card.item,actions=actions,mandatory=false})
  if self.callbacks.jiggle then self.callbacks.jiggle(0.5) end
  self:build()
end
function Simulator:mousepressed(x,y)
  x,y=self:point(x,y);self.focus=0;self.focusCard=nil
  if self.peek then self.peek=false;return end
  if self.overlay then self.pressedOverlay=self.overlay:hit(x,y);return end
  self.pressed=self:hit(x,y)
  if self.pressed>0 then return end
  local c=self:cardHit(x,y)
  local prize=self:prizeSlotHit(x,y)
  if prize then self.clickedPrize=prize;return end
  if c then
    self.clicked=c
    if c.item.owner=='you' and c.item.draggable and not self.targeting and not self.luaTargeting then
      self.drag={card=c,x=x,y=y,dx=x-c.x,dy=y-c.y,moved=false}
    end
  elseif self.highlight then self.highlight=nil;self:build() end
end
function Simulator:mousereleased(x,y)
  x,y=self:point(x,y)
  if self.overlay then
    if self.pressedOverlay and self.pressedOverlay>0 and self.pressedOverlay==self.overlay:hit(x,y) then self.overlay:activate(self.pressedOverlay) end
    self.pressedOverlay=nil;return
  end
  if self.pressed and self.pressed>0 then
    if self.pressed==self:hit(x,y) then self:activate(self.pressed) end
  elseif self.clickedPrize~=nil then
    if self.clickedPrize==self:prizeSlotHit(x,y) then
      local m=self.targeting.menu
      for _,o in ipairs(m.options) do if o.uid=='prize:'..self.clickedPrize and not o.disabled then self.callbacks.feedback('card1',1.1);self:invoke(o.token) end end
    end
  elseif self.drag and self.drag.moved then
    local d=self.drag;d.card.dragging=false
    local zone=self:dropZoneAt(x,y,d.card)
    if zone then
      local item=d.card.item
      if zone.zone=='retreat' then
        if zone.index>=0 then self:command('retreat',zone.index) else d.card:juiceUp(self.time,nil,nil,self.reduced) end
      else self:command('move',item.id,item.zone,item.index,zone.zone,zone.index) end
    else d.card:juiceUp(self.time,nil,nil,self.reduced) end
    self.dropZone=nil
  elseif self.clicked and self.clicked==self:cardHit(x,y) then
    local c=self.clicked
    local target=self:targetFor(c)
    if target then
      self.callbacks.feedback('card1',1.1)
      c:juiceUp(self.time,0.5,0.1,self.reduced)
      if self.luaTargeting then self.luaTargeting=nil;self:invoke(target.token)
      else self:invoke(target.token) end
      self:build()
    elseif self.targeting or self.luaTargeting then
      c:juiceUp(self.time,nil,nil,self.reduced)
    elseif c.item.zone=='discard' then self.callbacks.feedback('cardSlide2',1);self:command('pile',c.item.owner)
    elseif c.item.hidden then c:juiceUp(self.time,nil,nil,self.reduced)
    else
      -- Card:click lifts the card 0.2 card heights (cardSlide1 to select, a
      -- quiet cardSlide2 to drop), with the hover-sized Card:juice_up(0.05,0.03)
      -- wobble the real game shows on a pick.
      local selecting=self.highlight~=c
      c:juiceUp(self.time,0.05,0.03,self.reduced)
      self.callbacks.feedback(selecting and 'cardSlide1' or 'cardSlide2',1,selecting and 1 or 0.3)
      self.highlight=selecting and c or nil
      self:build()
    end
  end
  self.drag=nil;self.clicked=nil;self.pressed=nil;self.clickedPrize=nil
end
function Simulator:keypressed(key)
  if self.peek then self.peek=false;return end
  if self.overlay then self.overlay:keypressed(key);return end
  if key=='escape' then
    if self.luaTargeting then self.luaTargeting=nil;self:build()
    elseif self.highlight then self.highlight=nil;self:build()
    elseif self.targeting and not self.targeting.menu.mandatory then self:command('dismiss')
    else self:openOptions() end
    return
  end
  if key=='tab' or key=='left' or key=='right' or key=='up' or key=='down' then
    local cardCount=#self.cards
    local total=#self.controls+cardCount;if total==0 then return end
    local delta=(key=='left' or key=='up' or (key=='tab' and love.keyboard.isDown('lshift','rshift'))) and -1 or 1
    for _=1,total do
      self.focus=(self.focus-1+delta+total)%total+1
      local b=self.controls[self.focus];local c=self.cards[self.focus-#self.controls]
      if (b and not b.disabled and not b.invisible) or (c and not c.item.hidden) then self.focusCard=c;self.callbacks.announce(b and b.label or c.item.name);break end
    end
  elseif key=='return' or key=='space' then
    if self.focusCard then
      local c=self.focusCard
      local target=self:targetFor(c)
      if target then self.luaTargeting=nil;self:invoke(target.token)
      else self.highlight=(self.highlight==c) and nil or c;self:build() end
    else self:activate(self.focus) end
  elseif key=='v' and self.highlight then self:openInspect(self.highlight)
  end
end
function Simulator:wheelmoved(y)
  if self.overlay then self.overlay:wheelmoved(y) end
end
function Simulator:backgroundColours() return self.fx:colours() end
-- ---------------------------------------------------------------- drawing
-- CardArea area_uibox: black 10% r=0.1, with a whisper of the seat colour so
-- the two halves of the table read at a glance (opponent warm, you cool).
local WELL_TINT={opponent={0.55,0.12,0.12},you={0.06,0.22,0.5},global={0,0,0}}
local function well(x,y,w,h,owner)
  local t=WELL_TINT[owner or 'global']
  Button.panel(x,y,w,h,{0,0,0,0.1},1.2)
  if owner and owner~='global' then Button.panel(x,y,w,h,{t[1],t[2],t[3],0.22},1.2) end
end
function Simulator:drawBadges(c,rw)
  local item=c.item
  if item.hidden or not (item.zone=='active' or item.zone=='bench') then return end
  local scale=c.baseScale*c.motion.VT.scale
  local cw,ch=142*scale,190*scale
  local bottom=c.y+ch/2
  if item.status~='' then
    local names={}
    for _,s in ipairs(Energy.split(item.status)) do names[#names+1]=s:sub(1,1):upper()..s:sub(2) end
    local label=table.concat(names,' ')
    local tw=Dyna.measure(label,0.26)+12
    Button.panel(c.x-tw/2,c.y-ch/2-20,tw,16,PURPLE,1)
    Dyna.static(label,0.26,c.x-tw/2,c.y-ch/2-20,tw,16,T.white,{roomWidth=rw})
  end
end
-- Attached cards tuck behind the Pokémon sideways: Energy peeks out of the
-- right edge aligned to the bottom, Tools out of the left edge aligned to the
-- top, each further card a little less exposed, like a fanned stack.
function Simulator:drawAttached(c)
  local item=c.item
  if item.hidden or not (item.zone=='active' or item.zone=='bench') then return end
  local scale=c.baseScale*c.motion.VT.scale
  local cw,ch=142*scale,190*scale
  local s=scale*0.9
  local aw,ah=142*s,190*s -- the attached card's own width/height
  local peek=item.zone=='bench' and 26 or 36
  -- Stacks climb the edge: each further Energy sits 18px higher (Tools 18px
  -- lower), all peeking out by the same amount, like cards slid under a
  -- Pokémon one after another.
  local function stack(list,side)
    local n=#list
    local step=math.min(18,(ch-aw-6)/math.max(n-1,1))
    -- The first card sits at the edge; each later one lands on top of it.
    for i=1,n do
      local tex=self.attached[list[i].id]
      if tex and tex.texture then
        local out=peek
        -- Rotated 90°: horizontal extent ah, vertical aw. Inset 3px from the
        -- Pokémon's edge so neither the card nor its shadow shows past it.
        local x=c.x+side*(cw/2+out-ah/2)
        local y=side>0 and c.y+ch/2-aw/2-3-(i-1)*step or c.y-ch/2+aw/2+3+(i-1)*step
        -- The card's top (name banner) faces outward, as on a real table.
        local angle=side>0 and math.pi/2 or -math.pi/2
        local res=tex.item.resolution or 1
        local sx=aw/(142*res)
        g.setColor(0,0,0,0.3)
        g.draw(tex.texture,x+side*3,y+(side>0 and -1 or 3),angle,sx,sx,142*res/2,190*res/2)
        g.setColor(1,1,1,1)
        g.draw(tex.texture,x,y,angle,sx,sx,142*res/2,190*res/2)
      end
    end
  end
  stack(item.energyCards or {},1)
  stack(item.toolCards or {},-1)
end
function Simulator:drawCard(c,shaders,rw)
  self:drawAttached(c)
  c:draw(shaders,self.time,self.mx or 0,self.my or 0,self.reduced,rw)
  -- Targetable cards get the focus outline; the clicked card only lifts,
  -- like a selected card in Balatro's hand.
  if self:isCandidate(c) then
    local scale=c.baseScale*c.motion.VT.scale
    g.setLineWidth(2)
    g.push();g.translate(c.x,c.y);g.rotate(c.angle)
    Button.outline(-71*scale-3,-95*scale-3,142*scale+6,190*scale+6,T.white,1.2)
    g.pop()
  end
  self:drawBadges(c,rw)
end
function Simulator:drawPrizes(owner,rw)
  local L=self.L
  local z=L.zones[(owner=='you' and 'you' or 'opp')..'_prizes']
  local side=self.sides[owner] or {prizes=0}
  local faceUp={}
  for _,c in ipairs(self.cards) do if c.item.owner==owner and c.item.zone=='prize' then faceUp[c.item.index]=c;c.prizeSlot=c.item.index end end
  local w,h=142*z.scale,190*z.scale
  for i=0,side.prizes-1 do
    local px,py=Layout.prize(z,i)
    if not faceUp[i] then
      local selected=false
      if self.targeting and self.targeting.menu.kind=='prizes' and owner=='you' then
        for _,o in ipairs(self.targeting.menu.options) do if o.uid=='prize:'..i then selected=o.selected end end
      end
      local bob=(self.targeting and self.targeting.menu.kind=='prizes' and owner=='you' and not self.reduced) and math.sin(self.time*6+i)*2 or 0
      -- A selected prize lifts like a highlighted hand card instead of taking an outline.
      if selected then bob=bob+0.2*h end
      g.push();g.translate(px-w/2,py-h/2-bob)
      g.setColor(0,0,0,0.3);g.push();g.translate(0,3);Library.face(self,{},w,h);g.pop()
      Library.face(self,{},w,h)
      g.pop()
    end
  end
end
function Simulator:draw(shaders)
  g.push();g.translate(self.ox,self.oy);g.scale(self.zoom)
  local L=self.L;local Z=L.zones;local rw=self.boardW
  if not L then g.pop();return end
  -- Wells (CardArea area_uibox: black 10%, r=0.1), unlabelled: the cards and
  -- the HUD counters say what each one is.
  for _,name in ipairs({'opp_bench','opp_prizes','opp_deck','opp_discard','stadium','opp_active','you_active','you_prizes','you_bench','you_deck','you_discard'}) do
    local z=Z[name];if z and z.well and not z.tiny then well(z.well.x,z.well.y,z.well.w,z.well.h,name:sub(1,4)=='opp_' and 'opponent' or name:sub(1,4)=='you_' and 'you' or 'global') end
  end
  -- Drop target glow (the UIElement focus outline) while dragging.
  if self.drag and self.drag.moved and self.dropZone and self.dropZone.well then
    local w=self.dropZone.well
    g.setLineWidth(2.5);Button.outline(w.x-2,w.y-2,w.w+4,w.h+4,T.white,1.2)
    g.setColor(1,1,1,0.08);Button.panel(w.x,w.y,w.w,w.h,{1,1,1,0.08},1.2)
  end
  for _,p in ipairs(self.piles) do p:draw() end
  self:drawPrizes('opponent',rw);self:drawPrizes('you',rw)
  for _,c in ipairs(self.ghosts) do c:draw(shaders,self.time,self.mx or 0,self.my or 0,self.reduced,rw) end
  local hideHand=false
  local order={'opponent_hand','opponent_discard','opponent_bench','opponent_active','global_stadium','you_discard','you_bench','you_active','you_prize','opponent_prize','you_hand'}
  for _,zoneKey in ipairs(order) do
    for _,c in ipairs(self.cards) do
      if c.zoneKey==zoneKey and not c.dragging and not (c==self.hoverCard and c.item.zone=='hand') and not (zoneKey=='you_hand' and hideHand) then self:drawCard(c,shaders,rw) end
    end
  end
  if self.hoverCard and self.hoverCard.item.zone=='hand' and not self.hoverCard.dragging and not hideHand then self:drawCard(self.hoverCard,shaders,rw) end
  if self.drag and self.drag.moved then
    -- Attached cards ride along under the dragged Pokémon.
    self:drawAttached(self.drag.card)
    self.drag.card:draw(shaders,self.time,self.mx,self.my,self.reduced,rw)
  end
  -- HUD.
  self.hud:draw(self,L,self.time,self.reduced,self.hover)
  -- Targeting banner.
  local tg=self.targeting and self.targeting.menu or self.luaTargeting
  if tg then
    local p=(self.targeting or self.luaTargeting).panel
    if p then
      Button.panel(p.x,p.y+4,p.w,p.h,{T.panel[1]*0.7,T.panel[2]*0.7,T.panel[3]*0.7,1},2.4)
      Button.panel(p.x,p.y,p.w,p.h,{55/255,66/255,68/255,0.92},2.4)
      Dyna.static(tg.title or '',0.5,p.x+12,p.y+8,p.w-24,28,T.white,{roomWidth=rw,fit=true})
      if tg.note and tg.note~='' then Dyna.static(select(1,Dyna.wrap(tg.note,0.28,p.w-24))[1] or '',0.28,p.x+12,p.y+40,p.w-24,16,JOKER_GREY,{roomWidth=rw,fit=true,shadow=false})
      else Dyna.static('Click a highlighted card',0.28,p.x+12,p.y+40,p.w-24,16,JOKER_GREY,{roomWidth=rw,shadow=false}) end
    end
  end
  -- Controls.
  for i,b in ipairs(self.controls) do
    if not b.invisible then
      local active=not self.overlay and (self.hover==i or self.focus==i)
      if b.lines then
        local label=b.label;b.displayLabel=' '
        Button.draw(b,active and not b.disabled,self.pressed==i and self.hover==i,self.focus==i,rw)
        b.displayLabel=nil;b.label=label
        local n=#b.lines
        for k,line in ipairs(b.lines) do Dyna.static(line,k==1 and 0.46 or 0.38,b.x,b.y+b.h/2+(k-(n+1)/2)*24-11,b.w,22,T.white,{roomWidth=rw}) end
      elseif (b.cost and #b.cost>0) or (b.damage and b.damage~='') then
        -- Attack rows: cost pips at the left, name, printed damage at the right.
        local label=b.label;b.displayLabel=' '
        Button.draw(b,active and not b.disabled,self.pressed==i and self.hover==i,self.focus==i,rw)
        b.displayLabel=nil;b.label=label
        local pipW=0
        if b.cost and #b.cost>0 then pipW=Energy.row(b.cost,b.x+8,b.y+b.h/2,8,3,b.disabled and 0.5 or 1,"left")+8 end
        local dmgW=(b.damage and b.damage~='') and Dyna.measure(b.damage,0.42)+8 or 0
        if dmgW>0 then Dyna.static(b.damage,0.42,b.x+b.w-6-dmgW,b.y,dmgW,b.h,T.white,{align='right',roomWidth=rw}) end
        Dyna.static(label,0.38,b.x+8+pipW,b.y,b.w-16-pipW-dmgW,b.h,T.white,{align='left',fit=true,roomWidth=rw})
      else
        Button.draw(b,active and not b.disabled,self.pressed==i and self.hover==i,self.focus==i,rw)
      end
      if b.selected then g.setLineWidth(1.5);Button.outline(b.x-2,b.y-2,b.w+4,b.h+4,T.white,1.2) end
    end
  end
  -- Hover popup.
  if self.popup and self.popupBox and not self.overlay then
    local c=self.popup
    local box=self.popupBox
    local ch=190*c.baseScale*c.motion.VT.scale
    local below=c.y<0.8*165 or (c.item.owner=='opponent' and c.item.zone=='hand')
    local px=c.x-box.w/2
    px=math.max(L.table.x+4,math.min(self.boardW-box.w-4,px))
    local py=below and c.y+ch/2+10 or c.y-ch/2-(c.lift or 0)-box.h-10
    if py<4 then py=c.y+ch/2+10 end
    if py+box.h>self.boardH-4 then py=self.boardH-4-box.h end
    box.draw(px,py)
  end
  self.fx:draw(rw)
  if self.overlay and not self.peek then
    Modal.backdrop(self.boardW,self.boardH)
    self.overlay:draw(shaders)
  end
  g.pop()
end
return Simulator
