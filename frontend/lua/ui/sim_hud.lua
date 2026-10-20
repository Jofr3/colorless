-- The left HUD column: create_UIBox_HUD / create_UIBox_HUD_blind in pixels.
-- Root TRANSPARENT_DARK (0.03 pad) > DYN_UI.MAIN (0.05 pad) > BOSS_DARK (0.08
-- pad), holding the turn panel, the opponent score row, the Active readout
-- (hand_text_area: blue chips cell, red mult cell) and the buttons/counters.
local T=require('ui.theme')
local Button=require('ui.button')
local Dyna=require('ui.dynatext')
local Sprites=require('ui.sprites')
local Hud={};Hud.__index=Hud
local g=love.graphics
-- Colours straight from globals.lua / Blind:change_colour for a non-boss blind:
local BLACK=T.panel                                        -- G.C.BLACK 374244
local function shade(c,k) return {c[1]*k,c[2]*k,c[3]*k,1} end
local function mix(a,b,t) return {a[1]*t+b[1]*(1-t),a[2]*t+b[2]*(1-t),a[3]*t+b[3]*(1-t),1} end
local BOSS_MAIN=shade(BLACK,0.95)                          -- darken(BLACK,0.05): hud cells
local BOSS_DARK={BLACK[1]*0.93+0.07,BLACK[2]*0.93+0.07,BLACK[3]*0.93+0.07,1} -- lighten(BLACK,0.07): column + insets
local HAND_AREA=shade(BLACK,0.9)                           -- darken(BLACK,0.1): hand_text_area
local SMALL=mix(T.blue,BLACK,0.6)                          -- get_blind_main_colour('bl_small')
local SMALL_RED=mix(T.red,BLACK,0.6)                       -- same mix for the second seat
local LIGHT={1,1,1,1}
local MONEY={243/255,185/255,88/255,1}
local IMPORTANT={1,154/255,0,1}
local JOKER_GREY={191/255,199/255,213/255,1}
-- Content height of the desktop column (turn panel to the counter grid); the
-- column itself spans the room and the content sits centred like align 'cm'.
local CONTENT_H=572
local function emboss(x,y,w,h,colour,r,hovered)
  local depth=hovered and 0.5 or 0.7
  Button.panel(x,y+3,w,h,{colour[1]*depth,colour[2]*depth,colour[3]*depth,colour[4] or 1},r or 1.2)
  Button.panel(x,y,w,h,colour,r or 1.2)
end
function Hud.new()
  local self=setmetatable({},Hud)
  self.turnText=Dyna.new({string='Setup',scale=0.64,colours={LIGHT},shadow=true,rotate=true,float=true,silent=true,maxw=230,pop_in=0})
  self.prizeText=Dyna.new({string='6',scale=0.9,colours={T.red},shadow=true,maxw=120})
  -- Hand sizes by seat (the hot-seat table has no fixed "you"): P1 blue, P2 red.
  self.p1HandText=Dyna.new({string='0',scale=0.8,colours={T.blue},shadow=true,rotate=true})
  self.p2HandText=Dyna.new({string='0',scale=0.8,colours={T.red},shadow=true,rotate=true})
  self.turnCount=Dyna.new({string='0',scale=0.88,colours={MONEY},shadow=true,bump=true,spacing=2})
  self.values={};self.inited={}
  self.hint='';self.oppName='';self.allow={};self.hasActive=false
  -- G.C.DYN_UI.MAIN / DARK: the blind colour eased in Blind:change_colour.
  -- Here it follows the seat whose turn it is: p1 blue, p2 red.
  self.dyn=mix(BLACK,BLACK,1);self.dynTarget=self.dyn
  self.dynDark=mix(self.dyn,BLACK,0.4)
  return self
end
-- The blind name slot names the player whose turn it is (the hot-seat table
-- has no fixed "you"), so the header reads "PLAYER 2" in their colour.
local function statusLabel(sim)
  if sim.phase~='ready' then return 'No game' end
  if sim.outcome~='' then return sim.outcome=='win' and 'Victory' or sim.outcome=='loss' and 'Defeat' or 'Draw' end
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
  self.oppName=sim.opponent or ''
  self.activeOwner=sim.activePlayer
  self.allow=sim.allow or {}
  self.hasActive=active~=nil
  self.dynTarget=Hud.seatColour(sim)
end
-- Which seat is acting: the turn owner, else (setup / hot-seat prompts) the
-- viewer. No game is get_blind_main_colour's disabled case: plain BLACK.
function Hud.seatColour(sim)
  if sim.phase~='ready' or sim.viewerSeat=='' then return BLACK end
  local seat=sim.viewerSeat
  if sim.activePlayer=='opponent' then seat=(seat=='p1') and 'p2' or 'p1' end
  return seat=='p2' and SMALL_RED or SMALL
end
function Hud:top(L)
  return L.hud.y+math.floor((L.hud.h-CONTENT_H)/2)
end
function Hud:update(dt,time,reduced)
  -- ease_colour: converge on the target over ~0.3s.
  local k=math.min(1,dt*8)
  for ch=1,3 do self.dyn[ch]=self.dyn[ch]+(self.dynTarget[ch]-self.dyn[ch])*k end
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
  local top=self:top(L)+390
  local ix,iw=x+10,w-20
  return {log={x=x+18,y=top,w=96,h=90,lines={'Game','log'},colour=T.red},
          options={x=x+18,y=top+100,w=96,h=78,lines={'Options'},colour=T.orange},
          cluster={x=ix+8,y=self:top(L)+226+10+8,w=iw-16,h=128}}
