local D=require('ui.card_dimensions')
-- The table's juice (audit SM14), mixed into ui/simulator.lua's Simulator: the Knock Out
-- presentation's hooks (ui/sim_ko.lua plays it), what a new snapshot changed turned into pops,
-- sounds and the background, and the game-over panel.
local T=require('ui.theme')
local Overlay=require('ui.sim_overlay')
local Simulator={}
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
return Simulator
