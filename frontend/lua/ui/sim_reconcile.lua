local D=require('ui.card_dimensions')
-- Reconciling a snapshot onto the table (audit SM14), mixed into ui/simulator.lua's Simulator:
-- reading the host's mailbox snapshot, copying it onto the table, laying out every card so cards
-- keep their motion across snapshots (with ghosts for the ones that left), the piles, and the
-- host's menus as overlays or HUD instructions.
local T=require('ui.theme')
local Card=require('ui.card')
local Pile=require('ui.deck_pile')
local Codec=require('ui.codec')
local Layout=require('ui.sim_layout')
local Overlay=require('ui.sim_overlay')
local Model=require('ui.sim_model')
local Ko=require('ui.sim_ko')
local Simulator={}
local STATUS_ROTATION={asleep=-math.pi/2,paralyzed=math.pi/2,confused=math.pi}
local prefix=Layout.prefix
function Simulator:newCard(item,index,x,y,scale,texture)
  item.edition='dissolve';item.resolution=2
  item.drawFace=function(w,h) self:face(item,w,h) end
  local c=Card.new(item,index,nil,texture);c:place(x,y,scale,false)
  c.motion.T.r=0;c.motion.VT.r=0
  return c
end
function Simulator:sync(raw,finishKo)
  if not raw then return end
  if self.wipeRaw then self.wipeRaw=raw;return end
  local pending=self.koPresentation
  if (pending and raw==pending.raw) or (not pending and raw==self.raw) then return end
  local m=Model.parse(raw);if not m then return end
  self:speak(m)
  -- A same-deck restart is a fresh table, even though card UIDs are reused.
  if m.matchId and m.matchId~='' then
    if self.matchId and self.matchId~=m.matchId then
      if self.callbacks.transition then
        local accepted=self.callbacks.transition(function()
          local latest=self.wipeRaw
          if not latest then return end
          self:open(self.reduced,true)
          self:sync(latest)
        end)
        if accepted then self.wipeRaw=raw;return end
      end
      self:open(self.reduced,true)
    end
    self.matchId=m.matchId
  end
  if self.koPresentation then
    if not self.koPresentation:returned(m) then self.koPresentation:retarget(raw,m);return end
    -- Undo or reload restores the old table and cancels every queued burn.
    self:cancelKoPresentation();self.raw=nil
  end
  if raw==self.raw then return end
  self.completedCounterTransfer=self.counterMotion and self.counterMotion.sent and self.counterMotion.cards or nil
  self.counterMotion=nil
  -- Reduced motion skips the burn but still names each knocked-out Pokémon
  -- where it stood. Its spot is kept by owner and zone, so after a hot-seat
  -- flip the notice lands on the victim's side of the new layout.
  local reducedKos
  if finishKo~=true and self.reduced and self.phase=='ready' then
    reducedKos={}
    for _,c in ipairs(Ko.victims(m,self.cards)) do
      local zone=self.L and self.L.zones[prefix(c.item.owner)..c.item.zone]
      reducedKos[#reducedKos+1]={name=c.item.name,owner=c.item.owner,zone=c.item.zone,dx=zone and (c.x-zone.x)/zone.scale or 0,x=c.x,y=c.y-0.6*D.H*c.baseScale}
    end
  end
  -- love.filesystem.read also returns the byte count; only our explicit
  -- boolean completion flag may bypass the presentation queue.
  if finishKo~=true and not self.reduced and self.phase=='ready' then
    local cards=Ko.victims(m,self.cards)
    if #cards>0 then
      if self.drag then self.drag.card.dragging=false;self.drag=nil end
      if self.overlay then self.overlay:release();self.overlay=nil end
      self.highlight=nil;self.hoverCard=nil;self.focusCard=nil;self.popup=nil;self.targeting=nil;self.luaTargeting=nil
      self.fx:clear()
      self.koPresentation=Ko.begin(self,raw,m,cards)
      return
    end
  end
  self.raw=raw
  local previous={items=self.items,sides=self.sides,turn=self.turn,viewerSeat=self.viewerSeat,outcome=self.outcome,phase=self.phase,activePlayer=self.activePlayer,menuId=self.menuId,revision=self.revision,message=self.message,messageSerial=self.messageSerial,gamePhase=self.gamePhase,rareCandy=self.rareCandy}
  self:apply(m)
  local menu=self.menu
  if previous.rareCandy and not self.rareCandy then self.luaTargeting=nil end
  self.menuId=menu and menu.id or nil
  if self.drag then self.drag.card.dragging=false;self.drag=nil end
  self.highlight=nil;self.hoverCard=nil
  self:placeCards(false,previous)
  self:react(previous)
  local flipped=previous.viewerSeat~='' and previous.viewerSeat~=self.viewerSeat
  for _,ko in ipairs(reducedKos or {}) do
    local owner=ko.owner
    if flipped then owner=owner=='you' and 'opponent' or 'you' end
    local zone=self.L and self.L.zones[prefix(owner)..ko.zone]
    if zone then ko.x,ko.y=zone.x+ko.dx*zone.scale,zone.y-0.6*D.H*zone.scale end
    self.fx:attention({text='KNOCKED OUT: '..ko.name,scale=0.6,colour=T.white,backdrop=T.red,x=ko.x,y=ko.y,hold=1.2,maxw=self.L and self.L.table.w-40})
  end
  self.completedCounterTransfer=nil
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
  if self.overlay and self.overlay.kind=='gameover' and self.mode=='online' then self.overlay:build() end
  self:syncAway(m.away or {name='',ms=''})
end
-- One announcement per snapshot read, before a Knock Out or a page wipe can hold
-- it back: a refusal whose serial moved, then what the host says changed.
function Simulator:speak(m)
  local parts={}
  if m.messageSerial~=self.spokenSerial then
    self.spokenSerial=m.messageSerial
    if m.message~='' then parts[#parts+1]=m.message end
  end
  if m.announce~=self.spokenAnnounce then
    self.spokenAnnounce=m.announce
    if m.announce~='' then parts[#parts+1]=m.announce end
  end
  if #parts>0 then self.callbacks.announce(table.concat(parts,' ')) end
end
-- Copy a parsed snapshot onto the table. Card text accumulates across
-- snapshots; mode and flags keep their values unless the snapshot has an L row.
function Simulator:apply(m)
  self.revision=m.revision
  self.phase,self.you,self.opponent=m.phase,m.you,m.opponent
  self.turn,self.gamePhase,self.message,self.title,self.hint=m.turn,m.gamePhase,m.message,m.title,m.hint
  self.turnIndex,self.turnCount=m.turnIndex,m.turnCount
  self.waiting,self.activePlayer,self.viewerSeat=m.waiting,m.activePlayer,m.viewerSeat
  self.allow=m.allow
  self.outcome,self.outcomeDetail=m.outcome,m.outcomeDetail
  self.messageSerial,self.warning=m.messageSerial,m.warning
  self.shuffled=m.shuffled
  self.items,self.sides,self.actions,self.cardActions=m.items,m.sides,m.actions,m.cardActions
  self.rareCandy,self.menu=m.rareCandy,m.menu
  self.info=self.info or {}
  for cardId,info in pairs(m.info) do self.info[cardId]=info end
  if m.mode then self.mode=m.mode end
  if m.flags then self.flags=m.flags end
  -- An online action is in flight: nothing more is sent until the server answers it.
  if self.flags.pending then
    self.pendingSince=self.pendingSince or self.time
    for _,a in ipairs(self.actions) do a.disabled=true end
    for _,list in pairs(self.cardActions) do for _,a in ipairs(list) do a.disabled=true end end
  else self.pendingSince=nil end
  -- A refused rematch comes back as a message with the sent flag gone: Rematch is live again.
  -- So does a seat lost on reconnect (a signed-out account), which takes Rematch away.
  if self.rematchSent and m.flags and not m.flags['rematch-sent'] and (m.message~='' or not m.flags.rematch) then self.rematchSent=nil end
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
    table.sort(list,function(a,b) return a.displayIndex<b.displayIndex end)
    benchX[owner]=Layout.benchPositions(zone,list)
  end
  if previous and previous.items then for _,it in ipairs(previous.items) do prevByUid[it.owner..':'..it.id]=it end end
  -- Where a card attached to a Pokémon was last seen: under that Pokémon.
  -- Discarded attachments and attachments returned to hand (including undo)
  -- start their slide at the Pokémon that carried them.
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
  local nowById={}
  for _,it in ipairs(self.items) do
    nowByUid[it.owner..':'..it.id]=it
    if not it.hidden then nowById[it.id]=it end
  end
  -- Undo/recovery can arrive while a discard is still flying. Return that
  -- same card from its visible position instead of leaving a duplicate ghost.
  for i=#self.ghosts,1,-1 do
    local c=self.ghosts[i]
    if c.ghost.target then
      local item=nowById[c.item.id]
      if not item or item.zone~='discard' then
        table.remove(self.ghosts,i);c.ghost=nil
        c.dissolve=nil;c.burn1=nil;c.burn2=nil;c.disintegration=nil;c.motion.juice=nil
        local key=item and (item.owner..':'..item.id)
        if key and not old[key] then old[key]=c else c.texture:release() end
      elseif item then
        c.item=item;c.ghost.target=L.zones[prefix(item.owner)..'discard']
      end
    end
  end
  local playedFrom={}
  for _,c in pairs(old) do if c.item.zone=='played' then playedFrom[c.item.id]=c end end
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
  -- place, with no entrance slide and no ghosts. A public card keeps its uid
  -- under the mirrored owner, and the face it painted when that face is
  -- unchanged; hidden cards are positional, so they are always repainted.
  local flipped=previous and previous.viewerSeat and previous.viewerSeat~='' and previous.viewerSeat~=self.viewerSeat
  -- The first snapshot of a (re)loaded game has nothing to diff against: cards
  -- in play and piles simply appear; only the hand is dealt in from the deck.
  local fresh=not previous or previous.phase~='ready'
  -- KO cards have already burned on the old table. Consume their final
  -- discard rows without creating a second departure animation.
  local dissolving=self.completedKOs or {}
  local function takeOldCard(item)
    local owner=item.owner
    if flipped and not item.hidden and owner~='global' then owner=owner=='you' and 'opponent' or 'you' end
    local key=owner..':'..item.id
    local c=old[key]
    -- Stadiums keep their UID but change from a player's hand to the shared
    -- board owner. Reuse the visible card on play, replacement and undo.
    if not c and not item.hidden then
      for _,owner in ipairs({'global','you','opponent'}) do
        local candidateKey=owner..':'..item.id
        local candidate=old[candidateKey]
        if candidate and not candidate.item.hidden and (item.zone=='stadium' or candidate.item.zone=='stadium') then
          key,c=candidateKey,candidate;break
        end
      end
    end
    old[key]=nil
    return c
  end
  for i,item in ipairs(self.items) do
    item.edition='dissolve';item.resolution=2;item.drawFace=function(w,h) self:face(item,w,h) end
    local zone=(item.zone=='played' and L.zones.played) or L.zones[prefix(item.owner)..(item.zone=='prize' and 'prizes' or item.zone)] or L.zones.playmat
    if item.zone=='discard' then
      -- Cost discards slide straight in; staged Trainers clear instantly at
      -- turn end, including when hot-seat swaps the owners.
      local prev=prevByUid[item.owner..':'..item.id]
      local staged=playedFrom[item.id]
      local c=takeOldCard(item) or staged
      if c then old[c.item.owner..':'..c.item.id]=nil end
      if not staged and not dissolving[item.id] and not fresh and previous.items and not resize and not flipped and not self.reduced and (not prev or prev.zone~='discard') then
        if not c then
          local from=attachedFrom[item.owner..':'..item.id] or L.zones[prefix(item.owner)..'hand']
          c=self:newCard(item,i,from.x,from.y,zone.scale)
        end
        c.item=item;c.dragging=false;c.lift=0
        c.ghost={start=self.time,target=zone}
        self.ghosts[#self.ghosts+1]=c
      elseif c then c.texture:release()
      end
    elseif not (item.zone=='hand' and zone.hidden) then
      local n=counts[item.owner..item.zone] or 1
      local x,y,rotation=zone.x,zone.y,0
      local scale=zone.scale or 0.6
      if item.zone=='hand' then
        x,y,rotation=Layout.hand(zone,n,item.displayIndex)
        if item.owner=='opponent' then rotation=-rotation;y=zone.y-(y-zone.y) end
      elseif item.zone=='bench' then x,y=(benchX[item.owner] or {})[item.index] or Layout.bench(zone,n,item.index),zone.y
      elseif item.zone=='prize' then x,y=Layout.prize(zone,item.index)
      elseif item.zone=='played' then x,y=Layout.played(zone,n,item.index)
      end
      local key=item.owner..':'..item.id
      local c=takeOldCard(item)
      if c and (c.item.cardId~=item.cardId or c.item.hidden~=item.hidden or (flipped and item.hidden)) then c.texture:release();c=nil end
      local painted
      -- Mirrored by a flip: a new card on its new side, with the same face.
      if c and flipped and c.item.owner~=item.owner then painted=c.texture;c=nil end
      if not flipped and (item.zone=='active' or item.zone=='bench') and not item.hidden then
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
            c.item=item;c.index=i;c:rebuild()
          end
        end
      end
      if not c then
        c=self:newCard(item,i,x,y,scale,painted)
        local prev=prevByUid[key]
        if not self.reduced and previous and previous.items and not resize and not flipped and (not fresh or item.zone=='hand') then
          -- A card entering the table starts where it came from.
          local from
          if item.zone=='hand' then
            if not (self.completedPrizes and youPrizesTaken and item.owner=='you') then
              from=attachedFrom[key] or (youPrizesTaken and item.owner=='you' and L.zones.you_prizes or L.zones[prefix(item.owner)..'deck'])
            end
          elseif item.zone=='discard' then from=prev and L.zones[prefix(item.owner)..prev.zone] or L.zones[prefix(item.owner)..'hand']
          elseif item.zone=='played' then from=L.zones[prefix(item.owner)..'hand']
          elseif (item.zone=='active' or item.zone=='bench') and occupied[item.owner..':'..item.zone..':'..item.index] then
            -- A Pokémon reappearing on an occupied spot (an undone evolution
            -- putting the Basic back) was there all along: no entrance.
            from=nil
          elseif item.owner=='opponent' then from=L.zones.opp_hand
          else from=L.zones.you_deck end
          if from then c.motion.VT.x=from.x/c.unit;c.motion.VT.y=from.y/c.unit;c.x,c.y=from.x,from.y end
        end
      else
        c.item=item
        if resize or math.abs(c.baseScale-scale)>0.001 then
          local px,py=c.x,c.y;c:place(x,y,scale,false);c.motion.VT.x=px/c.unit;c.motion.VT.y=py/c.unit;c.x,c.y=px,py
        else c.homeX,c.homeY=x,y end
      end
      c.baseY=y;c.baseRotation=rotation
      if c.drawAfterPromotion and (resize or flipped or item.zone~='hand' or c.drawAfterPromotion.turn~=self.turn) then c.drawAfterPromotion=nil end
      c.fan=item.zone=='hand' and (item.displayIndex-(n-1)/2)/n or nil
      c.lift=0;c.dragging=false
      local statusRotation=0
      for _,s in ipairs(Codec.list(item.status)) do statusRotation=STATUS_ROTATION[s] or statusRotation end
      c.statusRotation=statusRotation
      c.motion.T.r=rotation+statusRotation
      c.zoneKey=item.owner..'_'..item.zone
      self.cards[#self.cards+1]=c
      self.byUid[key]=c
    end
  end
  -- Other cards that left the table slide to their owner's discard pile.
  for key,c in pairs(old) do
    local item=c.item
    if not dissolving[item.id] and not resize and not flipped and previous and previous.items and not self.reduced and item.zone~='hand' and item.zone~='prize' and item.zone~='discard' and item.zone~='played' and not item.hidden then
      local target=L.zones[(item.owner=='global' and 'you_' or prefix(item.owner))..'discard']
      c.ghost={start=self.time,target=target}
      c.dragging=false;c.lift=0
      self.ghosts[#self.ghosts+1]=c
    else c.texture:release() end
  end
  -- The promotion and next-turn draw can arrive in the same snapshot. Keep
  -- the new card at the deck until the replacement has landed, then pause.
  if not resize and not flipped and not self.reduced and previous and previous.gamePhase=='ko:promote' and self.turn>previous.turn then
    local promoted
    for _,c in ipairs(self.cards) do
      local was=prevByUid[c.item.owner..':'..c.item.id]
      if c.item.zone=='active' and was and was.zone=='bench' then promoted=c;break end
    end
    if promoted then
      for _,c in ipairs(self.cards) do
        local owner=c.item.owner
        local was=previous.sides and previous.sides[owner]
        if c.item.zone=='hand' and not prevByUid[owner..':'..c.item.id] and was and self.sides[owner].deck<was.deck then
          local deck=L.zones[prefix(owner)..'deck']
          c.motion.VT.x=deck.x/c.unit;c.motion.VT.y=deck.y/c.unit;c.x,c.y=deck.x,deck.y
          c.drawAfterPromotion={card=promoted,turn=self.turn}
        end
      end
    end
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
  for _,p in ipairs(self.piles) do
    if flipped then
      p.owner=p.owner=='you' and 'opponent' or 'you';p.item.owner=p.owner
      local zone=L.zones[prefix(p.owner)..p.item.kind]
      p:place(zone.x,zone.y,zone.scale,false,self.boardW)
    end
    oldPiles[p.owner..':'..p.item.kind]=p
  end
  self.piles={};self.pendingPiles=self.pendingPiles or {}
  local landing={}
  for _,c in ipairs(self.ghosts) do
    if c.ghost and c.ghost.target then
      landing[(c.item.owner=='global' and 'you' or c.item.owner)]=true
    end
  end
  -- A pile whose face would paint the same pixels keeps its canvas and only
  -- takes the new count. A resize has emptied every canvas, so it rebuilds.
  local function pile(old,item,zone,top)
    local key=self:pileFace(item.kind,item.owner,top)
    local p=old
    if p and p.faceKey==key and not resize then p.item=item
    else p=Pile.new(item,1);p.faceKey=key end
    p:place(zone.x,zone.y,zone.scale,false,self.boardW);p.owner=item.owner;p.topItem=top
    return p,p==old
  end
  for _,owner in ipairs({'opponent','you'}) do
    local side=self.sides[owner]
    local zone=L.zones[prefix(owner)..'deck']
    if side and zone then
      local item={id=owner..'deck',owner=owner,kind='deck',count=side.deck,name='Deck',drawFace=function(w,h) self:drawBack(owner,w,h) end}
      local p,kept=pile(oldPiles[owner..':deck'],item,zone)
      if kept then oldPiles[owner..':deck']=nil end
      self.piles[#self.piles+1]=p
    end
    local dzone=L.zones[prefix(owner)..'discard']
    local top
    for _,it in ipairs(self.items) do if it.owner==owner and it.zone=='discard' then top=it end end
    if side and dzone and top then
      local item={id=owner..'discard',owner=owner,kind='discard',count=math.max(1,side.discard),name='Discard',drawFace=function(w,h) self:face(top,w,h) end}
      if landing[owner] and not resize then
        local pending=self.pendingPiles[owner]
        local p,kept=pile(pending,item,dzone,top)
        if pending and not kept then pending.texture:release() end
        self.pendingPiles[owner]=p
        local keep=oldPiles[owner..':discard']
        if keep then self.piles[#self.piles+1]=keep;oldPiles[owner..':discard']=nil end
      else
        local p,kept=pile(oldPiles[owner..':discard'],item,dzone,top)
        if kept then oldPiles[owner..':discard']=nil end
        self.piles[#self.piles+1]=p
        if self.pendingPiles[owner] then self.pendingPiles[owner].texture:release();self.pendingPiles[owner]=nil end
      end
    elseif self.pendingPiles[owner] then
      self.pendingPiles[owner].texture:release();self.pendingPiles[owner]=nil
    end
  end
  for _,p in pairs(oldPiles) do p.texture:release() end
  self:sortRows()
end
-- What a pile's canvas shows: the owner's card back, or the discard's top
-- card with its scan.
function Simulator:pileFace(kind,owner,top)
  if kind=='deck' then
    local seat=self.viewerSeat
    if owner=='opponent' then seat=seat=='p1' and 'p2' or 'p1' end
    return 'deck:'..seat
  end
  return 'discard:'..top.cardId..':'..tostring(top.hidden)..':'..tostring(self.art[top.cardId])
end
function Simulator:sortRows()
  table.sort(self.cards,function(a,b)
    if a.zoneKey==b.zoneKey then return a.item.displayIndex<b.item.displayIndex end
    return a.zoneKey<b.zoneKey
  end)
end
-- Menus from the host become overlays, or (for board targets and prizes)
-- instructions in the HUD while the table stays clickable.
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
  if menu.kind=='pile' and (menu.title or '')=='' then menu.title=self:pileTitle(#menu.options) end
  if self.overlay and self.overlay.data and self.overlay.data.id==menu.id and self.overlay.kind==menu.kind then self.overlay:refresh(menu);return end
  if self.overlay then self.overlay:release() end
  self.overlay=Overlay.new(self,menu.kind,menu)
  if self.callbacks.jiggle then self.callbacks.jiggle(1) end
end
return Simulator
