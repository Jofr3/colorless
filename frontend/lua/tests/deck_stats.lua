-- Compare the stats palette and clipped pixel geometry with Balatro itself.
package.path='frontend/lua/?.lua;'..package.path
local polygon
love={graphics={setColor=function()end,push=function()end,pop=function()end,translate=function()end,
 polygon=function(_,vertices)polygon=vertices end}}
local source=require('tests.support.balatro_source').required()
local function read(path)local f=assert(io.open(source..path));local raw=f:read('*a');f:close();return raw end
local function near(a,b)assert(math.abs(a-b)<1e-8,tostring(a)..' != '..tostring(b))end
function HEX(value)return {tonumber(value:sub(1,2),16)/255,tonumber(value:sub(3,4),16)/255,tonumber(value:sub(5,6),16)/255,1}end
local globals=read('/globals.lua')
local function colour(name)return HEX(assert(globals:match('%s'..name..'%s*=%s*HEX%(["\'](%x+)')))end
G={C={JOKER_GREY=colour('JOKER_GREY'),BLACK=colour('BLACK'),FILTER=colour('ORANGE'),UI={TEXT_LIGHT={1,1,1,1}}},
 UIT={R='R',C='C',T='T',O='O'},SETTINGS={profile=1},PROFILES={{high_scores={furthest_round={label='Highest Round',amt=17}}}},TILESIZE=20}
local misc=read('/functions/misc_functions.lua')
local darkenStart=assert(misc:find('function darken(',1,true))
assert(loadstring(misc:sub(darkenStart,assert(misc:find('\nfunction ',darkenStart,true))-1)))()
DynaText=function(config)return config end
number_format=tostring;score_number_scale=function(scale)return scale end;localize=function(key)return key end
local defs=read('/functions/UI_definitions.lua')
assert(loadstring(defs:sub(assert(defs:find('function create_UIBox_high_scores_row(',1,true)),assert(defs:find('function create_UIBox_win()',1,true))-1)))()
local expected=create_UIBox_high_scores_row('furthest_round')
local Stats=require('ui.deck_stats')
for i=1,4 do near(Stats.colours.label[i],expected.config.colour[i]);near(Stats.colours.value[i],expected.nodes[2].config.colour[i]);near(Stats.colours.muted[i],G.C.JOKER_GREY[i])end
assert(expected.config.emboss==0.05 and expected.nodes[2].config.emboss==0.05)
assert(not expected.config.shadow and not expected.nodes[2].config.shadow,'Rows use emboss, not drop shadows')
Moveable={extend=function()return {}end}
dofile(source..'/engine/ui.lua')
local Button=require('ui.button')
for _,progress in ipairs({0,0.01,0.18,0.5,1})do
 local ref={VT={w=210/60,h=44/60},config={r=0.1},shadow_parrallax={x=0,y=-1.5}}
 UIElement.draw_pixellated_rect(ref,'fill',1.5,nil,progress)
 local original=polygon
 Button.panel(0,0,210,44,{1,1,1,1},1.8,progress)
 for i,v in ipairs(original)do near(polygon[i],v*3)end
end
print('PASS: source stats colors, emboss configuration and progress polygon at five fill levels')
