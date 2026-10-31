local D=require('ui.card_dimensions')
-- The table's controls (audit SM14), mixed into ui/simulator.lua's Simulator: the HUD and action
-- cluster buttons, pile clicks, targeting footers and the highlighted card's attached popup,
-- rebuilt from the snapshot, with their phone hit areas and pointer hit tests.
local T=require('ui.theme')
local Button=require('ui.button')
local Motion=require('ui.motion')
local Dyna=require('ui.dynatext')
local Hud=require('ui.sim_hud')
local Display=require('ui.display')
local HitArea=require('ui.hit_area')
local Shared=require('ui.sim_shared')
local Simulator={}
local groupLabel,popupOffset=Shared.groupLabel,Shared.popupOffset
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
function Simulator:build(quiet)
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
    local count=(self.sides[owner] or {}).discard or 0
    if z then self:add('',z.well.x,z.well.y,z.well.w,z.well.h,'pile',nil,{owner=owner,invisible=true,disabled=self.phase~='ready' or count==0}) end
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
  self:inflateTargets()
  self:buildPrizeStops()
  self:restoreFocus(quiet)
end
-- On a phone the table's small buttons answer over a larger invisible area around their unchanged
-- faces (audit LC4 (b), QA11): about 44 CSS px where the table draws under 0.7 CSS px per board
-- px (a phone held sideways), 24 CSS px on a phone held upright. The HUD's buttons stay in the HUD
-- column; no area reaches a card or another control.
function Simulator:inflateTargets()
  local zoom=Display.scale*self.zoom
  if zoom>=1 then return end
  local size=(zoom<0.7 and 44 or 24)/zoom
  local cards={}
  for _,c in ipairs(self.cards) do
    local s=c.baseScale or 1
    cards[#cards+1]={x=c.homeX-D.HALF_W*s,y=c.homeY-D.HALF_H*s,w=D.W*s,h=D.H*s}
  end
  local hud,attached={},{}
  for _,b in ipairs(self.controls) do
    if not b.invisible then if b.attached then attached[#attached+1]=b else hud[#hud+1]=b end end
  end
  local L=self.L
  local board={x=0,y=0,w=self.boardW,h=self.boardH}
  HitArea.inflate(hud,size,size,self.controls,cards,L.portrait and board or {x=L.hud.x,y=0,w=L.hud.w,h=self.boardH})
  -- A popup over a card already takes the pointer there: its buttons grow only inside it.
  local popup=self.attachedPopup
  local over=false
  for _,c in ipairs(cards) do over=over or (popup and HitArea.overlaps(popup,c)) end
  HitArea.inflate(attached,size,size,self.controls,cards,over and popup or board)
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
    else buttons[#buttons+1]={label=a.label,colour=a.colour,token=a.token,disabled=a.disabled,cost=a.cost,damage=a.damage,hasCost=a.hasCost,ability=a.group=='ability',retreat=a.group=='retreat'} end
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
    local added=self:add(b.label,x+pad,buttonY,bw,b.height,action,b.colour,{token=b.token,disabled=b.disabled,fontSize=21,attached=true,card=card,group=b,cost=b.cost,damage=b.damage,hasCost=b.hasCost,ability=b.ability,retreat=b.retreat})
    self.attachedPopup.buttons[#self.attachedPopup.buttons+1]=added
    buttonY=buttonY+b.height+gap
    if b.disabled then added.colour=T.grey end -- not the panel black
  end
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
return Simulator
