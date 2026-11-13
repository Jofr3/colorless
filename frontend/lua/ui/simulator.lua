local D=require('ui.card_dimensions')
-- The sandbox table, built like Balatro's run screen: the HUD column on the
-- left, transparent CardArea wells on the felt, the hand fanned along the
-- bottom edge, the deck at the bottom right, hover popups, click-to-highlight
-- cards with attached action buttons, drag-and-drop plays, attention-text
-- juice for damage and prizes, and generic-options overlays for prompts.
-- The browser host (LuaSimulator) owns the rules; Lua owns everything seen.
-- This file opens and lays out the table and runs each frame's update; the
-- parts mixed in at the end (ui/sim_*.lua) hold the rest.
local Card=require('ui.card')
local CardFrame=require('ui.card_frame')
local Codec=require('ui.codec')
local Mailbox=require('ui.mailbox')
local Layout=require('ui.sim_layout')
local Screen=require('ui.screen')
local Hud=require('ui.sim_hud')
local Fx=require('ui.sim_fx')
local Popup=require('ui.popup')
local Tooltip=require('ui.tooltip')
local Simulator={};Simulator.__index=Simulator
local prefix=Layout.prefix
function Simulator.new(callbacks)
  local self=setmetatable({callbacks=callbacks,phase='empty',items={},sides={},info={},actions={},cardActions={},cards={},byUid={},ghosts={},piles={},art={},controls={},time=0,focus=0,hover=0,
    message='',title='',hint='',outcome='',outcomeDetail='',gamePhase='',turn=0,turnIndex=0,turnCount=0,waiting='',activePlayer='',viewerSeat='',allow={},
    mode='local',code='',flags={}},Simulator)
  self.hud=Hud.new({feedback=callbacks.sourceFeedback or callbacks.feedback,jiggle=callbacks.jiggle})
  self.tooltip=Tooltip.new()
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
  self.reduced=reduced;self.drag=nil;self.focus=0;self.focusKey=nil;self.focusCard=nil;self.raw=nil;self.previous=nil;self.highlight=nil;self.hoverCard=nil;self.targeting=nil;self.luaTargeting=nil
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
function Simulator:invoke(token)
  if token and token~='' then self:command('invoke',self.revision,token) end
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
    if self.overlay then for _,c in ipairs(self.overlay.cards) do if Card.scanPath(old,c.item,c.item.cardId)~=Card.scanPath(art,c.item,c.item.cardId) then c:rebuild() end end end
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
  local focusedControl=not blocked and not pointed and self.controls[self.focus] or nil
  self.tooltip:update(dt,self:tooltipTarget(blocked,pointed,mx,my),reduced,self.controls,self.cards)
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
      (control and control.action=='pile' and control.owner==p.owner and p.item.kind=='discard') or
      (focusedControl and focusedControl.action=='pile' and focusedControl.owner==p.owner and p.item.kind=='discard'))
    if active and not p.hovered then
      p:juiceUp(time,0.05,0.03,reduced)
      self.callbacks.feedback('paper1',0.9+love.math.random()*0.2)
    end
    p:update(dt,time,active,reduced,self.boardW)
  end
  local _,_,prizeStop=self:stopAt(self.focus)
  self:updatePrizes(dt,time,mx,my,reduced,blocked,not pointed and prizeStop and prizeStop.slot)
  -- Hover popup (card_h_popup) for face-up cards with catalogue info, and for
  -- the keyboard's card while the pointer rests elsewhere.
  self.popup=nil
  local assigningCounters=self.targeting and self.targeting.menu.hideTargetOutline
  local shown=hovered or (not pointed and self.focusCard) or nil
  if shown and shown~=self.highlight and not shown.item.hidden and not self.drag and self.info[shown.item.cardId] and not blocked and not assigningCounters then
    local key=shown.item.owner..':'..shown.item.id..':'..(shown.item.damage or 0)..':'..(shown.item.status or '')
    if self.popupKey~=key then self.popupKey=key;self.popupBox=Popup.build(self.info[shown.item.cardId],shown.item,self.portrait and 236 or 270,self.boardW,true) end
    self.popup=shown
  end
  self:updateKoPresentation(dt,time,reduced)
end
function Simulator:backgroundColours() return self.fx:colours() end
-- The table's parts: each is a set of methods copied onto Simulator, so a part calls the
-- others through `self` and every part reads the same fields.
for _,part in ipairs({
  require('ui.sim_draw'),
  require('ui.sim_drag'),
  require('ui.sim_controls'),
  require('ui.sim_focus'),
  require('ui.sim_targeting'),
  require('ui.sim_juice'),
  require('ui.sim_presence'),
  require('ui.sim_input'),
  require('ui.sim_reconcile'),
}) do
  for name,method in pairs(part) do
    assert(Simulator[name]==nil,'Simulator.'..name..' is defined twice')
    Simulator[name]=method
  end
end
return Simulator
