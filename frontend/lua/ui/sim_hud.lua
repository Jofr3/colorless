-- The left HUD column: create_UIBox_HUD / create_UIBox_HUD_blind in pixels.
-- Root TRANSPARENT_DARK (0.03 pad) > DYN_UI.MAIN (0.05 pad) > BOSS_DARK (0.08
-- pad), holding the turn panel, the opponent score row, the Active readout
-- (hand_text_area: blue chips cell, red mult cell) and the buttons/counters.
local T=require('ui.theme')
local Button=require('ui.button')
local Dyna=require('ui.dynatext')
local Motion=require('ui.motion')
local Hud={};Hud.__index=Hud
local g=love.graphics
-- Colours straight from globals.lua / Blind:change_colour for a non-boss blind:
local BLACK=T.panel                                        -- G.C.BLACK 374244
local function shade(c,k) return {c[1]*k,c[2]*k,c[3]*k,1} end
local function mix(a,b,t) return {a[1]*t+b[1]*(1-t),a[2]*t+b[2]*(1-t),a[3]*t+b[3]*(1-t),1} end
local BOSS_MAIN=shade(BLACK,0.95)                          -- darken(BLACK,0.05): hud cells
local BOSS_DARK={BLACK[1]*0.93+0.07,BLACK[2]*0.93+0.07,BLACK[3]*0.93+0.07,1} -- lighten(BLACK,0.07): column + insets
Hud.insetColour=BOSS_DARK
local HAND_AREA=shade(BLACK,0.9)                           -- darken(BLACK,0.1): hand_text_area
local SMALL=mix(T.blue,BLACK,0.6)                          -- get_blind_main_colour('bl_small')
local SMALL_RED=mix(T.red,BLACK,0.6)                       -- same mix for the second seat
local LIGHT={1,1,1,1}
-- Content height of the desktop column (turn panel to the counter grid); the
-- column itself spans the room and the content sits centred like align 'cm'.
-- create_UIBox_HUD: button column 1.5 + 2*0.2 tiles, counters
-- 2*1.45 + 0.13 tiles, using the same viewport tile size as the sidebar.
local BOTTOM_TILES=1.5+2*0.2+2*1.45+0.13
local SETUP_PAUSE=0.5
local function emboss(x,y,w,h,colour,r,hovered,extrusion)
  local depth=hovered and 0.5 or 0.7
  local shade=Button.shade(colour,depth);shade[4]=colour[4] or 1
  Button.panel(x,y+(extrusion or 3),w,h,shade,r or 1.2)
  Button.panel(x,y,w,h,colour,r or 1.2)
end
function Hud:bottomLayout(L)
  local unit=(L.hud.w-2*L.hud.inset)/BOTTOM_TILES
  local scale=unit/60
  local _,numberH=Dyna.measure('0',0.8)
  local cellH=math.max(1,(0.05*3+0.33)+numberH/60)
  -- UIBox:calculate_xywh includes each column's 0.05-tile emboss in its row.
  local statsH=2*(cellH+2*0.05)+1.15+0.05+2*0.13
  local height=math.max(4.1,statsH)
  local x,y=L.hud.x+L.hud.inset,self:top(L)+246+self:actionPanelHeight()
  return {unit=unit,scale=scale,x=x,y=y,
    buttonX=x+0.2*unit,buttonY=y+(height-4.1)*unit/2+0.2*unit,
    buttonW=1.5*unit,buttonH=1.75*unit,buttonGap=0.2*unit,
    gridX=x+1.9*unit,gridY=y+(height-statsH)*unit/2,
    gridW=3.03*unit,cellW=1.45*unit,cellH=cellH*unit,gap=0.13*unit}
