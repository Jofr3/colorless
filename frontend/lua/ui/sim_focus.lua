-- The table's keyboard focus, mixed into ui/simulator.lua's Simulator: the ring's stops and
-- their keys, focus kept across a rebuild, and what the screen reader says for a stop.
local Speech=require('ui.sim_speech')
local Simulator={}
local cardKey=require('ui.sim_shared').cardKey
-- The keyboard ring: the controls, then the face-up cards, then, while a Prize
-- prompt is open, the face-down Prize slots it can take. A focused stop is
-- remembered by key, so a rebuilt list (every snapshot) keeps it in place.
function Simulator:buildPrizeStops()
  self.prizeStops={}
  local menu=self.targeting and self.targeting.menu
  if not menu or menu.kind~='prizes' then return end
  local faceUp={}
  for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='prize' then faceUp[c.item.index]=true end end
  local count=(self.sides.you or {prizes=0}).prizes
  for i=0,count-1 do
    for _,o in ipairs(menu.options) do
      if o.uid=='prize:'..i and not o.disabled and not faceUp[i] then self.prizeStops[#self.prizeStops+1]={slot=i,count=count,option=o} end
    end
  end
end
function Simulator:stopCount() return #self.controls+#self.cards+#(self.prizeStops or {}) end
function Simulator:stopAt(i)
  local n,m=#self.controls,#self.cards
  if i<1 then return nil end
  if i<=n then return self.controls[i] end
  if i<=n+m then return nil,self.cards[i-n] end
  return nil,nil,(self.prizeStops or {})[i-n-m]
end
-- Discard piles answer the keyboard though they draw no button of their own.
function Simulator:skipStop(i)
  local b,c,p=self:stopAt(i)
  if b then return b.disabled or (b.invisible and b.action~='pile') or false end
  if c then return c.item.hidden or c.drawAfterPromotion~=nil end
  return p==nil
end
function Simulator:keyAt(i)
  local b,c,p=self:stopAt(i)
  if b then return 'control:'..b.action..':'..b.label..':'..(b.owner or ''),b.attached and b.card and cardKey(b.card.item) end
  if c then return cardKey(c.item) end
  if p then return 'prize:'..p.slot end
end
function Simulator:setFocus(i)
  self.focus=i
  local key,fallback=self:keyAt(i)
  self.focusKey=key and {key=key,fallback=fallback} or nil
  local _,c=self:stopAt(i)
  self.focusCard=c
end
function Simulator:findStop(key)
  for i=1,self:stopCount() do if not self:skipStop(i) and self:keyAt(i)==key then return i end end
end
-- After a rebuild: the same stop, else the card an attached button belonged
-- to (announced, since focus moved, unless `quiet`), else nothing.
function Simulator:restoreFocus(quiet)
  local want=self.focusKey
  if not want and self.focusCard then want={key=cardKey(self.focusCard.item)} end
  if not want then
    if self.focus>self:stopCount() then self.focus=0 end
    return
  end
  local found=self:findStop(want.key)
  if found then self:setFocus(found);return end
  found=want.fallback and self:findStop(want.fallback)
  if found then
    self:setFocus(found)
    if not quiet then self.callbacks.announce(self:describeStop(found)) end
    return
  end
  self.focus=0;self.focusKey=nil;self.focusCard=nil
end
function Simulator:describeCard(c)
  local text=Speech.card(c.item,self.info)
  if c==self.highlight then text=text..', selected' end
  if self:isCandidate(c) then text=text..', can be chosen' end
  return text
end
function Simulator:retreatReason(b)
  return Speech.retreatReason(self,b.card.item,b.cost)
end
function Simulator:describeStop(i)
  local b,c,p=self:stopAt(i)
  if c then return self:describeCard(c) end
  if p then return 'Prize '..(p.slot+1)..' of '..p.count..(p.option.selected and ', selected' or '') end
  if not b then return '' end
  if b.action=='pile' then
    local count=(self.sides[b.owner] or {}).discard or 0
    return self:whose(b.owner)..' discard pile, '..count..(count==1 and ' card' or ' cards')
  end
  local text=b.attached and Speech.control(b) or b.label
  if b.attached and b.disabled and b.retreat then text=text..', unavailable: '..self:retreatReason(b) end
  return text
end
-- Enter on a card shows its buttons and focuses the first one that works;
-- the ones that do not are read with it.
function Simulator:focusAttached(card)
  local first
  local unavailable={}
  for i,b in ipairs(self.controls) do
    if b.attached and b.card==card then
      if not b.disabled then first=first or i
      else unavailable[#unavailable+1]=b.retreat and b.label..', '..self:retreatReason(b) or b.label end
    end
  end
  if not first then self.callbacks.announce(self:describeCard(card));return end
  self:setFocus(first)
  local text=self:describeStop(first)
  if #unavailable>0 then text=text..'. Unavailable: '..table.concat(unavailable,'; ') end
  self.callbacks.announce(text)
end
return Simulator
