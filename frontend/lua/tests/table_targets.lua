-- The table on small screens (audit LC4 (b), QA11), with every button's face unchanged (the
-- user's rule). Sideways on a phone (under 0.7 CSS px per board px) the HUD's small buttons and a
-- card's attached buttons answer over an invisible area of about 44 CSS px; upright on a phone,
-- 24 CSS px. A hit area never reaches a card or another control. A touch screen held sideways
-- under 0.6 is told to turn upright, in the HUD's empty top band. Upright, the prompt keeps a
-- scale of 0.24 at least and spills its note into a two-line strip over the table's top band,
-- and the HUD's small text is at least 11 CSS px.
package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
local function font()
  return {getWidth=function(_,s) return #tostring(s)*8 end,getHeight=function() return 20 end,
    getWrap=function(_,s,w) local lines={};local line='';for word in tostring(s):gmatch('%S+') do
      if #line+#word+1>w/8 and line~='' then lines[#lines+1]=line;line=word else line=line=='' and word or line..' '..word end end
      if line~='' then lines[#lines+1]=line end;return #s*8,lines end}
end
local image={setFilter=function() end,getWidth=function() return 284 end,getHeight=function() return 380 end,getDimensions=function() return 284,380 end,release=function() end}
local g=setmetatable({
  transformPoint=function(x,y) return x,y end,
  newImage=function() return image end,newQuad=function() return {} end,
  newCanvas=function() return {release=function() end,setFilter=function() end} end,
  newFont=function() return font() end,
},{__index=function() return function() end end})
love={math={random=function() return 0.5 end},graphics=g,keyboard={isDown=function() return false end},filesystem={getInfo=function() return nil end,read=function() return '' end}}
local T=require('ui.theme');T.font=function() return font() end
local Card=require('ui.card');Card.rebuild=function(self) self.texture={release=function() end} end
local Dyna=require('ui.dynatext')
local Display=require('ui.display')
local HitArea=require('ui.hit_area')
local Simulator=require('ui.simulator')
local Hud=require('ui.sim_hud')
local Layout=require('ui.sim_layout')
local function check(ok,message) if not ok then error(message,2) end end
local shader={hasUniform=function() return true end,send=function() end}
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader}
local function read(name) local f=assert(io.open('frontend/lua/tests/fixtures/'..name));local t=f:read('*a');f:close();return t end
local sim=Simulator.new({command=function() end,announce=function() end,feedback=function() end,settings=function() end,jiggle=function() end})
local function frames(n) for _=1,n do sim:update(1/60,(sim.time or 0)+1/60,-100,-100,true);sim:draw(shaders) end end
local function contains(o,i) return o.x<=i.x and o.y<=i.y and o.x+o.w>=i.x+i.w and o.y+o.h>=i.y+i.h end
local function cardRect(c) local s=c.baseScale;return {x=c.homeX-D.HALF_W*s,y=c.homeY-D.HALF_H*s,w=D.W*s,h=D.H*s} end
-- Every grown hit area keeps clear of every other control and every card.
local function apart(where)
  for i,a in ipairs(sim.controls) do
    if a.hitRect then
      check(contains(a.hitRect,a),where..': '..a.label..'\'s hit area holds its face')
      for j,b in ipairs(sim.controls) do
        if j~=i then check(not HitArea.overlaps(a.hitRect,b.hitRect or b),where..': '..a.label..' reaches '..(b.label or b.action)) end
      end
      for _,c in ipairs(sim.cards) do
        -- Only inside an attached popup that already covers the card and takes the pointer.
        local popup=a.attached and sim.attachedPopup
        check(not HitArea.overlaps(a.hitRect,cardRect(c)) or (popup and contains(popup,a.hitRect)),
          where..': '..a.label..' reaches the card '..c.item.name)
      end
    end
  end
end
local function open(w,h,display)
  Display.set(display)
  sim:layout(w,h);sim:open(true);sim:sync(read('sim_snapshot.txt'));frames(20)
end
local function byLabel(label) for i,b in ipairs(sim.controls) do if b.label==label then return b,i end end end
local function highlightActive()
  for _,c in ipairs(sim.cards) do if c.item.zone=='active' and c.item.owner=='you' then sim.highlight=c end end
  sim:build()
end

-- The host says whether the primary pointer is coarse; an older host's record means a mouse.
local Viewport=require('ui.viewport')
check(Viewport.parse('844 390 0 1688 780 1').coarse==true,'A coarse pointer is read')
check(Viewport.parse('844 390 0 1688 780 0').coarse==false and Viewport.parse('844 390 0 1688 780').coarse==false,'A fine or unsaid one is not')

-- Desktop: nothing changes.
open(1280,800,{scale=1,portrait=false,coarse=false})
highlightActive()
for _,b in ipairs(sim.controls) do check(not b.hitRect,'1280x800: '..b.label..' keeps its face as its hit area') end

-- 844x390, a phone sideways: 0.4875 CSS px per board px.
open(1280,800,{scale=0.4875,portrait=false,coarse=true})
local faces={}
for _,b in ipairs(sim.controls) do if b.label~='' then faces[b.label]={b.x,b.y,b.w,b.h} end end
local undo,undoIndex=byLabel('New game') -- the history row's one enabled button
check(undo and undo.hitRect and undo.hitRect.h>undo.h and undo.hitRect.w>=undo.w,'844x390: the history buttons answer over a taller area')
check(sim:hit(undo.x+undo.w/2,undo.hitRect.y+1)==undoIndex,'844x390: a press in the grown area is the button')
apart('844x390 HUD')
highlightActive()
local attached=0
for _,b in ipairs(sim.controls) do
  if b.attached then
    attached=attached+1
    check(b.hitRect and b.hitRect.h>b.h,'844x390: '..b.label..' answers over a taller area')
  end
end
check(attached>0,'844x390: the active card shows its attached buttons')
apart('844x390 attached')
for label,face in pairs(faces) do
  local b=byLabel(label)
  if b and not b.attached then check(b.x==face[1] and b.y==face[2] and b.w==face[3] and b.h==face[4],'844x390: '..label..' keeps its face') end
end

-- The rotate hint: a touch screen held sideways under 0.6 CSS px per board px.
local drawn={}
local static=Dyna.static
Dyna.static=function(text,scale,x,y,w,h,...) drawn[#drawn+1]={text=text,scale=scale,x=x,y=y,w=w,h=h};return static(text,scale,x,y,w,h,...) end
local function hintShown()
  drawn={};sim:draw(shaders)
  for _,t in ipairs(drawn) do if t.text:find('upright') then return t end end
end
local hint=hintShown()
check(hint,'A phone held sideways is told to turn upright')
check(hint.scale*60*0.4875>=11.5,'in text at least 11.5 CSS px')
check(hint.y>=0 and hint.y+hint.h<=sim.hud:top(sim.L),'in the HUD\'s empty top band')
check(hint.x>=sim.L.hud.x and hint.x+hint.w<=sim.L.hud.x+sim.L.hud.w,'inside the HUD column')
Display.set({coarse=false});check(not hintShown(),'Not with a mouse')
Display.set({coarse=true,scale=0.6});check(not hintShown(),'Not at 0.6 and over')
Display.set({scale=0.4875})

-- 390x844, a phone upright: 0.8125.
open(480,850,{scale=0.8125,portrait=true,coarse=true})
check(not hintShown(),'Upright, no hint')
highlightActive()
local grown=0
for _,b in ipairs(sim.controls) do
  if b.attached and b.h*0.8125<24 then
    grown=grown+1
    check(b.hitRect and b.hitRect.h>b.h,'390x844: '..b.label..' answers over a taller area')
  end
end
check(grown>0,'390x844: there are small attached buttons')
apart('390x844')

-- The portrait prompt: never under 0.24, its note in a strip under the HUD when it does not fit.
local L=Layout.portrait()
local hud=Hud.new()
-- m6x11plus's real proportions at its 200 px atlas: about 0.4 em per glyph, 1 em tall.
local wide={getWidth=function(_,text) return #tostring(text)*80 end,getHeight=function() return 200 end,
  getWrap=function(_,s,w) local lines={};local line='';for word in tostring(s):gmatch('%S+') do
    if (#line+#word+1)*80>w and line~='' then lines[#lines+1]=line;line=word else line=line=='' and word or line..' '..word end end
    if line~='' then lines[#lines+1]=line end;return #s*80,lines end}
local narrowFont=T.font
T.font=function() return wide end
local function prompt(title,note,css)
  Display.set({scale=css,portrait=true})
  drawn={}
  hud.promptFit=nil
  hud:drawPrompt({luaTargeting={title=title,note=note}},L,L.hud.x+256,L.hud.y+58,198,54)
  return drawn
end
local long='Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck.'
local lines=prompt('Choose a Pokémon',long,0.8125)
local strip=0
for _,t in ipairs(lines) do
  check(t.scale>=0.24*0.8-1e-9,'No prompt text under the note\'s 0.24 floor ('..t.scale..')')
  if t.text~='Choose a Pokémon' and t.y>=L.hud.y+L.hud.h then strip=strip+1 end
end
check(lines[1].text=='Choose a Pokémon' and lines[1].scale>=0.24,'The title stays in the box at 0.24 or more')
check(strip>=1 and strip<=2,'The note spills into one or two lines under the HUD ('..strip..')')
for _,t in ipairs(lines) do
  if t.y>=L.hud.y+L.hud.h then check(t.x>=0 and t.x+t.w<=L.w and t.y+t.h<=L.table.y+60,'The strip stays in the table\'s top band') end
end
-- A note too long for two lines shrinks, never under the phone's 11 CSS px, then takes more lines.
local longer=prompt('Choose a Pokémon',long..' '..long,0.8125)
local spilled=0
for _,t in ipairs(longer) do
  if t.y>=L.hud.y+L.hud.h then
    spilled=spilled+1
    check(t.scale*60*0.8125>=11-1e-9,'A long note stays at 11 CSS px at least ('..t.scale*60*0.8125 ..')')
  end
end
check(spilled>=2,'A longer note takes two lines or more ('..spilled..')')
local short=prompt('Attach to which Pokémon?','Pick one.',0.8125)
for _,t in ipairs(short) do check(t.y<L.hud.y+L.hud.h,'A prompt that fits stays in the HUD') end
-- Desktop prompts are as they were.
Display.set({scale=1,portrait=false})
drawn={};hud.promptFit=nil
local DL=Layout.desktop()
hud:drawPrompt({luaTargeting={title='Choose a Pokémon',note=long}},DL,30,200,260,154)
for _,t in ipairs(drawn) do check(t.y<354,'Desktop prompts stay in their box') end

T.font=narrowFont
-- The HUD's small text on the narrowest phones: at least 11 CSS px.
open(480,850,{scale=0.75,portrait=true,coarse=true})
drawn={};sim:draw(shaders)
local smallest=1
for _,t in ipairs(drawn) do if t.y<L.hud.y+L.hud.h then smallest=math.min(smallest,t.scale) end end
check(smallest*60*0.75>=11-1e-9,'HUD text is at least 11 CSS px at 360 px wide ('..smallest*60*0.75 ..')')
Dyna.static=static
Display.set({scale=1,portrait=false,coarse=false})
print('PASS: table targets on phones, the rotate hint, the portrait prompt strip and HUD text floor')
