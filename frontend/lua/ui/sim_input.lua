-- The table's input, mixed into ui/simulator.lua's Simulator: what a control does, the overlays
-- it opens (options, inspector, discard pile), Rematch, and the pointer, keyboard and wheel
-- handlers.
local Controls=require('ui.controls')
local Overlay=require('ui.sim_overlay')
local Speech=require('ui.sim_speech')
local Shared=require('ui.sim_shared')
local Simulator={}
local cardKey,groupLabel=Shared.cardKey,Shared.groupLabel
function Simulator:closeOverlay(fromBack)
  if not self.overlay then return end
  local kind=self.overlay.kind
  self.overlay:release();self.overlay=nil
  if fromBack and self.menu and kind==self.menu.kind and not self.menu.mandatory then self:command('dismiss') end
  self:build()
end
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
  elseif a=='pile' then self.callbacks.feedback('cardSlide2',1);self:openPile(b.owner)
  elseif a=='dismiss' then self:command('dismiss')
  elseif a=='cancelTargeting' then self.luaTargeting=nil;self:build()
  elseif a=='inspect' then self:openInspect(b.card)
  elseif a=='cardAction' then self:runCardAction(b.group)
  elseif a=='target' then self:openTargeting({actions=b.group.actions,title=b.group.label..' to which Pokémon?',card=b.card})
  end
end
function Simulator:runCardAction(action)
  if not action or action.disabled then return end
  if action.actions then self:openTargeting({actions=action.actions,title=action.label..' to which Pokémon?'});return end
  self.highlight=nil
  -- Quietly: the card the button leaves would be read as it was before the
  -- action, ahead of the action's own result.
  self:build(true)
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
  local details=Speech.details(self.info[card.item.cardId])
  self.callbacks.announce(Speech.card(card.item,self.info)..'.'..(details~='' and ' '..details or ''))
end
-- The pile tray's title names whose discard it is; the host sends it untitled.
function Simulator:openPile(owner)
  self.pileOwner=owner
  self:command('pile',owner)
end
-- 'Your' or "Misty's".
function Simulator:whose(owner)
  if owner~='opponent' then return 'Your' end
  return (self.opponent or '')~='' and self.opponent.."'s" or "Opponent's"
end
function Simulator:pileTitle(count)
  if not self.pileOwner then return 'Discard pile ('..count..')' end
  return self:whose(self.pileOwner)..' discard ('..count..')'
end
-- Forget any press or drag in progress, as when the window loses focus.
function Simulator:cancelInteractions()
  if self.drag then self.drag.card.dragging=false end
  self.drag=nil;self.clicked=nil;self.pressed=nil;self.pressedOverlay=nil;self.clickedPrize=nil
end
function Simulator:mousepressed(x,y)
  if self.koPresentation or self.counterMotion then return end
  x,y=self:point(x,y);self.focus=0;self.focusCard=nil;self.focusKey=nil
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
    elseif c.item.zone=='discard' then self.callbacks.feedback('cardSlide2',1);self:openPile(c.item.owner)
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
    elseif self.highlight then
      -- Focus returns from the card's buttons to the card.
      local card=self.highlight
      self.highlight=nil;self.focusKey={key=cardKey(card.item)}
      self:build()
      if self.focusCard==card then self.callbacks.announce(self:describeCard(card)) end
    elseif self.targeting and not self.targeting.menu.mandatory then self:command('dismiss')
    else self:openOptions() end
    return
  end
  if key=='tab' or key=='left' or key=='right' or key=='up' or key=='down' then
    local total=self:stopCount();if total==0 then return end
    local focus,found=Controls.cycle(self.focus,Controls.backward(key) and -1 or 1,total,function(i) return self:skipStop(i) end)
    self.focus=focus
    if found then self:setFocus(focus);self.callbacks.announce(self:describeStop(focus)) end
  elseif key=='return' or key=='space' then
    local _,_,prize=self:stopAt(self.focus)
    if self.focusCard then
      local c=self.focusCard
      local target=self:targetFor(c)
      if target then self:selectTarget(c,target)
      elseif self.highlight==c then self.highlight=nil;self:build();self.callbacks.announce(self:describeCard(c))
      else self.highlight=c;self:build();self:focusAttached(c) end
    elseif prize then self.callbacks.feedback('card1',1.1);self:invoke(prize.option.token)
    else self:activate(self.focus) end
  elseif key=='v' and (self.highlight or self.focusCard) then self:openInspect(self.highlight or self.focusCard)
  end
end
function Simulator:wheelmoved(y)
  if self.overlay then self.overlay:wheelmoved(y) end
end
return Simulator
