local D=require('ui.card_dimensions')
-- The sandbox table, built like Balatro's run screen: the HUD column on the
-- left, transparent CardArea wells on the felt, the hand fanned along the
-- bottom edge, the deck at the bottom right, hover popups, click-to-highlight
-- cards with attached action buttons, drag-and-drop plays, attention-text
-- juice for damage and prizes, and generic-options overlays for prompts.
-- The browser host (LuaSimulator) owns the rules; Lua owns everything seen.
local T=require('ui.theme')
local Controls=require('ui.controls')
local Button=require('ui.button')
local Card=require('ui.card')
local CardFrame=require('ui.card_frame')
local Motion=require('ui.motion')
local Pile=require('ui.deck_pile')
local CardBack=require('ui.card_back')
local Codec=require('ui.codec')
local Mailbox=require('ui.mailbox')
local Modal=require('ui.modal')
local Dyna=require('ui.dynatext')
local Energy=require('ui.energy')
local Layout=require('ui.sim_layout')
local Screen=require('ui.screen')
local Hud=require('ui.sim_hud')
local Overlay=require('ui.sim_overlay')
local Fx=require('ui.sim_fx')
local Model=require('ui.sim_model')
local Ko=require('ui.sim_ko')
local Popup=require('ui.popup')
local Simulator={};Simulator.__index=Simulator
local g=love.graphics
local STATUS_ROTATION={asleep=-math.pi/2,paralyzed=math.pi/2,confused=math.pi}
local prefix=Layout.prefix
function Simulator.new(callbacks)
  local self=setmetatable({callbacks=callbacks,phase='empty',items={},sides={},info={},actions={},cardActions={},cards={},byUid={},ghosts={},piles={},art={},controls={},time=0,focus=0,hover=0,
    message='',title='',hint='',outcome='',outcomeDetail='',gamePhase='',turn=0,turnIndex=0,turnCount=0,waiting='',activePlayer='',viewerSeat='',allow={},
    mode='local',code='',flags={}},Simulator)
  self.hud=Hud.new({feedback=callbacks.sourceFeedback or callbacks.feedback,jiggle=callbacks.jiggle})
  self.fx=Fx.new({feedback=function(name,pitch) callbacks.feedback(name,pitch) end,jiggle=function(amount) if callbacks.jiggle then callbacks.jiggle(amount) end end})
  return self
end
function Simulator:command(...)
  Codec.command(self.callbacks.command,...)
end
-- `mode` 'online' binds the lobby's live match for `code`; an internal reopen
-- (skipCommand, a new matchId) keeps the table's mode.
function Simulator:open(reduced,skipCommand,mode,code)
  if not skipCommand then self.mode,self.code=mode or 'local',code or '' end
  self.flags={};self.allow={};self.away=nil;self.rematchSent=nil
  self.wipeRaw=nil
  self:cancelKoPresentation()
  self.attachedPopup=nil;self.closingPopup=nil
  self.prizeMotion={}
  self.rareCandy=nil
  self.counterMotion=nil;self.completedCounterTransfer=nil
  self.reduced=reduced;self.drag=nil;self.focus=0;self.raw=nil;self.previous=nil;self.highlight=nil;self.hoverCard=nil;self.targeting=nil;self.luaTargeting=nil
  if self.overlay then self.overlay:release();self.overlay=nil end
  -- Forget the last game so a reopened page never diffs against it.
  for _,c in ipairs(self.cards) do c.texture:release() end
  for _,c in ipairs(self.ghosts) do c.texture:release() end
  for _,p in pairs(self.pendingPiles or {}) do p.texture:release() end;self.pendingPiles={}
  self.cards={};self.byUid={};self.ghosts={};self.items={};self.sides={};self.actions={};self.cardActions={}
  self.phase='empty';self.viewerSeat='';self.outcome='';self.menu=nil;self.menuId=nil;self.message='';self.turn=0
  self.matchId=nil;self.shuffleAt=nil
  self.fx:clear();self.fx:background('setup',true)
  self.hud:cancelEntrance()
  if skipCommand then return end
  if self.mode=='online' then self:command('open','online',self.code) else self:command('open') end
end
function Simulator:layout(w,h,viewportUnit)
  self.attachedPopup=nil;self.closingPopup=nil
  self.width,self.height=w,h
  self.portrait=w<600
  self.L=Layout.for_size(w,h)
  self.boardW,self.boardH=self.L.w,self.L.h
  self.zoom=math.min(w/self.boardW,h/self.boardH)
  self.viewportUnit=(viewportUnit or Screen.unit(w,h))/self.zoom
  self.ox,self.oy=(w-self.boardW*self.zoom)/2,(h-self.boardH*self.zoom)/2
  self.drag=nil;self.highlight=nil;self.hoverCard=nil
  -- A browser resize goes through love.window.setMode, which empties every
  -- Canvas in love.js; card faces are canvases, so repaint them.
  CardFrame.open()
  for _,c in ipairs(self.cards) do c:rebuild() end
  for _,c in ipairs(self.ghosts) do c:rebuild() end
  for _,c in pairs(self.attached or {}) do c:rebuild() end
  self:placeCards(true)
  if self.koPresentation then self.koPresentation:layout() end
  if self.overlay then self.overlay:layout() end
  CardFrame.close()
  self:build()
end
function Simulator:point(x,y) return (x-self.ox)/self.zoom,(y-self.oy)/self.zoom end
-- Card faces: the scan when the browser cache has it, otherwise a pixel
-- placeholder in the card's type colour; hidden cards use the Balatro back.
function Simulator:drawBack(owner,w,h)
  local seat=self.viewerSeat
  if owner=='opponent' then seat=seat=='p1' and 'p2' or 'p1' end
  CardBack.draw(seat=='p1' and 'blue' or 'red',w,h)
end
function Simulator:face(item,w,h)
  if item.hidden or item.cardId=='' or item.cardId=='hidden' then self:drawBack(item.owner,w,h);return end
  CardFrame.draw(w,h,function(aw,ah) self:artwork(item,aw,ah) end,
    CardFrame.border(self.art[item.cardId],T.ink))
end
function Simulator:artwork(item,w,h)
  if CardFrame.scan(self.art[item.cardId],w,h) then return end
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
function Simulator:cancelKoPresentation()
  if not self.koPresentation then return end
  self.koPresentation:cancel()
  self.koPresentation=nil
  self.fx:clear()
end
function Simulator:koPrizeTaken(owner,index)
  return self.koPresentation and self.koPresentation:prizeTaken(owner,index)
end
function Simulator:koPrizePosition(owner,index)
  return self.koPresentation:prizePosition(owner,index)
end
function Simulator:updateKoPresentation(dt,time,reduced)
  local ko=self.koPresentation
  if not ko or not ko:update(dt,time,reduced) then return end
  local completed=ko:completed()
  self:cancelKoPresentation()
  self.completedKOs=completed
  self.completedPrizes=ko.prizes
  self:sync(ko.raw,true)
  self.completedKOs=nil
  self.completedPrizes=nil
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
-- boss_warning_text: two floating DynaTexts over the table while the opponent
-- is disconnected. The forfeit clock counts down from receipt, so presence
-- never needs per-second snapshots (each would invalidate click tokens).
function Simulator.clock(seconds)
  seconds=math.max(0,math.ceil(seconds))
  return string.format('%d:%02d',math.floor(seconds/60),seconds%60)
