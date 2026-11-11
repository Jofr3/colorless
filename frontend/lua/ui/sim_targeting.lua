local D=require('ui.card_dimensions')
-- Targeting on the table, mixed into ui/simulator.lua's Simulator: which cards and Prize slots
-- a host prompt or a grouped card action can pick, the damage-counter transfer's motion, Rare
-- Candy drop targets, and the face-down Prizes' positions and hover motion.
local Card=require('ui.card')
local Motion=require('ui.motion')
local Layout=require('ui.sim_layout')
local Hud=require('ui.sim_hud')
local Speech=require('ui.sim_speech')
local Simulator={}
local prefix=Layout.prefix
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
function Simulator:updatePrizes(dt,time,mx,my,reduced,blocked,focusedSlot)
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
          and (math.abs(mx-x)<=D.HALF_W*z.scale and math.abs(my-y)<=D.HALF_H*z.scale or (owner=='you' and focusedSlot==i))
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
-- A card button that needs a target opens the pick on the table and says its
-- question; the card it leaves is not read, since the pick follows at once.
function Simulator:openTargeting(targeting)
  self.luaTargeting=targeting;self.highlight=nil
  self:build(true)
  self.callbacks.announce(Speech.sentences({targeting.title,Hud.TARGET_NOTE}))
end
return Simulator