end
-- sync, draw and seatColour take the simulator and only read it: phase,
-- gamePhase, outcome, turn, you, opponent, viewerSeat, activePlayer, waiting,
-- mode, title, hint, sides, items, actions, allow, targeting, luaTargeting,
-- reduced and L.
function Hud.new(callbacks)
  local self=setmetatable({},Hud)
  self.callbacks=callbacks or {}
  self.panelMotion=Motion.new(0,0)
  self.turnText=Dyna.new({string='Setup',scale=0.64,colours={LIGHT},shadow=true,rotate=true,float=true,silent=true,maxw=230,pop_in=0})
  self.prizeText=Dyna.new({string='6',scale=0.9,colours={T.red},shadow=true,maxw=120})
  -- Hand sizes by seat (the hot-seat table has no fixed "you"): P1 blue, P2 red.
  self.p1HandText=Dyna.new({string='0',scale=0.8,colours={T.blue},shadow=true,rotate=true,font_offset=true})
  self.p2HandText=Dyna.new({string='0',scale=0.8,colours={T.red},shadow=true,rotate=true,font_offset=true})
  self.turnCount=Dyna.new({string='0',scale=0.88,colours={T.money},shadow=true,bump=true,spacing=2,font_offset=true})
  self.values={};self.inited={}
  self.hint='';self.oppName='';self.allow={};self.hasActive=false
  self.p1Label,self.p2Label='P1 Hand','P2 Hand'
  -- G.C.DYN_UI.MAIN / DARK: the blind colour eased in Blind:change_colour.
  -- Here it follows the seat whose turn it is: p1 blue, p2 red.
  self.dyn=mix(BLACK,BLACK,1);self.dynTarget=self.dyn
  self.dynDark=mix(self.dyn,BLACK,0.4)
  return self
end
function Hud:cancelEntrance()
  self.panelEntrance=nil;self.panelTitleHidden=false;self.departingPrompt=nil
  self.pendingColour=nil;self.choosingFirst=false;self.compactActions=false;self.turnActions=false
  self.panelMotion=Motion.new(0,0)
end
function Hud:setColour(colour,time)
  for ch=1,3 do
    if colour[ch]~=self.dynTarget[ch] then
      self.colourStart={unpack(self.dyn)}
      self.colourTime=time
      self.dynTarget={unpack(colour)}
      return
    end
  end
end
function Hud:entranceFeedback(reduced)
  if not reduced and self.callbacks.jiggle then self.callbacks.jiggle(3) end
  if self.callbacks.feedback then
    self.callbacks.feedback('chips1',math.random()*0.1+0.55,0.42)
    self.callbacks.feedback('gold_seal',math.random()*0.1+1.85,0.26)
  end
end
-- The blind name slot names the player whose turn it is (the hot-seat table
-- has no fixed "you"), so the header reads "PLAYER 2" in their colour.
local function statusLabel(sim)
  if sim.phase~='ready' then return 'No game' end
  if sim.outcome~='' then return sim.outcome=='win' and 'Victory' or sim.outcome=='loss' and 'Defeat' or 'Draw' end
  if sim.gamePhase=='setup:chooseFirst' then return 'Setup phase' end
  local viewer=sim.you or 'Player'
  if sim.gamePhase:sub(1,6)=='setup:' then return viewer..' setup' end
  if sim.gamePhase=='ko:takePrizes' or sim.gamePhase=='ko:promote' then return sim.waiting=='you' and viewer or 'Waiting' end
  if sim.activePlayer=='you' then return viewer end
  if sim.activePlayer=='opponent' then return sim.opponent or 'Opponent' end
  return viewer
