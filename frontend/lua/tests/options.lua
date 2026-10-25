-- Execute Balatro's real Options definition and sizing passes, then compare
-- the frame, ordinary buttons and Back in physical viewport pixels.
package.path='frontend/lua/?.lua;'..package.path
local source=require('tests.support.balatro_source').required()
local file=assert(io.open(source..'/functions/UI_definitions.lua'))
local definitions=file:read('*a');file:close()
local function loadDefinition(name)
  local start=assert(definitions:find('function '..name..'(',1,true))
  local finish=definitions:find('\nfunction ',start+1,true) or #definitions+1
  assert(loadstring(definitions:sub(start,finish-1)))()
end
local font={getWidth=function(_,text) return #tostring(text)*90 end,getHeight=function() return 200 end}
love={graphics={}}
local T=require('ui.theme');T.font=function() return font end
local language={font={FONT=font,squish=1,FONTSCALE=0.1,TEXT_HEIGHT_SCALE=0.83}}
G={UIT={ROOT='ROOT',R='R',C='C',T='T',O='O',B='B',padding=0},
  C={GREY={0.5,0.5,0.5},UI={},WHITE={},RED={},ORANGE={},BLACK={},L_BLACK={},JOKER_GREY={}},
  ROOM={T={w=20,h=11.5}},STAGE=1,STAGES={RUN=1,MAIN_MENU=2},GAME={pseudorandom={seed='TEST'}},
  E_MANAGER={add_event=function() end},LANG=language,TILESCALE=3,TILESIZE=20}
Event=function(event) return event end
localize=function(key) return key end
Moveable=setmetatable({extend=function() return {} end},{__call=function() return {T={w=0,h=0}} end})
loadDefinition('UIBox_button')
loadDefinition('create_UIBox_generic_options')
loadDefinition('create_UIBox_options')
dofile(source..'/engine/ui.lua')
UIElement.__index=UIElement
UIElement.set_values=function(self,rect) self.T={x=rect.x,y=rect.y,w=rect.w,h=rect.h} end
local function node(def)
  local n=setmetatable({UIT=def.n,config=def.config,children={},ARGS={}},UIElement)
  -- The source's set_parent_child uses pairs: optional menu rows leave holes.
  for _,child in pairs(def.nodes or {}) do n.children[#n.children+1]=node(child) end
  return n
end
local original=node(create_UIBox_options())
UIBox.calculate_xywh(UIBox,original,{x=0,y=0,w=0,h=0})
original:set_wh()
local frame=original.children[1]
local body=frame.children[1]
local settings=body.children[1].children[1].children[1]
local back=body.children[2]
local function near(a,b) assert(math.abs(a-b)<1e-7,tostring(a)..' != '..tostring(b)) end
local Simulator=require('ui.simulator')
local Overlay=require('ui.sim_overlay')
local Screen=require('ui.screen')
local sim=Simulator.new({})
for _,size in ipairs({{1280,800},{1280,720},{1920,1080},{2560,1080},{1024,768}}) do
  local width,height=unpack(size)
  local zoom=math.min(width/1280,height/800)
  -- main.lua renders the simulator in a virtual room, so pass the physical
  -- viewport's tile size through the outer scaling rather than assuming 60px.
  sim:layout(1280,800,Screen.unit(width,height)/zoom)
  local menu=Overlay.new(sim,'options',{title='Options'})
  local unit=Screen.unit(width,height)
  near(menu.w*zoom,frame.T.w*unit)
  for i=1,4 do
    local button=menu.controls[i]
    near(button.w*zoom,settings.T.w*unit)
    near(button.x+button.w/2,sim.boardW/2)
  end
  near(menu.controls[5].w*zoom,back.T.w*unit)
  near(menu.controls[5].x+menu.controls[5].w/2,sim.boardW/2)
  assert(menu.controls[2].label=='Choose decks' and menu.controls[2].action=='choosedecks')
  assert(menu.controls[3].label=='New game' and menu.controls[3].action=='newgame')
  -- Direct layout callers use the same conversion without main's outer zoom.
  sim:layout(width,height)
  near(Overlay.new(sim,'options',{}).w*sim.zoom,frame.T.w*unit)
end
-- Online drops the hot-seat entries; the rest keeps Balatro's sizing.
sim:layout(1280,800,Screen.unit(1280,800))
local menu=Overlay.new(sim,'options',{title='Options'})
sim.mode,sim.flags,sim.outcome='online',{concede=true,leave=true},''
local online=Overlay.new(sim,'options',{title='Options'})
assert(#online.controls==4 and online.controls[2].action=='concede' and online.controls[3].label=='Leave match' and online.controls[3].confirm)
for i=1,3 do near(online.controls[i].w,menu.controls[i].w);near(online.controls[i].y,menu.controls[i].y) end
near(online.controls[4].y,menu.controls[5].y)
sim.flags={leave=true}
assert(Overlay.new(sim,'options',{}).controls[2].disabled,'Concede is off once the match is over')
sim.mode,sim.flags='local',{}
sim:layout(480,850)
local mobile=Overlay.new(sim,'options',{})
assert(mobile.w<=sim.boardW-32,'Portrait retains its readable compact menu')
print('PASS: Options frame '..frame.T.w..' tiles, buttons '..settings.T.w..', Back '..back.T.w..' against Balatro at five viewports, plus the online set')
