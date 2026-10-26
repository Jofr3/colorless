local D=require('ui.card_dimensions')
-- The Knock Out presentation, played on the old table: each knocked-out
-- Pokémon burns in engine order together with its attached cards, then the
-- awarded Prizes fly into their hands during a half-second pause. The
-- simulator holds the destination snapshot until `update` reports the end.
local T=require('ui.theme')
local Dissolve=require('ui.dissolve')
local Layout=require('ui.sim_layout')
local Ko={};Ko.__index=Ko
-- The table's in-play cards that a snapshot knocks out, in engine order.
function Ko.victims(model,cards)
  local victims={}
  for _,uid in ipairs(model.knockedOut) do
    for _,c in ipairs(cards) do
      if c.item.id==uid and (c.item.zone=='active' or c.item.zone=='bench') then victims[#victims+1]=c end
    end
  end
  return victims
end
function Ko.begin(sim,raw,model,cards)
  local self=setmetatable({sim=sim,raw=raw,model=model,cards=cards,index=0},Ko)
  self:next()
  return self
end
-- A newer destination snapshot replaces the held one without restarting burns.
function Ko:retarget(raw,model) self.raw,self.model=raw,model end
-- Undo or reload puts a knocked-out Pokémon back in play.
function Ko:returned(model)
  for _,it in ipairs(model.items) do
    if it.zone=='active' or it.zone=='bench' then
      for _,c in ipairs(self.cards) do if it.id==c.item.id then return true end end
    end
  end
  return false
end
function Ko:cancel()
  for _,c in ipairs(self.prizeCards or {}) do c.texture:release() end
  for _,c in ipairs(self.cards) do
    for _,a in ipairs(c.koAttachments or {}) do
      a.dissolve=nil;a.burn1=nil;a.burn2=nil;a.disintegration=nil;a.motion.juice=nil
    end
    c.koAttachments=nil
    c.koAnimating=nil;c.koHidden=nil;c.dissolve=nil;c.burn1=nil;c.burn2=nil;c.disintegration=nil;c.motion.juice=nil
  end
end
-- Card uids, attachments included, whose discard needs no second departure.
function Ko:completed()
  local completed={}
  for _,card in ipairs(self.cards) do
    completed[card.item.id]=true
    for _,a in ipairs(card.koAttachments or {}) do completed[a.item.id]=true end
  end
  return completed
end
function Ko:next()
  local sim=self.sim
  self.index=self.index+1
  local c=self.cards[self.index]
  if not c then
    self.waitUntil=sim.time+0.5
    self:beginPrizes()
    return
  end
  c.koAnimating=true;c.hovered=false;c.held=nil;c.lift=0;c.tint=nil
  c.homeX,c.homeY=c.x,c.y;c.motion.T.r=c.angle
  c.motion.velocity.x,c.motion.velocity.y=0,0
  c.koAttachments={}
  sim:eachAttached(c,function(a,x,y,scale,angle)
    a:place(x,y,scale,false)
    a.motion.T.r,a.motion.VT.r,a.angle=angle,angle,angle
    a.ambientTilt=0
    a.disintegration=Dissolve.new(a,sim.time)
    c.koAttachments[#c.koAttachments+1]=a
  end)
  c.disintegration=Dissolve.new(c,sim.time)
  sim.callbacks.feedback('whoosh2',0.9+love.math.random()*0.2,0.5)
  sim.callbacks.feedback('crumple'..(math.floor(love.math.random()*5)+1),0.9+love.math.random()*0.2,0.5)
  sim.fx:attention({text='KNOCKED OUT',scale=0.75,colour=T.white,backdrop=T.red,x=c.x,y=c.y-0.6*D.H*c.baseScale,hold=0.4,jiggle=1.5})
end
function Ko:beginPrizes()
  local sim=self.sim
  self.prizes={};self.prizeStart=sim.time
  -- The destination snapshot may already face the next player. Map its
  -- public pile counts back onto the table that is still being presented.
  local flipped=self.model.viewerSeat~=sim.viewerSeat
  for owner,destination in pairs(self.model.sides) do
    if flipped then owner=owner=='you' and 'opponent' or 'you' end
    local side=sim.sides[owner]
    local taken=side and side.prizes-destination.prizes or 0
    if taken>0 then
      self.prizes[owner]={count=taken,prizesBefore=side.prizes,handCount=side.hand+taken,handBefore=side.hand}
    end
  end
  self:createPrizeCards()
end
function Ko:award(owner) return self.prizes and self.prizes[owner] end
function Ko:prizeTaken(owner,index)
  local award=self:award(owner)
  return award and index>=award.prizesBefore-award.count and index<award.prizesBefore
end
function Ko:createPrizeCards(silent)
  local sim=self.sim
  for _,c in ipairs(self.prizeCards or {}) do c.texture:release() end
  self.prizeCards={}
  for _,owner in ipairs({'opponent','you'}) do
    local award=self.prizes[owner]
    if award then
      local source=sim.L.zones[Layout.prefix(owner)..'prizes']
      local hand=sim.L.zones[Layout.prefix(owner)..'hand']
      for i=0,award.count-1 do
        local sx,sy=Layout.prize(source,award.prizesBefore-1-i)
        local c=sim:newCard({id='ko-prize-'..owner..i,cardId='',hidden=true,owner=owner},i,sx,sy,hand.scale)
        c.homeX,c.homeY,c.motion.T.r=Layout.hand(hand,award.handCount,award.handBefore+i)
        if owner=='opponent' then c.motion.T.r=-c.motion.T.r;c.homeY=hand.y-(c.homeY-hand.y) end
        c.angle=0;c.ambientTilt=0
        c.motion.VT.scale=source.scale/hand.scale
        c.prizeIndex=i;c.flightElapsed=0;c.flightSound=silent
        c.flightDelay=award.count>1 and 0.06*i/(award.count-1) or 0
        self.prizeCards[#self.prizeCards+1]=c
      end
    end
  end
end
function Ko:updatePrizes(time)
  for _,c in ipairs(self.prizeCards or {}) do
    local elapsed=math.max(0,math.min(0.5,time-self.prizeStart-c.flightDelay))
    if elapsed>0 and not c.flightSound then
      -- use_card's Standard Pack branch: emplace the card, then these sounds.
      self.sim.callbacks.feedback('card1',0.8,0.6)
      self.sim.callbacks.feedback('generic1',1)
      c.flightSound=true
    end
    -- CardArea:emplace changes the target. The shared Balatro Moveable handles
    -- translation, velocity-driven banking and scale; there is no custom arc.
    while c.flightElapsed<elapsed do
      local dt=math.min(1/60,elapsed-c.flightElapsed)
      c.flightElapsed=c.flightElapsed+dt
      c:update(dt,self.prizeStart+c.flightDelay+c.flightElapsed,false,false)
    end
  end
end
function Ko:prizePosition(owner,index)
  for _,c in ipairs(self.prizeCards or {}) do
    if c.item.owner==owner and c.prizeIndex==index then
      return c.x,c.y,c.baseScale*c.motion.VT.scale,c.angle
    end
  end
end
-- A resize rebuilds the flying Prizes at their new geometry, already sounded.
function Ko:layout()
  if not self.prizes then return end
  self:createPrizeCards(true)
  self:updatePrizes(self.sim.time)
end
-- True once the presentation is over and the held snapshot should apply.
function Ko:update(dt,time,reduced)
  local c=self.cards[self.index]
  if c and not reduced then
    for _,a in ipairs(c.koAttachments) do
      a.disintegration:update(a,dt,time)
      a:update(dt,time,false,false)
    end
  end
  if c and not reduced and c.disintegration:update(c,dt,time) then
    c.koAnimating=nil;c.koHidden=true
    self:next()
  end
  if self.prizes and not reduced then self:updatePrizes(time) end
  return reduced or (self.waitUntil~=nil and time>=self.waitUntil)
end
function Ko:draw(shaders,rw)
  local sim=self.sim
  local c=self.cards[self.index]
  if c then
    if shaders then
      for _,a in ipairs(c.koAttachments) do
        a:draw(shaders,sim.time,sim.mx or 0,sim.my or 0,sim.reduced,rw)
        a.disintegration:draw(a)
      end
    else sim:drawAttached(c) end
    c:draw(shaders,sim.time,sim.mx or 0,sim.my or 0,sim.reduced,rw)
    c.disintegration:draw(c)
  end
  for _,p in ipairs(self.prizeCards or {}) do
    p:draw(shaders,sim.time,0,0,sim.reduced,rw)
  end
end
return Ko