end
local function cell(x,y,w,h,label,text,roomWidth,time,reduced)
  -- hud_hands cell: BOSS_MAIN, emboss 0.05, label 0.34 scale, BOSS_DARK inset
  -- holding the number.
  emboss(x,y,w,h,BOSS_MAIN,1.2)
  Dyna.static(label,0.34,x,y+3,w,18,LIGHT,{roomWidth=roomWidth})
  Button.panel(x+6,y+22,w-12,h-28,BOSS_DARK,1.2)
  text:draw(x+w/2,y+22+(h-28)/2,roomWidth)
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
    Dyna.static(line,scale*0.8,x,yy,w,nh,JOKER_GREY,{roomWidth=L.w,shadow=false,fit=true});yy=yy+nh+3
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
  local ix,iw=x+10,w-20
  local cy=self:top(L)
  -- 1. Turn panel (HUD_blind): BLACK, emboss 0.05, header DYN_UI.MAIN row with
  -- the name DynaText, DYN_UI.DARK body with the hint and the prize chip box.
  local th=226
  emboss(ix,cy,iw,th,BLACK,2.4)
  Button.panel(ix+3,cy+3,iw-6,42,shade(self.dyn,0.7),2.4)
  Button.panel(ix+3,cy,iw-6,42,self.dyn,2.4)
  self.turnText.cfg.maxw=230
  self.turnText:draw(ix+iw/2,cy+20,rw)
  -- Prompt instructions occupy the blind's description area.
  local body=cy+48
  Button.panel(ix+3,body,iw-6,th-52,self.dynDark,2.4)
  self:drawPrompt(sim,L,ix+14,body+10,iw-28,th-72)
  cy=cy+th+10
  -- 3. Action panel (hand_text_area's slot): the page draws the turn's
  -- Attack / End turn / Retreat / Abilities buttons inside this dark box.
  do
    local ph=144 -- 8px pad + 44 + 6 + 40 + 6 + 32 + 8px pad
    emboss(ix,cy,iw,ph,HAND_AREA,1.2)
    cy=cy+ph+10
  end
  -- 4. Buttons column (drawn by the page as controls) + counter grid.
  do
    local gx=ix+112
    local gw=iw-112
    local cw=(gw-8)/2
    cell(gx,cy,cw,66,'P1 Hand',self.p1HandText,rw,time,reduced)
    cell(gx+cw+8,cy,cw,66,'P2 Hand',self.p2HandText,rw,time,reduced)
    cy=cy+74
    emboss(gx,cy,gw,60,BOSS_MAIN,1.2)
    Button.panel(gx+6,cy+6,gw-12,48,BOSS_DARK,1.2)
    Dyna.static('Turn',0.3,gx+10,cy+8,50,14,LIGHT,{align='left',roomWidth=rw})
    self.turnCount:draw(gx+gw/2+14,cy+32,rw)
    cy=cy+68
    local function flag(xx,label,on)
      emboss(xx,cy,cw,40,BOSS_MAIN,1.2)
      Dyna.static(label,0.28,xx,cy+3,cw,14,LIGHT,{roomWidth=rw})
      Button.panel(xx+6,cy+18,cw-12,18,on and T.green or BOSS_DARK,1.2)
      Dyna.static(on and 'used' or 'open',0.26,xx,cy+18,cw,18,on and LIGHT or JOKER_GREY,{roomWidth=rw,shadow=on})
    end
    flag(gx,'Energy',self.allow.energy)
    flag(gx+cw+8,'Supporter',self.allow.supporter)
  end
end
function Hud:drawPortrait(sim,L,time,reduced,hovered)
  local x,y,w,h=L.hud.x,L.hud.y,L.hud.w,L.hud.h
  local rw=L.w
  Button.panel(x-2,y-2,w+4,h+4,{34/255,34/255,34/255,34/255/2},2.4)
  Button.panel(x,y,w,h,self.dyn,2.4)
  Button.panel(x+3,y+3,w-6,h-6,BOSS_DARK,2.4)
  local ix=x+10
  emboss(ix,y+10,150,42,self.dyn,1.2)
  self.turnText.cfg.maxw=140
  self.turnText:draw(ix+75,y+30,rw)
  Dyna.static(self.hint,0.26,ix,y+56,230,14,JOKER_GREY,{roomWidth=rw,fit=true,shadow=false})
  local function mini(xx,yy,label,text,colour)
    emboss(xx,yy,64,44,BOSS_MAIN,1.2)
    Dyna.static(label,0.26,xx,yy+2,64,12,LIGHT,{roomWidth=rw})
    Button.panel(xx+4,yy+16,56,24,BOSS_DARK,1.2)
    local keep=text.scale;text.scale=0.5
    text:draw(xx+32,yy+28,rw)
    text.scale=keep
  end
  mini(ix,y+72,'P1 Hand',self.p1HandText)
  mini(ix+70,y+72,'P2 Hand',self.p2HandText)
  mini(ix+140,y+72,'Turn',self.turnCount)
  emboss(ix+166,y+10,70,42,BLACK,1.2)
  Dyna.static('Prizes',0.24,ix+166,y+12,70,12,LIGHT,{roomWidth=rw})
  local keep=self.prizeText.scale;self.prizeText.scale=0.5;self.prizeText:draw(ix+201,y+36,rw);self.prizeText.scale=keep
  self:drawPrompt(sim,L,ix+246,y+58,w-266,h-64)
end
return Hud