end
function Simulator:awayDetail()
  local a=self.away
  if not a.deadline then return 'Waiting for them to reconnect...' end
  local left=a.deadline-self.time
  return left>0 and 'Forfeits in '..Simulator.clock(left) or 'Forfeiting...'
end
function Simulator:syncAway(row)
  local a=self.away
  if row.name=='' or self.outcome~='' then
    if a and not a.leaving then
      a.leaving=true;a.title:pop_out(3,self.time);a.detail:pop_out(3,self.time)
      if self.outcome=='' then
        self.fx:attention({text=a.name..' is back',scale=0.6,colour=T.white,backdrop=T.blue,x=self.L and self.L.banner.x or 0,y=self.L and self.L.banner.y or 0,hold=0.9,sound='highlight1'})
        self.callbacks.announce(a.name..' is back')
      end
    end
    return
  end
  local ms=tonumber(row.ms)
  local deadline=ms and ms>=0 and self.time+ms/1000 or nil
  if a and not a.leaving then
    if a.name~=row.name then a.name=row.name;a.title:set(row.name..' disconnected',self.time) end
    a.deadline=deadline;a.detail:set(self:awayDetail(),self.time)
    return
  end
  local function text(s,scale) return Dyna.new({string=s,scale=scale,colours={T.white},float=true,shadow=true,pop_in=0,pop_in_rate=6,time=self.time,maxw=self.L and self.L.table.w-40}) end
  a={name=row.name,deadline=deadline};self.away=a
  a.title=text(row.name..' disconnected',0.7);a.detail=text(self:awayDetail(),0.6)
  -- Later ticks swap the clock's letters in place instead of popping it again.
  a.detail.cfg.pop_in=nil
  local feedback=self.callbacks.sourceFeedback or self.callbacks.feedback
  feedback('chips1',0.55+love.math.random()*0.1,0.12)
  self.callbacks.announce(a.name..' disconnected. '..a.detail.string)
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
  -- place, with no entrance slide and no ghosts.
  local flipped=previous and previous.viewerSeat and previous.viewerSeat~='' and previous.viewerSeat~=self.viewerSeat
  -- The first snapshot of a (re)loaded game has nothing to diff against: cards
  -- in play and piles simply appear; only the hand is dealt in from the deck.
  local fresh=not previous or previous.phase~='ready'
  -- KO cards have already burned on the old table. Consume their final
  -- discard rows without creating a second departure animation.
  local dissolving=self.completedKOs or {}
  local function takeOldCard(item)
    local key=item.owner..':'..item.id
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
function Simulator:rowCards(card)
  local row={}
  for _,c in ipairs(self.cards) do
    if c.item.owner==card.item.owner and c.item.zone==card.item.zone then row[#row+1]=c end
  end
  table.sort(row,function(a,b) return a.item.displayIndex<b.item.displayIndex end)
  return row
end
function Simulator:alignRow(row)
  if #row==0 then return end
  local kind=row[1].item.zone
  local zone=self.L.zones[prefix(row[1].item.owner)..kind]
  local items={}
  for i,c in ipairs(row) do c.item.displayIndex=i-1;items[i]=c.item end
  local positions=kind=='bench' and Layout.benchPositions(zone,items)
  for i,c in ipairs(row) do
    local x,y,r
    if kind=='hand' then x,y,r=Layout.hand(zone,#row,i-1)
    else x,y,r=positions[c.item.index],zone.y,0 end
    c.homeX,c.homeY,c.baseY,c.baseRotation=x,y,y,r
    c.motion.T.r=r+(c.statusRotation or 0)
    c.fan=kind=='hand' and (i-1-(#row-1)/2)/#row or nil
  end
  self:sortRows()
end
function Simulator:overOwnRow(card,x,y)
  local item=card.item
  if item.owner~='you' or item.hidden then return false end
  -- Classify the held card's centre, not the grabbed edge. Highlighted cards
  -- lift above the row, so their top edge can overlap a playable board zone.
  if self.drag and self.drag.card==card then x,y=x-self.drag.dx,y-self.drag.dy end
  if item.zone=='hand' then
    local zone=self.L.zones.you_hand
    return x>=self.L.table.x and x<=self.boardW and y>=zone.y-D.HALF_H*zone.scale-18 and y<=self.boardH+30
  elseif item.zone=='bench' then
    local well=self.L.zones.you_bench.well
    return x>=well.x-30 and x<=well.x+well.w+30 and y>=well.y-12 and y<=well.y+well.h+12
  end
  return false
end
function Simulator:updateReorder(x,y)
  local d=self.drag
  if not d.originalRow then return end
  if not self:overOwnRow(d.card,x,y) then
    if d.reordering then self:alignRow(d.originalRow);d.reordering=false end
    return
  end
  d.reordering=true
  local row=self:rowCards(d.card)
  local at=d.card.item.displayIndex+1
  local center=x-d.dx
  -- CardArea:align_cards sorts by target centres, not the trailing visible
  -- positions: neighbors move aside as soon as the held card crosses them.
  while at>1 and center<row[at-1].homeX do row[at],row[at-1]=row[at-1],row[at];at=at-1 end
  while at<#row and center>row[at+1].homeX do row[at],row[at+1]=row[at+1],row[at];at=at+1 end
  self:alignRow(row)
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
  -- The game-over panel shows the message itself; the banner would sit behind it.
  local gameOver=self.overlay and self.overlay.kind=='gameover'
  if self.message~='' and not gameOver and self.messageSerial~=previous.messageSerial then
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
    local transferred=self.completedCounterTransfer and self.completedCounterTransfer[item.id]
    if c and was and (item.zone=='active' or item.zone=='bench') and (was.zone=='active' or was.zone=='bench') then
      if item.damage>was.damage then
        local amount=item.damage-was.damage
        fx:after(delay,function()
          fx:attention({text='-'..amount,scale=0.9,colour=T.white,backdrop=T.red,follow=function() return c.x,c.y end,offsetY=-0.15*D.H*c.baseScale,hold=0.8,sound='multhit1',pitch=0.9+math.min(amount,120)/400,jiggle=0.7})
          if not transferred then c:juiceUp(self.time,0.6,0.1,self.reduced) end
        end)
        delay=0.35
      elseif item.damage<was.damage then
        local amount=was.damage-item.damage
        fx:after(delay,function()
          fx:attention({text='+'..amount,scale=0.8,colour=T.white,backdrop=T.green,follow=function() return c.x,c.y end,offsetY=-0.15*D.H*c.baseScale,hold=0.7,sound='chips1'})
          if not transferred then c:juiceUp(self.time,0.3,0.05,self.reduced) end
        end)
        delay=0.3
      end
      if item.status~=was.status and item.status~='' then
        local label=item.status:gsub('^%l',string.upper):gsub(',%s*',' + ')
        fx:after(delay,function()
          fx:attention({text=label,scale=0.6,colour=T.white,backdrop=T.purple,follow=function() return c.x,c.y end,offsetY=0.2*D.H*c.baseScale,hold=0.9,sound='tarot2',pitch=0.9})
        end)
        delay=0.3
      end
      if #item.energies>#was.energies then
        self.callbacks.feedback('card1',1.05)
        c:juiceUp(self.time,0.4,0.08,self.reduced)
      end
      if item.cardId~=was.cardId then
        fx:after(delay,function()
          fx:attention({text='Evolved',scale=0.6,colour=T.white,backdrop=T.blue,follow=function() return c.x,c.y end,offsetY=-0.15*D.H*c.baseScale,hold=0.8,sound='highlight1'})
          c:juiceUp(self.time,0.5,0.1,self.reduced)
        end)
        delay=0.3
      end
    elseif c and not was and item.evolvedFrom then
      fx:after(delay,function()
        fx:attention({text='Evolved',scale=0.6,colour=T.white,backdrop=T.blue,follow=function() return c.x,c.y end,offsetY=-0.15*D.H*c.baseScale,hold=0.8,sound='highlight1'})
        c:juiceUp(self.time,0.5,0.1,self.reduced)
      end)
      delay=0.3
    elseif c and not was and (item.zone=='bench' or item.zone=='active') and not item.hidden then
      self.callbacks.feedback('cardSlide1',1)
    elseif c and not was and item.zone=='hand' and item.owner=='you' and not self.reduced and not c.drawAfterPromotion then
      self.callbacks.feedback('card1',0.9+love.math.random()*0.2)
    end
  end
  for _,c in ipairs(self.ghosts) do
    if c.ghost and not c.ghost.announced then
      c.ghost.announced=true
      self.callbacks.feedback('cardSlide2',0.95)
    end
  end
  for _,owner in ipairs({'you','opponent'}) do
    local now,was=self.sides[owner],previous.sides and previous.sides[owner]
    if not self.completedPrizes and now and was and now.prizes<was.prizes then
      local zone=L.zones[(owner=='you' and 'you' or 'opp')..'_prizes']
      local taken=was.prizes-now.prizes
      fx:after(delay,function()
        fx:attention({text='+'..taken..(taken>1 and ' PRIZES' or ' PRIZE'),scale=0.7,colour=T.white,backdrop=T.money,x=zone.well.x+zone.well.w/2,y=zone.well.y+zone.well.h/2,hold=1.0,sound='coin3',jiggle=1})
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
    {label='Turns played',value=tostring(self.turn),colour=T.money},
    {label='Your prizes left',value=tostring(you.prizes),colour=T.blue},
    {label='Opponent prizes left',value=tostring(opp.prizes),colour=T.red},
    {label='Cards in hand',value=tostring(you.hand)},
  }
  local loss=self.mode=='online' and (self.opponent~='' and self.opponent or 'Opponent'):upper()..' WINS' or 'GAME OVER'
  self.overlay=Overlay.new(self,'gameover',{title=self.outcome=='win' and 'YOU WIN!' or self.outcome=='loss' and loss or 'DRAW',rows=rows,mandatory=true})
  self.callbacks.feedback(self.outcome=='win' and 'win' or 'cancel',self.outcome=='win' and 1 or 0.8)
  if self.callbacks.jiggle then self.callbacks.jiggle(2) end
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
  b.colour=b.disabled and Hud.insetColour or colour or T.blue
  b.fontSize=b.fontSize or 24
  -- UIBox_button labels shrink to their minw rather than wrapping.
  local shown=b.uppercase and label:upper() or label
  while b.fontSize>12 and T.font(b.fontSize):getWidth(shown)>w-14 do b.fontSize=b.fontSize-1 end
  self.controls[#self.controls+1]=b
  return b
end
function Simulator:build()
  local previousPopup=self.attachedPopup
  self.controls={}
  self.attachedPopup=nil
  if not self.L then return end
  local L=self.L
  -- HUD buttons: Run Info -> Game log, Options.
  local hb=self.hud:buttons(L)
  self:add(hb.log.label or 'Log',hb.log.x,hb.log.y,hb.log.w,hb.log.h,'log',T.red,{lines=hb.log.lines,lineScales=hb.log.lineScales,lineWidth=hb.log.lineWidth,fontSize=hb.log.fontSize or 24,disabled=self.phase~='ready'})
  self:add(hb.options.label or 'Options',hb.options.x,hb.options.y,hb.options.w,hb.options.h,'options',T.orange,{lines=hb.options.lines,lineScales=hb.options.lineScales,lineWidth=hb.options.lineWidth,fontSize=hb.options.fontSize or 20})
  -- Action cluster (create_UIBox_buttons): primary blue, danger red, minors.
  -- Desktop: the cluster lives in the HUD's action panel; portrait keeps
  -- its horizontal strip under the table.
  local cl=(not L.portrait and hb.cluster) or L.cluster
  local primaries,dangers,minors={},{},{}
  for _,a in ipairs((self.targeting or self.luaTargeting) and {} or self.actions) do
    if a.slot=='primary' then primaries[#primaries+1]=a elseif a.slot=='danger' then dangers[#dangers+1]=a else minors[#minors+1]=a end
  end
  -- The hot-seat history row: the turn's End turn, setup's Ready or its
  -- first-player choice sit above it, or beside it on portrait.
  local historyRow={{'Undo turn','rewind'},{'Undo action','undo'},{'New game','restart'},{'Redo action','redo'},{'Redo turn','fast_forward'}}
  local history,others={},{}
  for _,entry in ipairs(historyRow) do history[entry[1]]=true end
  for _,a in ipairs(minors) do if history[a.label] then history[a.label]=a else others[#others+1]=a end end
  local hasHistory=#primaries>0 and #dangers==0
  for _,entry in ipairs(historyRow) do hasHistory=hasHistory and history[entry[1]]~=true end
  local chooseFirst=self.gamePhase=='setup:chooseFirst'
  if hasHistory and (#others==0 or chooseFirst and #others==1) then
    local gap=6
    local size=cl.horizontal and 44 or (cl.w-4*gap)/5
    -- Slightly less space above End turn than below the history row.
    local y=cl.horizontal and cl.y+8 or cl.y+(cl.h-44-gap-size)/2+1.8+3/2-2
    local topW=cl.horizontal and cl.w-5*(size+gap) or cl.w
    local bw=(topW-#others*(44+gap)-(#primaries-1)*gap)/#primaries
    local x=cl.x
    for _,a in ipairs(primaries) do
      self:add(a.label,x,y,bw,44,'invoke',a.colour,{token=a.token,disabled=a.disabled,fontSize=chooseFirst and 22 or 24,setupChoice=chooseFirst or nil})
      x=x+bw+gap
    end
    local dice=others[1]
    if dice then self:add(dice.label,x,y,44,44,'invoke',dice.colour,{token=dice.token,disabled=dice.disabled,icon='dice',setupChoice=true}) end
    x=cl.horizontal and cl.x+topW+gap or cl.x
    if not cl.horizontal then y=y+44+gap end
    for i,entry in ipairs(historyRow) do
      local action=history[entry[1]]
      self:add(action.label,x+(i-1)*(size+gap),y,size,size,'invoke',entry[2]=='restart' and T.gold or T.red,
        {token=action.token,disabled=action.disabled,icon=entry[2]})
    end
  elseif chooseFirst and #primaries==2 and #minors<=1 and #dangers==0 then
    -- Online the coin winner gets Go first / Go second without the dice.
    local h,gap=44,6
    local bw=#minors==1 and (cl.w-h-2*gap)/2 or (cl.w-gap)/2
    local y=cl.y+(cl.horizontal and 8 or 1.8+3/2)
    for i,a in ipairs(primaries) do
      self:add(a.label,cl.x+(i-1)*(bw+gap),y,bw,h,'invoke',a.colour,{token=a.token,disabled=a.disabled,fontSize=22,setupChoice=true})
    end
    local a=minors[1]
    if a then self:add(a.label,cl.x+2*(bw+gap),y,h,h,'invoke',a.colour,{token=a.token,disabled=a.disabled,icon='dice',setupChoice=true}) end
  elseif cl.horizontal then
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
    -- Ready uses the first-player buttons' height; other lone actions fill
    -- the available panel height.
    if #primaries+#dangers==1 and #minors==0 then
      local b=self.controls[#self.controls]
      b.h=b.label=='Ready' and 44 or cl.h
      -- The face lifts 1.8px at rest; the panel extends 3px below its bounds.
      -- Compensate for both so the visible top and bottom insets match.
      b.y=cl.y+1.8+3/2
    end
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
  -- Targeting instructions live in the HUD; choices remain on the table.
  local target=self.targeting and self.targeting.menu or self.luaTargeting
  if target then
    local footer={}
    for _,o in ipairs(target.footer or {}) do footer[#footer+1]={label=o.label,action='invoke',colour=o.colour,token=o.token,disabled=o.disabled} end
    if self.luaTargeting or not target.mandatory then
      footer[#footer+1]={label='Cancel',action=self.luaTargeting and 'cancelTargeting' or 'dismiss',colour=T.orange}
    end
    local n=#footer
    local gap=6
    local bw=cl.horizontal and (cl.w-math.max(0,n-1)*gap)/math.max(1,n) or cl.w
    local bh=cl.horizontal and 36 or math.min(34,(cl.h-math.max(0,n-1)*gap)/math.max(1,n))
    for i,o in ipairs(footer) do
      self:add(o.label,cl.x+(cl.horizontal and (i-1)*(bw+gap) or 0),cl.y+(cl.horizontal and 8 or (i-1)*(bh+gap)),bw,bh,o.action,o.colour,{token=o.token,disabled=o.disabled,fontSize=20})
    end
  end
  -- Attached buttons for the highlighted card (use/sell buttons).
  if self.highlight and self.highlight.item then self:buildAttached(self.highlight) end
  local popup=self.attachedPopup
  if previousPopup and popup and previousPopup.card==popup.card then
    popup.motion=previousPopup.motion
  elseif previousPopup and not self.reduced then
    previousPopup.motion.T.y=1
    self.closingPopup=previousPopup
  end
  if popup and self.closingPopup and self.closingPopup.card==popup.card then
    popup.motion=self.closingPopup.motion;popup.motion.T.y=0
    self.closingPopup=nil
  end
  if self.reduced then self.closingPopup=nil end
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
    else buttons[#buttons+1]={label=a.label,colour=a.colour,token=a.token,disabled=a.disabled,cost=a.cost,damage=a.damage,hasCost=a.hasCost,ability=a.group=='ability'} end
  end
  if not item.hidden and item.cardId~='' then buttons[#buttons+1]={label='View',colour=T.profile,view=true} end
  if #buttons==0 then return end
  local scale=card.baseScale
  local cw,ch=D.W*scale,D.H*scale
  local pad,gap=6,6
  local bw,bh=100,select(2,Dyna.measure('Hg',0.28))+12
  local totalHeight=0
  for _,b in ipairs(buttons) do
    local costW=(b.cost and #b.cost>0) and #b.cost*18-6+3.2 or 0
    if b.hasCost and costW==0 then costW=15.2 end
    local damageW=(b.damage and b.damage~='') and Dyna.measure(b.damage,0.28)+8 or 0
    bw=math.max(bw,Dyna.measure(b.label,0.28)+16,costW+damageW+16)
    b.height=bh+((b.hasCost or costW>0 or damageW>0) and math.max(16,bh-12)+4 or 0)
    totalHeight=totalHeight+b.height
  end
  bw=math.min(bw,260)
  local pw,ph=bw+2*pad,2*pad+totalHeight+(#buttons-1)*gap+3
  local above=item.zone=='hand' or (self.portrait and item.owner=='you')
  local x,y
  -- Anchor both button layouts to the highlighted card's lifted position.
  local lift=0.2*D.H*scale
  local cardGap=16
  if above then x=card.homeX-pw/2;y=card.homeY-lift-ch/2-cardGap-ph
  else
    x=card.homeX+cw/2+cardGap;y=card.homeY-lift-ch/2
    if x+pw>self.boardW-8 then x=card.homeX-cw/2-cardGap-pw end
  end
  x=math.max(4,math.min(self.boardW-pw-4,x))
  y=math.max(4,math.min(self.boardH-ph-8,y))
  local motion=Motion.new(0,self.reduced and 0 or 1,0)
  motion.T.y=0
  self.attachedPopup={x=x,y=y,w=pw,h=ph,card=card,motion=motion,travel=lift,buttons={}}
  local buttonY=y+pad
  for _,b in ipairs(buttons) do
    local action=b.view and 'inspect' or (b.actions and 'target' or 'cardAction')
    local added=self:add(b.label,x+pad,buttonY,bw,b.height,action,b.colour,{token=b.token,disabled=b.disabled,fontSize=21,attached=true,card=card,group=b,cost=b.cost,damage=b.damage,hasCost=b.hasCost,ability=b.ability})
    self.attachedPopup.buttons[#self.attachedPopup.buttons+1]=added
    buttonY=buttonY+b.height+gap
    if b.disabled then added.colour=T.grey end -- not the panel black
  end
end
local function popupOffset(popup)
  return popup and popup.motion.VT.y*popup.travel or 0
end
function Simulator:hit(x,y)
  for i=#self.controls,1,-1 do
    local b=self.controls[i]
    local offset=b.attached and popupOffset(self.attachedPopup) or 0
    if not b.disabled and Button.hit(b,x,y-offset) then return i end
  end
  return 0
end
function Simulator:cardHit(x,y)
  if self.overlay then return nil end
  if self.attachedPopup and Button.hit(self.attachedPopup,x,y-popupOffset(self.attachedPopup)) then return nil end
  -- Raised cards are painted last, so they also receive the pointer first.
  if self.hoverCard and self.hoverCard:hit(x,y) then return self.hoverCard end
  if self.highlight and self.highlight:hit(x,y) then return self.highlight end
  local best
  for i=#self.cards,1,-1 do
    local c=self.cards[i]
    if not c.drawAfterPromotion and c:hit(x,y) then
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
function Simulator:isCounterSelected(card)
  if self.counterMotion then return self.counterMotion.cards[card.item.id]~=nil end
  local menu=self.targeting and self.targeting.menu
  return menu and menu.counterSourceUid==card.item.id
end
function Simulator:selectTarget(card,target)
  local menu=self.targeting and self.targeting.menu
  local source=menu and menu.counterSourceUid
  if source and source~='' and not self.reduced then
    local cards={[card.item.id]=card}
    for _,c in ipairs(self.cards) do if c.item.id==source then cards[source]=c end end
    -- Give the destination time to rise before the final shared pulse.
    for _,c in pairs(cards) do c.motion.juice=nil;c.candidateClock=0 end
    self.focusCard=nil;self.hoverCard=nil
    self.counterMotion={cards=cards,token=target.token,start=self.time}
    return
  end
  card:juiceUp(self.time,0.5,0.1,self.reduced)
  self.luaTargeting=nil;self:invoke(target.token)
end
function Simulator:updateCounterMotion(time,reduced)
  local p=self.counterMotion
  if not p or p.sent then return end
  if not p.shakeAt and time-p.start>=0.5 then
    p.shakeAt=time
    for _,c in pairs(p.cards) do c:juiceUp(time,0.5,0.3,reduced) end
  end
  -- Lower both cards after the pulse, then wait for their visible positions
  -- to settle so the counter transfer cannot overlap the return animation.
  if p.shakeAt and not p.loweringAt and time-p.shakeAt>=0.4 then p.loweringAt=time end
  local settled=p.loweringAt and time-p.loweringAt>=0.35
  if settled then
    for _,c in pairs(p.cards) do
      if math.abs(c.x-c.homeX)>1.5 or math.abs(c.y-c.homeY)>1.5 then settled=false;break end
    end
  end
  if reduced or settled then
    p.sent=true
    self:invoke(p.token)
  end
end
function Simulator:isRareCandyDropTarget(card)
  local d=self.drag
  if not self.rareCandy or card.item.owner~='you' then return false end
  if card.item.zone~='active' and card.item.zone~='bench' then return false end
  for uid,actions in pairs(self.cardActions) do
    if not d or uid==d.card.item.id then
      for _,a in ipairs(actions) do
        if a.group=='evolve' and a.targetUid==card.item.id and not a.disabled then return true end
      end
    end
  end
  return false
end
function Simulator:prizeSlotHit(x,y)
  if not self.targeting or self.targeting.menu.kind~='prizes' then return nil end
  local z=self.L.zones.you_prizes
  local side=self.sides.you or {prizes=0}
  for i=0,side.prizes-1 do
    local px,py=Layout.prize(z,i)
    local w,h=D.W*z.scale,D.H*z.scale
    if x>=px-w/2-4 and x<=px+w/2+4 and y>=py-h/2-4 and y<=py+h/2+4 then return i end
  end
  return nil
end
function Simulator:prizePosition(owner,index)
  local z=self.L.zones[prefix(owner)..'prizes']
  local x,y=Layout.prize(z,index)
  if self.targeting and self.targeting.menu.kind=='prizes' and owner=='you' then
    if not self.reduced then y=y-math.sin(self.time*6+index)*2 end
    for _,o in ipairs(self.targeting.menu.options) do
      if o.uid=='prize:'..index and o.selected then y=y-0.2*D.H*z.scale end
    end
  end
  return x,y
end
function Simulator:updatePrizes(dt,time,mx,my,reduced,blocked)
  local previous=self.prizeMotion or {}
  local current={}
  local faceUp={}
  for _,c in ipairs(self.cards) do
    if c.item.zone=='prize' then faceUp[c.item.owner..':'..c.item.index]=true end
  end
  for _,owner in ipairs({'opponent','you'}) do
    local z=self.L.zones[prefix(owner)..'prizes']
    local side=self.sides[owner] or {prizes=0}
    for i=0,side.prizes-1 do
      local key=owner..':'..i
      if not faceUp[key] then
        local p=previous[key] or {motion=Motion.new(0,0,0)}
        local x,y=self:prizePosition(owner,i)
        local active=not blocked and not self.drag and self.hover==0 and not self.hoverCard
          and math.abs(mx-x)<=D.HALF_W*z.scale and math.abs(my-y)<=D.HALF_H*z.scale
        if active and not p.hovered then
          Card.juiceUp(p,time,0.05,0.03,reduced)
          self.callbacks.feedback('paper1',0.9+love.math.random()*0.2)
        end
        p.hovered=active
        p.motion:update(dt,time,active,false,reduced)
        current[key]=p
      end
    end
  end
  self.prizeMotion=current
end
-- ---------------------------------------------------------------- update
function Simulator:update(dt,time,mx,my,reduced)
  self.time,self.reduced=time,reduced
  CardFrame.open()
  self:sync(Mailbox.read('simulator'))
  local raw=Mailbox.read('art')
  if raw and raw~=self.artRaw then
    self.artRaw=raw;local art=Mailbox.artMap(raw)
    local old=self.art;self.art=art
    for _,c in ipairs(self.cards) do if old[c.item.cardId]~=art[c.item.cardId] then c:rebuild() end end
    -- Discard piles paint their top card's scan, which can arrive after a reload.
    for _,p in ipairs(self.piles) do if p.topItem and old[p.topItem.cardId]~=art[p.topItem.cardId] then p:rebuild();p.faceKey=self:pileFace(p.item.kind,p.owner,p.topItem) end end
    for _,c in pairs(self.attached or {}) do if old[c.item.cardId]~=art[c.item.cardId] then c:rebuild() end end
    if self.overlay then for _,c in ipairs(self.overlay.cards) do if old[c.item.cardId]~=art[c.item.cardId] then c:rebuild() end end end
  end
  CardFrame.close()
  mx,my=self:point(mx,my);self.mx,self.my=mx,my
  -- Table juice waits behind an open coin flip, like Balatro's event queue.
  self.fx:update(dt,time,reduced,self.overlay and self.overlay.kind=='coin')
  local away=self.away
  if away then
    if not away.leaving then away.detail:set(self:awayDetail(),time) end
    away.title:update(time,reduced);away.detail:update(time,reduced)
    if away.leaving and (reduced or not away.title:visible()) then self.away=nil end
  end
  self.hud:update(dt,time,reduced)
  if self.attachedPopup then self.attachedPopup.motion:update(dt,time,false,false,reduced) end
  if self.closingPopup then
    self.closingPopup.motion:update(dt,time,false,false,reduced)
    if reduced or self.closingPopup.motion.VT.y>=0.96 then self.closingPopup=nil end
  end
  self:updateCounterMotion(time,reduced)
  local blocked=self.koPresentation or self.counterMotion or (self.overlay and not self.peek)
  if self.overlay then self.overlay:update(dt,time,blocked and mx or -1000,blocked and my or -1000,reduced) end
  self.hover=blocked and 0 or self:hit(mx,my)
  local hovered=(not blocked and self.hover==0) and self:cardHit(mx,my) or nil
  if self.drag then
    local d=self.drag
    if not d.moved and (mx-d.x)^2+(my-d.y)^2>36 then d.moved=true;d.card.dragging=true;self.callbacks.feedback('cardSlide1',0.95);self.highlight=nil;self:build() end
    if d.moved then
      d.card.targetX,d.card.targetY=mx-d.dx,my-d.dy
      self:updateReorder(mx,my)
      self.dropZone=self:dropZoneAt(mx,my,d.card)
    end
  end
  self.hoverCard=hovered
  -- Keyboard focus shows only while the pointer is over no control or card.
  local pointed=self.hover>0 or hovered~=nil
  for _,c in ipairs(self.cards) do
    local focused=not blocked and not pointed and self.focusCard==c
    local active=(not blocked and c==hovered) or focused
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.callbacks.feedback('paper1',0.9+love.math.random()*0.2) end
    c.held=(self.drag~=nil and self.drag.card==c) or nil
    local breathe=reduced and 0 or 1
    if c.fan then
      local award=self.koPresentation and self.koPresentation:award(c.item.owner)
      if award then
        local zone=self.L.zones[prefix(c.item.owner)..'hand']
        c.homeX,c.baseY,c.baseRotation=Layout.hand(zone,award.handCount,c.item.displayIndex)
        if c.item.owner=='opponent' then c.baseRotation=-c.baseRotation;c.baseY=zone.y-(c.baseY-zone.y) end
      end
      local sign=c.item.owner=='opponent' and -1 or 1
      c.motion.T.r=c.baseRotation+breathe*0.02*math.sin(2*time+c.homeX/c.unit)*sign
      c.homeY=c.baseY+breathe*0.03*math.sin(0.666*time+c.homeX/c.unit)*c.unit*sign
    elseif not c.koAnimating and not c.koHidden and (c.item.zone=='bench' or c.item.zone=='active' or c.item.zone=='stadium') then
      c.motion.T.r=c.baseRotation+c.statusRotation+breathe*0.0*math.sin(time)
      c.homeY=c.baseY+breathe*0.03*math.sin(0.666*time+c.homeX/c.unit)*c.unit*0.5
    end
    local candidate=self:isCandidate(c)
    local counterCandidate=candidate and self.targeting and self.targeting.menu.counterTransfer
    local candyTarget=not blocked and self:isRareCandyDropTarget(c)
    if not self.counterMotion and (candidate or candyTarget) and not reduced then
      c.candidateClock=(c.candidateClock or 0)+dt
      if c.candidateClock>0.8 or (candyTarget and not c.candyTarget) or (counterCandidate and not c.counterCandidate) then
        c.candidateClock=0;c:juiceUp(time,candyTarget and 0.25 or 0.1,candyTarget and 0.3 or 0.1,reduced)
      end
    else
      c.candidateClock=0
    end
    c.candyTarget=candyTarget and not reduced
    c.counterCandidate=counterCandidate and not reduced
    local counterSelected=self:isCounterSelected(c)
    local counterRaised=counterSelected and not (self.counterMotion and self.counterMotion.loweringAt)
    c.lift=(c==self.highlight or counterRaised) and 0.2*D.H*c.baseScale or 0
    c.tint=nil
    if (self.targeting or self.luaTargeting) and not candidate and not counterSelected and c.item.owner~='global' and c.item.zone~='hand' and c.item.zone~='prize' then c.tint={0.6,0.6,0.6,1} end
    if c.drawAfterPromotion then
      local pending=c.drawAfterPromotion
      local p=pending.card
      local settled=math.abs(p.x-p.homeX)<3 and math.abs(p.y-(p.homeY-(p.lift or 0)))<3
      if settled and not pending.readyAt then pending.readyAt=time+0.2 end
      if reduced or self.byUid[p.item.owner..':'..p.item.id]~=p or (pending.readyAt and time>=pending.readyAt) then
        c.drawAfterPromotion=nil
        if not reduced then self.callbacks.feedback('card1',0.9+love.math.random()*0.2) end
      end
    end
    if not c.drawAfterPromotion then c:update(dt,time,active,reduced,focused) end
  end
  for i=#self.ghosts,1,-1 do
    local c=self.ghosts[i]
    local age=time-c.ghost.start
    if c.ghost.target then c.homeX,c.homeY=c.ghost.target.x,c.ghost.target.y;c.motion.T.r=0 end
    c:update(dt,time,false,reduced)
    if age>0.7 then
      c.texture:release();table.remove(self.ghosts,i)
    end
  end
  -- Show the authoritative discard top after all slides and KO burns finish.
  for owner,pending in pairs(self.pendingPiles or {}) do
    local waiting=false
    for _,c in ipairs(self.ghosts) do
      if (c.item.owner=='global' and 'you' or c.item.owner)==owner then waiting=true;break end
    end
    if not waiting then
      for k=#self.piles,1,-1 do local p=self.piles[k];if p.owner==owner and p.item.kind=='discard' then p.texture:release();table.remove(self.piles,k) end end
      self.piles[#self.piles+1]=pending;self.pendingPiles[owner]=nil
    end
  end
  local control=self.controls[self.hover]
  for _,p in ipairs(self.piles) do
    local active=not blocked and not self.drag and not hovered and (
      (self.hover==0 and p:hit(mx,my)) or
      (control and control.action=='pile' and control.owner==p.owner and p.item.kind=='discard'))
    if active and not p.hovered then
      p:juiceUp(time,0.05,0.03,reduced)
      self.callbacks.feedback('paper1',0.9+love.math.random()*0.2)
    end
    p:update(dt,time,active,reduced,self.boardW)
  end
  self:updatePrizes(dt,time,mx,my,reduced,blocked)
  -- Hover popup (card_h_popup) for face-up cards with catalogue info.
  self.popup=nil
  local assigningCounters=self.targeting and self.targeting.menu.hideTargetOutline
  if hovered and hovered~=self.highlight and not hovered.item.hidden and not self.drag and self.info[hovered.item.cardId] and not blocked and not assigningCounters then
    local key=hovered.item.owner..':'..hovered.item.id..':'..(hovered.item.damage or 0)..':'..(hovered.item.status or '')
    if self.popupKey~=key then self.popupKey=key;self.popupBox=Popup.build(self.info[hovered.item.cardId],hovered.item,self.portrait and 236 or 270,self.boardW,true) end
    self.popup=hovered
  end
  self:updateKoPresentation(dt,time,reduced)
end
function Simulator:dropZoneAt(x,y,card)
  local L=self.L;local item=card.item
  local Z=L.zones
  if self:overOwnRow(card,x,y) then return {zone='reorder',index=item.displayIndex} end
  if not item.draggable then return nil end
  if item.zone=='hand' then
    if item.category=='Trainer' and (item.trainerType=='Item' or item.trainerType=='Supporter') then
      for _,zone in ipairs({Z.you_bench,Z.opp_bench}) do
        if Layout.inside(zone.well,x,y) then return {zone='playmat',index=0,well=zone.well} end
      end
    end
    if Layout.inside(Z.you_active.well,x,y) then return {zone='active',index=0,well=Z.you_active.well} end
    if Layout.inside(Z.you_bench.well,x,y) then
      local count=0;local onto
      for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='bench' then count=count+1;if c~=card and c:hit(x,y) then onto=c end end end
      local index=onto and onto.item.index or Layout.benchIndex(Z.you_bench,count,x)
      return {zone='bench',index=index,well=Z.you_bench.well,card=onto}
    end
    if Layout.inside(Z.stadium.well,x,y) then return {zone='stadium',index=0,well=Z.stadium.well} end
    if Layout.inside(Z.played.well,x,y) then return {zone='playmat',index=0,well=Z.played.well} end
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
  if self.counterMotion then return end
  if self.koPresentation then return end
  local b=self.controls[index];if not b or b.disabled then return end
  if b.setupChoice then
    if b.lastClicked and self.time<=b.lastClicked+0.1 then return end
    b.lastClicked=self.time
    local feedback=self.callbacks.sourceFeedback or self.callbacks.feedback
    feedback('button',1,0.3)
    if not self.reduced and self.callbacks.jiggle then self.callbacks.jiggle(0.5) end
  elseif b.action~='pile' then self.callbacks.feedback('button') end
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
  self:build()
  self:invoke(action.token)
end
-- The game-over Rematch reads Waiting... until the next match reopens the table.
function Simulator:rematch()
  if self:rematchPending() then return end
  self.rematchSent=true;self:command('rematch')
  if self.overlay and self.overlay.kind=='gameover' then self.overlay:build() end
end
function Simulator:rematchPending() return self.rematchSent or self.flags['rematch-sent'] or false end
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
-- Forget any press or drag in progress, as when the window loses focus.
function Simulator:cancelInteractions()
  if self.drag then self.drag.card.dragging=false end
  self.drag=nil;self.clicked=nil;self.pressed=nil;self.pressedOverlay=nil;self.clickedPrize=nil
end
function Simulator:mousepressed(x,y)
  if self.koPresentation or self.counterMotion then return end
  x,y=self:point(x,y);self.focus=0;self.focusCard=nil
  if self.peek then self.peek=false;return end
  if self.overlay then
    self.pressedOverlay=self.overlay:press(x,y);return
  end
  self.pressed=self:hit(x,y)
  if self.pressed>0 then return end
  local c=self:cardHit(x,y)
  local prize=self:prizeSlotHit(x,y)
  if prize then self.clickedPrize=prize;return end
  if c then
    self.clicked=c
    local reorderable=not c.item.hidden and (c.item.zone=='hand' or c.item.zone=='bench')
    if c.item.owner=='you' and (c.item.draggable or reorderable) and not self.targeting and not self.luaTargeting then
      self.drag={card=c,x=x,y=y,dx=x-c.x,dy=y-c.y,moved=false}
      if reorderable then self.drag.originalRow=self:rowCards(c) end
    end
  elseif self.highlight then self.highlight=nil;self:build() end
end
function Simulator:mousereleased(x,y)
  if self.koPresentation or self.counterMotion then return end
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
    self:updateReorder(x,y)
    local zone=self:dropZoneAt(x,y,d.card)
    if zone then
      local item=d.card.item
      if zone.zone=='reorder' then
        self:command('reorder',item.zone,item.id,item.displayIndex)
      elseif zone.zone=='retreat' then
        if zone.index>=0 then self:command('retreat',zone.index) else d.card:juiceUp(self.time,nil,nil,self.reduced) end
      else self:command('move',item.id,item.zone,item.index,zone.zone,zone.index) end
    else d.card:juiceUp(self.time,nil,nil,self.reduced) end
    self.dropZone=nil
  elseif self.clicked and self.clicked==self:cardHit(x,y) then
    local c=self.clicked
    local target=self:targetFor(c)
    if target then
      self.callbacks.feedback('card1',1.1)
      self:selectTarget(c,target)
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
  if self.koPresentation or self.counterMotion then return end
  if self.peek then self.peek=false;return end
  if self.overlay then self.overlay:keypressed(key);return end
  if key=='escape' then
    if self.drag then
      if self.drag.originalRow then self:alignRow(self.drag.originalRow) end
      self.drag.card.dragging=false;self.drag=nil;self.clicked=nil;self.dropZone=nil
    elseif self.rareCandy then self:command('cancelRareCandy')
    elseif self.luaTargeting then self.luaTargeting=nil;self:build()
    elseif self.highlight then self.highlight=nil;self:build()
    elseif self.targeting and not self.targeting.menu.mandatory then self:command('dismiss')
    else self:openOptions() end
    return
  end
  if key=='tab' or key=='left' or key=='right' or key=='up' or key=='down' then
    local cardCount=#self.cards
    local total=#self.controls+cardCount;if total==0 then return end
    local found
    self.focus,found=Controls.cycle(self.focus,Controls.backward(key) and -1 or 1,total,function(i)
      local b=self.controls[i];local c=self.cards[i-#self.controls]
      return not ((b and not b.disabled and not b.invisible) or (c and not c.item.hidden and not c.drawAfterPromotion))
    end)
    if found then
      local b=self.controls[self.focus];local c=self.cards[self.focus-#self.controls]
      self.focusCard=c;self.callbacks.announce(b and b.label or c.item.name)
    end
  elseif key=='return' or key=='space' then
    if self.focusCard then
      local c=self.focusCard
      local target=self:targetFor(c)
      if target then self:selectTarget(c,target)
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
-- CardArea area_uibox (cardarea.lua): black at 10% opacity, r=0.1.
local function well(x,y,w,h)
  Button.panel(x,y,w,h,{0,0,0,0.1},1.2)
end
-- Badge text by status field, e.g. 'burned,asleep' -> 'Burned Asleep'.
local statusLabels={}
function Simulator:drawBadges(c,rw)
  local item=c.item
  if item.hidden or not (item.zone=='active' or item.zone=='bench') then return end
  local ch=D.H*c.baseScale*c.motion.VT.scale
  if item.status~='' then
    local label=statusLabels[item.status]
    if not label then
      local names={}
      for _,s in ipairs(Codec.list(item.status)) do names[#names+1]=s:sub(1,1):upper()..s:sub(2) end
      label=table.concat(names,' ');statusLabels[item.status]=label
    end
    local tw=Dyna.measure(label,0.26)+12
    Button.panel(c.x-tw/2,c.y-ch/2-20,tw,16,T.purple,1)
    Dyna.static(label,0.26,c.x-tw/2,c.y-ch/2-20,tw,16,T.white,{roomWidth=rw})
  end
end
-- Attached cards tuck behind the Pokémon sideways: Energy peeks out of the
-- right edge aligned to the bottom, Tools out of the left edge aligned to the
-- top, each further card a little less exposed, like a fanned stack.
local function attachedStack(self,list,side,c,cw,ch,s,aw,ah,peek,visit)
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
      visit(tex,x,y,s,angle,side)
    end
  end
end
function Simulator:eachAttached(c,visit)
  local item=c.item
  if item.hidden or not (item.zone=='active' or item.zone=='bench') then return end
  local scale=c.baseScale*c.motion.VT.scale
  local cw,ch=D.W*scale,D.H*scale
  local s=scale*0.9
  local aw,ah=D.W*s,D.H*s -- the attached card's own width/height
  local peek=item.zone=='bench' and 26 or 36
  -- Stacks climb the edge: each further Energy sits 18px higher (Tools 18px
  -- lower), all peeking out by the same amount, like cards slid under a
  -- Pokémon one after another.
  if item.energyCards then attachedStack(self,item.energyCards,1,c,cw,ch,s,aw,ah,peek,visit) end
  if item.toolCards then attachedStack(self,item.toolCards,-1,c,cw,ch,s,aw,ah,peek,visit) end
end
local function drawAttachedCard(tex,x,y,scale,angle,side)
  local res=tex.item.resolution or 1
  local sx=scale/res
  g.setColor(0,0,0,0.3)
  g.draw(tex.texture,x+side*3,y+(side>0 and -1 or 3),angle,sx,sx,D.W*res/2,D.H*res/2)
  g.setColor(1,1,1,1)
  g.draw(tex.texture,x,y,angle,sx,sx,D.W*res/2,D.H*res/2)
end
function Simulator:drawAttached(c)
  self:eachAttached(c,drawAttachedCard)
end
function Simulator:drawCard(c,shaders,rw)
  if c.koHidden or c.koAnimating or c.drawAfterPromotion then return end
  if c.item.zone=='prize' and self:koPrizeTaken(c.item.owner,c.item.index) then return end
  self:drawAttached(c)
  c:draw(shaders,self.time,self.mx or 0,self.my or 0,self.reduced,rw)
  -- Board choices (such as Boss's Orders) use candidate motion without a
  -- border. Keep outlines for local attachment choices and Prize selection.
  local hideOutline=self.targeting and (self.targeting.menu.kind=='board' or self.targeting.menu.hideTargetOutline)
  if self:isCandidate(c) and not hideOutline then
    local scale=c.baseScale*c.motion.VT.scale
    g.setLineWidth(2)
    g.push();g.translate(c.x,c.y);g.rotate(c.angle)
    Button.outline(-D.HALF_W*scale-3,-D.HALF_H*scale-3,D.W*scale+6,D.H*scale+6,T.white,1.2)
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
  local w,h=D.W*z.scale,D.H*z.scale
  for i=0,side.prizes-1 do
    local px,py=self:prizePosition(owner,i)
    if not faceUp[i] and not self:koPrizeTaken(owner,i) then
      local p=self.prizeMotion and self.prizeMotion[owner..':'..i]
      g.push();g.translate(px,py)
      if p then g.rotate(p.motion.VT.r);g.scale(p.motion.VT.scale) end
      g.translate(-w/2,-h/2)
      g.setColor(0,0,0,0.3);g.push();g.translate(0,3);self:drawBack(owner,w,h);g.pop()
      self:drawBack(owner,w,h)
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
    local z=Z[name];if z and z.well and not z.tiny then well(z.well.x,z.well.y,z.well.w,z.well.h) end
  end
  -- Items and Supporters play without a drop-target outline or glow.
  local dragged=self.drag and self.drag.card.item
  local trainerPlay=dragged and (dragged.trainerType=='Item' or dragged.trainerType=='Supporter')
  local sameSlot=dragged and self.dropZone and self.dropZone.zone==dragged.zone and self.dropZone.index==dragged.index
  if self.drag and self.drag.moved and self.dropZone and self.dropZone.well and not trainerPlay and not sameSlot then
    local w=self.dropZone.well
    g.setLineWidth(2.5);Button.outline(w.x-2,w.y-2,w.w+4,w.h+4,T.white,1.2)
    g.setColor(1,1,1,0.08);Button.panel(w.x,w.y,w.w,w.h,{1,1,1,0.08},1.2)
  end
  for _,p in ipairs(self.piles) do p:draw() end
  self:drawPrizes('opponent',rw);self:drawPrizes('you',rw)
  for _,c in ipairs(self.ghosts) do c:draw(shaders,self.time,self.mx or 0,self.my or 0,self.reduced,rw) end
  local hideHand=false
  local order={'opponent_hand','opponent_discard','opponent_bench','opponent_active','global_stadium','you_discard','you_bench','you_active','you_prize','opponent_prize','you_played','opponent_played','you_hand'}
  for _,zoneKey in ipairs(order) do
    for _,c in ipairs(self.cards) do
      if c.zoneKey==zoneKey and not c.dragging and c~=self.hoverCard and c~=self.highlight and not self:isCounterSelected(c) and not (zoneKey=='you_hand' and hideHand) then self:drawCard(c,shaders,rw) end
    end
  end
  for _,c in ipairs(self.cards) do
    if self:isCounterSelected(c) and c~=self.highlight and c~=self.hoverCard and not c.dragging then self:drawCard(c,shaders,rw) end
  end
  if self.highlight and self.highlight~=self.hoverCard and not self.highlight.dragging and not (hideHand and self.highlight.item.zone=='hand') then self:drawCard(self.highlight,shaders,rw) end
  if self.hoverCard and not self.hoverCard.dragging and not (hideHand and self.hoverCard.item.zone=='hand') then self:drawCard(self.hoverCard,shaders,rw) end
  if self.koPresentation then self.koPresentation:draw(shaders,rw) end
  if self.drag and self.drag.moved then
    -- Attached cards ride along under the dragged Pokémon.
    self:drawAttached(self.drag.card)
    self.drag.card:draw(shaders,self.time,self.mx,self.my,self.reduced,rw)
  end
  -- HUD.
  self.hud:draw(self,L,self.time,self.reduced,self.hover)
  -- Controls.
  if self.closingPopup then
    local p=self.closingPopup
    g.push();g.translate(0,popupOffset(p))
    Popup.frame(p.x,p.y,p.w,p.h)
    for _,b in ipairs(p.buttons) do Popup.action(b,false,false,rw) end
    g.pop()
  end
  if self.attachedPopup then
    local p=self.attachedPopup
    g.push();g.translate(0,popupOffset(p))
    Popup.frame(p.x,p.y,p.w,p.h)
    g.pop()
  end
  for i,b in ipairs(self.controls) do
    if not b.invisible then
      local active=not self.overlay and (self.hover==i or (self.hover==0 and not self.hoverCard and self.focus==i))
      local pressed=(self.pressed==i and self.hover==i) or (b.lastClicked and self.time<b.lastClicked+0.1)
      if b.attached then
        g.push();g.translate(0,popupOffset(self.attachedPopup))
        Popup.action(b,active,self.pressed==i and self.hover==i,rw)
        g.pop()
      elseif b.lines then
        local label=b.label;b.displayLabel=' '
        Button.draw(b,active and not b.disabled,pressed,self.focus==i,rw)
        b.displayLabel=nil;b.label=label
        local heights,total={},0
        for k,line in ipairs(b.lines) do
          local _,h=Dyna.measure(line,b.lineScales[k])
          heights[k]=h;total=total+h
        end
        local textY=b.y+(b.h-total)/2
        for k,line in ipairs(b.lines) do
          Dyna.static(line,b.lineScales[k],b.x+(b.w-b.lineWidth)/2,textY,b.lineWidth,heights[k],T.white,{roomWidth=rw,fit=true})
          textY=textY+heights[k]
        end
      elseif (b.cost and #b.cost>0) or (b.damage and b.damage~='') then
        -- Attack rows: cost pips at the left, name, printed damage at the right.
        local label=b.label;b.displayLabel=' '
        Button.draw(b,active and not b.disabled,pressed,self.focus==i,rw)
        b.displayLabel=nil;b.label=label
        local pipW=0
        if b.cost and #b.cost>0 then pipW=Energy.row(b.cost,b.x+8,b.y+b.h/2,8,3,b.disabled and 0.5 or 1,"left")+8 end
        local dmgW=(b.damage and b.damage~='') and Dyna.measure(b.damage,0.42)+8 or 0
        if dmgW>0 then Dyna.static(b.damage,0.42,b.x+b.w-6-dmgW,b.y,dmgW,b.h,T.white,{align='right',roomWidth=rw}) end
        Dyna.static(label,0.38,b.x+8+pipW,b.y,b.w-16-pipW-dmgW,b.h,T.white,{align='left',fit=true,roomWidth=rw})
      else
        Button.draw(b,active and not b.disabled,pressed,self.focus==i,rw)
      end
      if b.selected then g.setLineWidth(1.5);Button.outline(b.x-2,b.y-2,b.w+4,b.h+4,T.white,1.2) end
    end
  end
  -- Hover popup.
  if self.popup and self.popupBox and not self.overlay then
    local c=self.popup
    local box=self.popupBox
    local ch=D.H*c.baseScale*c.motion.VT.scale
    local below=c.y<0.8*165 or (c.item.owner=='opponent' and c.item.zone=='hand')
    local px=c.x-box.w/2
    px=math.max(L.table.x+4,math.min(self.boardW-box.w-4,px))
    local py=below and c.y+ch/2+10 or c.y-ch/2-(c.lift or 0)-box.h-10
    if py<4 then py=c.y+ch/2+10 end
    if py+box.h>self.boardH-4 then py=self.boardH-4-box.h end
    box.draw(px,py)
  end
  if self.away then
    self.away.title:draw(L.banner.x,L.banner.y-22,rw)
    self.away.detail:draw(L.banner.x,L.banner.y+22,rw)
  end
  self.fx:draw(rw)
  if self.overlay and not self.peek then
    Modal.backdrop(self.boardW,self.boardH)
    self.overlay:draw(shaders)
  end
  g.pop()
end
return Simulator
