local D=require('ui.card_dimensions')
-- The table's drawing (audit SM14), mixed into ui/simulator.lua's Simulator: card faces for the
-- card canvases, then each frame's wells, piles, Prizes, cards with their attached cards and
-- badges, the HUD, controls, attached and hover popups, the away banner, juice and overlays.
local T=require('ui.theme')
local Button=require('ui.button')
local CardFrame=require('ui.card_frame')
local CardBack=require('ui.card_back')
local Codec=require('ui.codec')
local Modal=require('ui.modal')
local Dyna=require('ui.dynatext')
local Energy=require('ui.energy')
local Popup=require('ui.popup')
local popupOffset=require('ui.sim_shared').popupOffset
local Simulator={}
local g=love.graphics
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
  self.tooltip:draw(self.boardW,self.boardH,rw)
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
