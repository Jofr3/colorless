-- Compare the bottom HUD's proportions with Balatro's actual definition and
-- UIBox sizing algorithm, including column emboss in each counter row.
package.path='frontend/lua/?.lua;'..package.path
local source=require('tests.support.balatro_source').required()
local function read(path)
  local f=assert(io.open(source..path));local text=f:read('*a');f:close();return text
end
local function near(a,b) assert(math.abs(a-b)<1e-7,tostring(a)..' != '..tostring(b)) end
local font={getWidth=function(_,text) return #tostring(text)*90 end,getHeight=function() return 200 end}
love={graphics={}}
local T=require('ui.theme');T.font=function() return font end
local language={font={FONT=font,squish=1,FONTSCALE=0.1,TEXT_HEIGHT_SCALE=0.83}}
G={UIT={ROOT='ROOT',R='R',C='C',T='T',O='O',B='B',padding=0},
  C={DYN_UI={},UI={},WHITE={},BLUE={},RED={},MONEY={},IMPORTANT={},BLACK={},CLEAR={},ORANGE={}},
  GAME={current_round={current_hand={},hands_left=4,discards_left=4},round_resets={ante=1},round=1,dollars=4,win_ante=8},
  LANG=language,LANGUAGES={['en-us']=language},TILESCALE=3,TILESIZE=20}
localize=function(key)
  return ({k_hud_hands='Hands',k_hud_discards='Discards',k_ante='Ante',k_round='Round',
    b_run_info_1='Run',b_run_info_2='Info',b_options='Options'})[key] or key
end
get_stake_sprite=function() return {} end
Moveable=function() return {} end
darken=function() return {} end
DynaText=function(cfg)
  return {T={w=0.5,h=font:getHeight()*cfg.scale*0.1*0.83/20}}
end
local defs=read('/functions/UI_definitions.lua')
assert(loadstring(defs:sub(assert(defs:find('function create_UIBox_HUD()',1,true)),
  assert(defs:find('function create_UIBox_blind_select()',1,true))-1)))()
local root=create_UIBox_HUD()
local function find(node,id)
  if node.config.id==id then return node end
  for _,child in ipairs(node.nodes or {}) do local found=find(child,id);if found then return found end end
end
Moveable={extend=function() return {} end}
dofile(source..'/engine/ui.lua')
UIElement.__index=UIElement
UIElement.set_values=function(self,rect) self.T={x=rect.x,y=rect.y,w=rect.w,h=rect.h} end
local function node(def)
  local n=setmetatable({UIT=def.n,config=def.config,children={},ARGS={}},UIElement)
  for _,child in ipairs(def.nodes or {}) do n.children[#n.children+1]=node(child) end
  return n
end
local round=node(assert(find(root,'row_round')))
UIBox.calculate_xywh(UIBox,round,{x=0,y=0,w=0,h=0})
local buttonArea=round.children[1].children[1]
local stats=round.children[2]
local hands=stats.children[1].children[1]
local money=stats.children[3].children[1]
local ante=stats.children[5].children[1]
local Hud=require('ui.sim_hud')
local Layout=require('ui.sim_layout')
local hud=Hud.new()
local L=Layout.desktop()
local b=hud:bottomLayout(L)
local buttons=hud:buttons(L)
local u=b.unit
near(round.T.w*u,L.hud.w-2*L.hud.inset)
near(buttons.log.w,buttonArea.children[1].T.w*u)
near(buttons.log.h,buttonArea.children[1].T.h*u)
near(buttons.options.w,buttonArea.children[2].T.w*u)
near(buttons.options.h,buttonArea.children[2].T.h*u)
near(buttons.options.y-buttons.log.y-buttons.log.h,buttonArea.config.padding*u)
near(b.gridX-b.x,buttonArea.T.w*u)
near(b.gridW,stats.T.w*u)
near(b.cellW,hands.T.w*u)
near(b.cellH,hands.T.h*u)
near(b.cellH,ante.T.h*u)
near(b.gridY-b.y,(round.T.h-stats.T.h)*u/2)
near(1.15*u,money.T.h*u)
near(buttons.log.lineScales[1],buttonArea.children[1].children[1].children[1].config.scale*b.scale)
near(buttons.log.lineScales[2],buttonArea.children[1].children[2].children[1].config.scale*b.scale)
near(buttons.options.lineScales[1],buttonArea.children[2].children[1].children[1].config.scale*b.scale)
local full=node(root)
UIBox.calculate_xywh(UIBox,full,{x=0,y=0,w=0,h=0},true)
local frame=full.children[1]
for _,size in ipairs({{1280,720},{1280,800},{1920,1080},{2560,1080},{600,850}}) do
  local w,h=size[1],size[2]
  local layout=Layout.for_size(w,h)
  local zoom=math.min(w/layout.w,h/layout.h)
  local sourceUnit=math.min(w/22,h/12.9)
  near(layout.hud.w*zoom,frame.T.w*sourceUnit)
  near(hud:bottomLayout(layout).unit*zoom,sourceUnit)
  assert(layout.table.x>layout.hud.x+layout.hud.w,'Table clears the sidebar')
  for name,zone in pairs(layout.zones) do
    if zone.well then
      assert(zone.well.x>=layout.table.x,name..' overlaps the sidebar')
      assert(zone.well.x+zone.well.w<=layout.w,name..' exceeds the board')
    end
  end
end
assert(Layout.for_size(480,850).hud.w==464,'Portrait keeps its horizontal HUD')
-- First-player selection starts the blind-style entrance once; refreshes and
-- later setup handoffs must not restart it.
local state={phase='ready',gamePhase='setup:chooseFirst',outcome='',you='Player 2',
  viewerSeat='p2',title='Choose who goes first',sides={},items={},allow={},L=L}
local sounds,impulses={},{}
local animated=Hud.new({
  feedback=function(...) sounds[#sounds+1]={...} end,
  jiggle=function(amount) impulses[#impulses+1]=amount end,
})
animated:sync(state,0)
state.gamePhase='setup:place'
animated:sync(state,1)
near(animated.panelMotion.VT.y,-10)
assert(animated.panelTitleHidden,'Name is hidden until the panel starts arriving')
animated:update(0.04,1.04,false)
near(animated.panelMotion.VT.y,-10)
assert(animated.departingPrompt.motion.VT.y<0,'Old prompt lifts away')
near(animated.departingPrompt.title.letters[1].pop,(1-0.04*5)^2)
assert(#sounds==0 and #impulses==0,'No impact until the title appears')
animated:update(0.02,1.21,false)
assert(not animated.departingPrompt,'Old prompt is removed after its source pop-out duration')
for ch=1,3 do near(animated.dyn[ch],T.panel[ch]) end
animated:update(0.02,1.54,false)
near(animated.panelMotion.VT.y,-10)
animated:update(0.02,1.56,false)
assert(animated.panelMotion.VT.y>-10 and animated.panelMotion.VT.y<0,'Panel slides down toward its slot')
local y=animated.panelMotion.VT.y
animated:sync(state,1.57)
near(animated.panelMotion.VT.y,y)
near(animated.panelEntrance.start,1)
animated:update(0.02,1.65,false)
for ch=1,3 do near(animated.dyn[ch],(T.panel[ch]+Hud.seatColour(state)[ch])/2) end
local random=math.random
math.random=function() return 0.5 end
animated:update(0.02,1.7,false)
math.random=random
assert(not animated.panelTitleHidden and animated.turnText.popIn==0,'Name pops in after the source delay')
assert(#sounds==2 and #impulses==1,'One layered impact cue and one shake')
for i=1,120 do animated:update(1/60,1.7+i/60,false) end
near(animated.panelMotion.VT.y,0)
assert(not animated.panelEntrance,'Entrance finishes cleanly')
assert(#sounds==2 and #impulses==1,'Settling cannot replay impact feedback')
for ch=1,3 do near(animated.dyn[ch],Hud.seatColour(state)[ch]) end
state.you='Player 1';state.viewerSeat='p1'
animated:sync(state,4)
assert(not animated.panelEntrance,'Later handoffs keep the settled panel')
local restored=Hud.new();restored:sync(state,0)
near(restored.panelMotion.VT.y,0)
state.gamePhase='setup:chooseFirst';animated:sync(state,5)
state.gamePhase='setup:drawExtra';animated:sync(state,6)
assert(animated.panelEntrance,'Mulligan draws also follow first-player selection')
animated:update(1/60,6.1,true)
near(animated.panelMotion.VT.y,0)
assert(not animated.panelTitleHidden and not animated.panelEntrance,'Reduced motion immediately settles an active entrance')
state.gamePhase='setup:chooseFirst';animated:sync(state,7)
state.gamePhase='setup:place';state.reduced=true;animated:sync(state,8)
near(animated.panelMotion.VT.y,0)
assert(not animated.panelEntrance,'Reduced motion skips the entrance')
for _,letter in ipairs(animated.turnText.letters) do near(letter.pop,1) end
assert(#sounds==6 and #impulses==1,'Reduced motion keeps sound but suppresses impact shakes')
state.gamePhase='setup:chooseFirst';state.reduced=false;animated:sync(state,9)
state.gamePhase='setup:place';animated:sync(state,10)
animated:cancelEntrance();animated:update(0.02,12,false)
assert(#sounds==6 and #impulses==1,'Leaving the page cancels delayed feedback')

-- Execute Blind:set_blind itself to check the two reveal delays, impulse and
-- paired cues. Stub only the unrelated poker state and UI/sprite rendering.
local sourceSounds,events={},{}
Blind={}
local blindSource=read('/blind.lua')
assert(loadstring(blindSource:sub(assert(blindSource:find('function Blind:set_blind(',1,true)),
  assert(blindSource:find('function Blind:alert_debuff(',1,true))-1)))()
local function noop() end
local name={states={},config={object={pop_in=noop}}}
local reward={parent={parent={states={}}},config={object={pop_in=noop}}}
local count={juice_up=noop}
G={GAME={modifiers={},round_resets={ante=1},starting_params={ante_scaling=1},current_round={}},
  ROOM={jiggle=0},SETTINGS={},ARGS={spin={}},playing_cards={},jokers={cards={}},
  HUD_blind={alignment={offset={}},recalculate=noop,get_UIE_by_ID=function(_,id)
    return ({HUD_blind_name=name,dollars_to_be_earned=reward,HUD_blind_count=count})[id]
  end},
  E_MANAGER={add_event=function(_,event) events[#events+1]=event end}}
Event=function(event) return event end
get_blind_amount=function() return 100 end
number_format=tostring
play_sound=function(...) sourceSounds[#sourceSounds+1]={...} end
local blind={config={},set_text=noop,change_colour=noop,alert_debuff=noop,juice_up=noop,
  children={animatedSprite={set_sprite_pos=noop}}}
Blind.set_blind(blind,{name='Small Blind',dollars=3,mult=1,pos={x=0,y=0}})
near(G.HUD_blind.alignment.offset.y,-10)
near(events[1].delay,0.05);events[1].func()
near(G.HUD_blind.alignment.offset.y,0)
assert(not name.states.visible)
near(events[2].delay,0.15)
math.random=function() return 0.5 end
events[2].func()
math.random=random
assert(name.states.visible)
near(impulses[1],G.ROOM.jiggle)
for i,cue in ipairs(sourceSounds) do
  assert(sounds[i][1]==cue[1])
  near(sounds[i][2],cue[2]);near(sounds[i][3],cue[3])
end

-- Compare the outgoing shrink, incoming cascade, rotation and float against
-- DynaText:align_letters, rather than duplicating its formulas in assertions.
dofile(source..'/engine/text.lua')
local Dyna=require('ui.dynatext')
for _,fps in ipairs({30,60,144}) do
  for _,outgoing in ipairs({false,true}) do
    local value=outgoing and 'Setup phase' or 'Player 2 setup'
    local actual=Dyna.new({string=value,scale=0.64,pop_in=0,rotate=true,float=true})
    actual:set(value,4,true)
    if outgoing then actual:pop_out(5,4) end
    local ref={config={pop_in=0,pop_out=outgoing and 5 or nil,rotate=true,float=true},
      created_time=4,pop_out_time=4,scale=actual.scale,pop_in_rate=3,silent=true,
      font={FONTSCALE=0.1},focused_string=1,strings={{string=value,letters={}}}}
    for i=1,#value do ref.strings[1].letters[i]={pop_in=0,offset={y=0}} end
    for frame=0,fps do
      local time=4+frame/fps
      G={TIMERS={REAL=time},SETTINGS={},TILESIZE=20}
      DynaText.align_letters(ref);actual:update(time,false)
      for i,letter in ipairs(ref.strings[1].letters) do
        near(actual.letters[i].pop,letter.pop_in)
        near(actual.letters[i].r,letter.r)
        near(actual.letters[i].offset,letter.offset.y)
      end
    end
  end
end
print('PASS: source HUD geometry, entrance cues, letter motion, colour fade, cancellation and reduced motion')