end
-- Pull live numbers; DynaTexts re-pop when their string changes, and a
-- change in HP or prizes pulses the number like ease_chips/ease_dollars.
function Hud:sync(sim,time)
  local choosingFirst=sim.phase=='ready' and sim.gamePhase=='setup:chooseFirst'
  local enteringSetup=self.choosingFirst and sim.phase=='ready'
    and sim.gamePhase~='setup:chooseFirst' and sim.gamePhase:sub(1,6)=='setup:'
  if choosingFirst or sim.phase~='ready' or sim.gamePhase:sub(1,6)~='setup:' then
    self:cancelEntrance()
  elseif enteringSetup and not sim.reduced and not (sim.L and sim.L.portrait) then
    -- select_blind pops both prompt lines out at rate 5 and lifts their box
    -- ten tiles. Shorten the source's 0.8s pre-entrance pause to 0.5s.
    local title=Dyna.new({string=self.turnText.string,scale=0.64,colours={LIGHT},
      shadow=true,rotate=true,float=true,silent=true,maxw=230})
    local subtitle=Dyna.new({string=self.setupSubtitle or '',scale=0.34,colours={LIGHT},
      shadow=true,silent=true,font_offset=true,maxw=sim.L and sim.L.hud.w-40 or 230})
    title:pop_out(5,time);subtitle:pop_out(5,time)
    self.departingPrompt={title=title,subtitle=subtitle,motion=Motion.new(0,0),start=time}
    self.departingPrompt.motion.T.y=-10
    -- Blind:set_blind holds the panel above its slot for 0.05s, then
    -- reveals the name and fires the impact another 0.15s later.
    self.panelMotion=Motion.new(0,-10)
    self.panelEntrance={start=time,revealed=false}
    self.panelTitleHidden=true
  elseif enteringSetup then
    self:cancelEntrance()
    self:entranceFeedback(sim.reduced)
  end
  local you=sim.sides.you or {deck=0,prizes=0,hand=0,discard=0}
  local opp=sim.sides.opponent or {deck=0,prizes=0,hand=0,discard=0}
  local active
  for _,c in ipairs(sim.items) do if c.owner=='you' and c.zone=='active' then active=c end end
  local function set(text,value,pulse)
    local v=tostring(value)
    if self.values[text]~=v then
      self.values[text]=v
      text:set(v,time)
      if pulse and self.inited[text] then text:pulse(0.5,time) end
      self.inited[text]=true
    end
  end
  set(self.turnText,statusLabel(sim))
  set(self.prizeText,you.prizes,true)
  local p1,p2=you,opp
  if sim.viewerSeat=='p2' then p1,p2=opp,you end
  set(self.p1HandText,p1.hand,true)
  set(self.p2HandText,p2.hand,true)
  set(self.turnCount,sim.turn or 0,true)
  self.hint=sim.hint or ''
  self.setupSubtitle=sim.title or ''
  self.choosingFirst=choosingFirst
  local actions=sim.actions or {}
  self.compactActions=choosingFirst or (#actions==1 and actions[1].label=='Ready')
  self.turnActions=sim.gamePhase=='turn:action'
  self.oppName=sim.opponent or ''
  -- Online the viewer's seat is fixed: name the hands instead of the seats.
  if sim.mode=='online' then
    local mine,theirs='Your hand',self.oppName~='' and self.oppName or 'Opponent'
    if sim.viewerSeat=='p2' then self.p1Label,self.p2Label=theirs,mine else self.p1Label,self.p2Label=mine,theirs end
  else self.p1Label,self.p2Label='P1 Hand','P2 Hand' end
  self.activeOwner=sim.activePlayer
  self.allow=sim.allow or {}
  self.hasActive=active~=nil
  local colour=Hud.seatColour(sim)
  if self.panelEntrance and not self.panelEntrance.colourStarted then
    self.pendingColour=colour
  else self:setColour(colour,time) end
  if enteringSetup and sim.reduced then
    self.turnText.popIn=nil
    for _,letter in ipairs(self.turnText.letters) do letter.pop=1 end
  end
end
-- Which seat is acting: the turn owner, else (setup / hot-seat prompts) the
-- viewer. Before choosing the first player (or without a game), use neutral grey.
function Hud.seatColour(sim)
  if sim.phase~='ready' or sim.viewerSeat=='' or sim.gamePhase=='setup:chooseFirst' then return BLACK end
  local seat=sim.viewerSeat
  if sim.activePlayer=='opponent' then seat=(seat=='p1') and 'p2' or 'p1' end
  return seat=='p2' and SMALL_RED or SMALL
end
function Hud:actionPanelHeight()
  return self.compactActions and 60 or (self.turnActions and 120 or 144)
end
function Hud:top(L)
  local contentH=246+self:actionPanelHeight()+4.1*(L.hud.unit or 60)
  return L.hud.y+math.floor((L.hud.h-contentH)/2)
end
function Hud:update(dt,time,reduced)
  local entrance=self.panelEntrance
  local prompt=self.departingPrompt
  if prompt then
    if reduced or time>=prompt.start+0.2 then self.departingPrompt=nil
    else
      prompt.motion:update(dt,time,false,false,false)
      prompt.title:update(time,false);prompt.subtitle:update(time,false)
    end
  end
  if entrance then
    if not entrance.colourStarted and (reduced or time>=entrance.start+SETUP_PAUSE) then
      entrance.colourStarted=true
      if self.pendingColour then
        self:setColour(self.pendingColour,reduced and time or entrance.start+SETUP_PAUSE)
        self.pendingColour=nil
      end
    end
    if reduced then
      self.panelMotion.T.y=0
      self.panelEntrance=nil;self.panelTitleHidden=false
      self.turnText.popIn=nil
      for _,letter in ipairs(self.turnText.letters) do letter.pop=1 end
      if not entrance.revealed then self:entranceFeedback(true) end
    else
      if time>=entrance.start+SETUP_PAUSE+0.05 then self.panelMotion.T.y=0 end
      if not entrance.revealed and time>=entrance.start+SETUP_PAUSE+0.2 then
        entrance.revealed=true;self.panelTitleHidden=false
        self.turnText:set(self.turnText.string,time,true)
        self:entranceFeedback(false)
      end
    end
  end
  self.panelMotion:update(dt,time,false,false,reduced)
  if entrance and entrance.revealed and self.panelMotion.VT.y==0 then self.panelEntrance=nil end
  -- ease_colour / ease_value use a linear REAL-clock interpolation over 0.3s.
  if self.colourStart then
    local k=math.min(1,math.max(0,(time-self.colourTime)/0.3))
    for ch=1,3 do self.dyn[ch]=self.colourStart[ch]+(self.dynTarget[ch]-self.colourStart[ch])*k end
    if k==1 then self.colourStart=nil end
  end
  self.dynDark=mix(self.dyn,BLACK,0.4)
  for _,t in ipairs({self.turnText,self.prizeText,self.p1HandText,self.p2HandText,self.turnCount}) do t:update(time,reduced) end
end
-- Button rectangles the page registers as controls (Run Info / Options).
function Hud:buttons(L)
  local x,y,w=L.hud.x,L.hud.y,L.hud.w
  if L.portrait then
    return {log={x=x+w-150,y=y+8,w=68,h=46,label='Log',colour=T.red,fontSize=20},
            options={x=x+w-76,y=y+8,w=68,h=46,label='Options',colour=T.orange,fontSize=16}}
  end
  local ix,iw=x+L.hud.inset,w-2*L.hud.inset
  local b=self:bottomLayout(L)
  local verticalPad=self.compactActions and 6 or 8
  return {log={x=b.buttonX,y=b.buttonY,w=b.buttonW,h=b.buttonH,lines={'Game','log'},lineScales={0.48*b.scale,0.4*b.scale},lineWidth=1.4*b.unit,colour=T.red},
          options={x=b.buttonX,y=b.buttonY+b.buttonH+b.buttonGap,w=b.buttonW,h=b.buttonH,lines={'Options'},lineScales={0.4*b.scale},lineWidth=1.4*b.unit,colour=T.orange},
          cluster={x=ix+8,y=self:top(L)+226+10+verticalPad,w=iw-16,h=self:actionPanelHeight()-2*verticalPad}}
end
local function cell(x,y,b,label,text,roomWidth,on)
  local u,s=b.unit,b.scale
  local w,h=b.cellW,b.cellH
  local labelH=0.33*u
  local valueY=y+0.05*u+labelH+0.05*u
  local valueH=h-labelH-0.15*u
  -- Source hud_hands / hud_ante: 0.05 padding, 0.33 label row, 1.2 inset.
  emboss(x,y,w,h,BOSS_MAIN,1.8*s,nil,0.05*u)
  Dyna.static(label,0.34*s,x,y+0.05*u,w,labelH,LIGHT,{roomWidth=roomWidth,fit=true})
  Button.panel(x+(w-1.2*u)/2,valueY,1.2*u,valueH,on and T.green or BOSS_DARK,1.8*s)
  if type(text)=='string' then
    Dyna.static(text,0.4*s,x,valueY,w,valueH,on and LIGHT or T.jokerGrey,{roomWidth=roomWidth,fit=true})
  else
    g.push();g.translate(x+w/2,valueY+valueH/2);g.scale(s)
    text:draw(0,0,roomWidth,nil,x+w/2)
    g.pop()
  end
end
-- Wrap the entire prompt inside the HUD instead of covering board targets.
function Hud:drawPrompt(sim,L,x,y,w,h)
  local prompt=sim.targeting and sim.targeting.menu or sim.luaTargeting
  if not prompt then return end
  local title=prompt.title or ''
  local note=prompt.note and prompt.note~='' and prompt.note or 'Click a highlighted card'
  local scale=L.portrait and 0.27 or 0.4
  local titles,notes,th,nh
  repeat
    titles,th=Dyna.wrap(title,scale,w)
    notes,nh=Dyna.wrap(note,scale*0.8,w)
    if #titles*(th+3)+8+#notes*(nh+3)<=h or scale<=0.16 then break end
    scale=scale-0.01
  until false
  local height=#titles*(th+3)+8+#notes*(nh+3)
  local yy=y+math.max(0,(h-height)/2)
  for _,line in ipairs(titles) do
    Dyna.static(line,scale,x,yy,w,th,LIGHT,{roomWidth=L.w,fit=true});yy=yy+th+3
  end
  yy=yy+8
  for _,line in ipairs(notes) do
    Dyna.static(line,scale*0.8,x,yy,w,nh,T.jokerGrey,{roomWidth=L.w,shadow=false,fit=true});yy=yy+nh+3
  end
end
function Hud:draw(sim,L,time,reduced,hovered)
  local x,y,w,h=L.hud.x,L.hud.y,L.hud.w,L.hud.h
  local rw=L.w
  if L.portrait then return self:drawPortrait(sim,L,time,reduced,hovered) end
  -- Root TRANSPARENT_DARK > DYN_UI.MAIN frame (0.05 tile) > BOSS_DARK column
  -- running past the room edges, so the frame reads as two side lines in the
  -- turn seat's colour.
  Button.panel(x-2,y-2,w+4,h+4,{34/255,34/255,34/255,34/255/2},2.4)
  Button.panel(x,y,w,h,self.dyn,6)
  Button.panel(x+3,y+3,w-6,h-6,BOSS_DARK,6)
  local ix,iw=x+L.hud.inset,w-2*L.hud.inset
  local cy=self:top(L)
  -- 1. Turn panel (HUD_blind): BLACK, emboss 0.05, header DYN_UI.MAIN row with
  -- the name DynaText, DYN_UI.DARK body with the hint and the prize chip box.
  local th=226
  local choosingFirst=sim.phase=='ready' and sim.gamePhase=='setup:chooseFirst'
  g.push()
  g.translate(0,self.panelMotion.VT.y*L.hud.unit)
  if not choosingFirst then
    emboss(ix,cy,iw,th,BLACK,2.4)
    Button.panel(ix+3,cy+3,iw-6,42,shade(self.dyn,0.7),2.4)
    Button.panel(ix+3,cy,iw-6,42,self.dyn,2.4)
  end
  self.turnText.cfg.maxw=230
  if not self.panelTitleHidden then
    self.turnText:draw(ix+iw/2,cy+(choosingFirst and th/2-18 or 20),rw)
  end
  -- Prompt instructions occupy the blind's description area.
  local body=cy+48
  if not choosingFirst then Button.panel(ix+3,body,iw-6,th-52,self.dynDark,2.4) end
  if choosingFirst then
    -- Online only a rematch's loser chooses, so the hint says why on both sides.
    local line=(#(sim.actions or {})==0 or sim.mode=='online') and (sim.hint or '')~='' and sim.hint or sim.title
    Dyna.static(line,0.34,ix+14,cy+th/2+10,iw-28,24,LIGHT,{roomWidth=rw,fit=true})
  elseif not self.panelTitleHidden then
    self:drawPrompt(sim,L,ix+14,body+10,iw-28,th-72)
  end
  g.pop()
  local prompt=self.departingPrompt
  if prompt then
    -- Keep the outgoing text at its old compact-action-panel origin.
    local oldTop=y+math.floor((h-246-60-4.1*L.hud.unit)/2)
    g.push();g.translate(0,prompt.motion.VT.y*L.hud.unit)
    prompt.title:draw(ix+iw/2,oldTop+th/2-18,rw)
    prompt.subtitle:draw(ix+iw/2,oldTop+th/2+22,rw)
    g.pop()
  end
  cy=cy+th+10
  -- 3. Action panel (hand_text_area's slot): the page draws the turn's
  -- Attack / End turn / Retreat / Abilities buttons inside this dark box.
  do
    local ph=self:actionPanelHeight()
    emboss(ix,cy,iw,ph,HAND_AREA,1.2)
    cy=cy+ph+10
  end
  -- 4. Buttons column (drawn by the page as controls) + counter grid.
  do
    local b=self:bottomLayout(L)
    local u,s=b.unit,b.scale
    local gx,gy,gw=b.gridX,b.gridY,b.gridW
    cell(gx,gy,b,self.p1Label,self.p1HandText,rw)
    cell(gx+b.cellW+b.gap,gy,b,self.p2Label,self.p2HandText,rw)
    gy=gy+b.cellH+0.1*u+b.gap
    emboss(gx,gy,gw,1.15*u,BOSS_MAIN,1.8*s,nil,0.05*u)
    Button.panel(gx+(gw-2.69*u)/2,gy+0.075*u,2.69*u,u,BOSS_DARK,1.8*s)
    local labelW=Dyna.measure('Turn',0.34*s)
    local totalW=labelW+0.1*u+self.turnCount.W*s
    local textX=gx+(gw-totalW)/2
    Dyna.static('Turn',0.34*s,textX,gy,labelW,1.15*u,LIGHT,{roomWidth=rw})
    local countX=textX+labelW+0.1*u+self.turnCount.W*s/2
    g.push();g.translate(countX,gy+1.15*u/2);g.scale(s)
    self.turnCount:draw(0,0,rw,nil,countX)
    g.pop()
    gy=gy+1.2*u+b.gap
    -- A frame without allowances only lets the Supporter one be derived; drop Energy.
    if self.allow.partial then
      cell(gx+(gw-b.cellW)/2,gy,b,'Supporter',self.allow.supporter and 'used' or 'open',rw,self.allow.supporter)
    else
      cell(gx,gy,b,'Energy',self.allow.energy and 'used' or 'open',rw,self.allow.energy)
      cell(gx+b.cellW+b.gap,gy,b,'Supporter',self.allow.supporter and 'used' or 'open',rw,self.allow.supporter)
    end
  end
end
function Hud:drawPortrait(sim,L,time,reduced,hovered)
  local x,y,w,h=L.hud.x,L.hud.y,L.hud.w,L.hud.h
  local rw=L.w
  Button.panel(x-2,y-2,w+4,h+4,{34/255,34/255,34/255,34/255/2},2.4)
  Button.panel(x,y,w,h,self.dyn,2.4)
  Button.panel(x+3,y+3,w-6,h-6,BOSS_DARK,2.4)
  local ix=x+10
  local choosingFirst=sim.phase=='ready' and sim.gamePhase=='setup:chooseFirst'
  if not choosingFirst then
    emboss(ix,y+10,150,42,self.dyn,1.2)
  end
  self.turnText.cfg.maxw=140
  self.turnText:draw(ix+75,y+30,rw)
  Dyna.static(self.hint,choosingFirst and 0.24 or 0.26,ix,y+56,230,14,T.jokerGrey,{roomWidth=rw,fit=true,shadow=false})
  local function mini(xx,yy,label,text,colour)
    emboss(xx,yy,64,44,BOSS_MAIN,1.2)
    Dyna.static(label,0.26,xx,yy+2,64,12,LIGHT,{roomWidth=rw,fit=true})
    Button.panel(xx+4,yy+16,56,24,BOSS_DARK,1.2)
    local keep=text.scale;text.scale=0.5
    text:draw(xx+32,yy+28,rw)
    text.scale=keep
  end
  mini(ix,y+72,self.p1Label,self.p1HandText)
  mini(ix+70,y+72,self.p2Label,self.p2HandText)
  mini(ix+140,y+72,'Turn',self.turnCount)
  emboss(ix+166,y+10,70,42,BLACK,1.2)
  Dyna.static('Prizes',0.24,ix+166,y+12,70,12,LIGHT,{roomWidth=rw})
  local keep=self.prizeText.scale;self.prizeText.scale=0.5;self.prizeText:draw(ix+201,y+36,rw);self.prizeText.scale=keep
  self:drawPrompt(sim,L,ix+246,y+58,w-266,h-64)
end
return Hud
