-- Compare the adapted deck row with Balatro's actual poker-hand definition.
package.path='frontend/lua/?.lua;'..package.path
local source=os.getenv('BALATRO_SOURCE') or '../balatro-source'
local function read(path)local f=assert(io.open(source..path));local raw=f:read('*a');f:close();return raw end
local noop=function()end
love={graphics={setColor=noop,push=noop,pop=noop,translate=noop,scale=noop,setLineWidth=noop,
 polygon=noop,setFont=noop,print=noop}}
function HEX(v)return {tonumber(v:sub(1,2),16)/255,tonumber(v:sub(3,4),16)/255,tonumber(v:sub(5,6),16)/255,1}end
local globals=read('/globals.lua')
local function colour(key)return HEX(assert(globals:match('%s'..key..'%s*=%s*HEX%(["\'](%x+)')))end
G={C={JOKER_GREY=colour('JOKER_GREY'),BLACK=colour('BLACK'),WHITE={1,1,1,1},
 HAND_LEVELS={HEX(assert(globals:match('HAND_LEVELS%s*=%s*{%s*HEX%("(%x+)"')))},
 CHIPS=colour('CHIPS'),MULT=colour('MULT'),L_BLACK=colour('L_BLACK'),FILTER=colour('ORANGE'),
 UI={TEXT_DARK=colour('TEXT_DARK'),TEXT_LIGHT={1,1,1,1}}},UIT={R='R',C='C',T='T',B='B'},
 GAME={hands={test={visible=true,level=1,chips=100,mult=8,played=0}}}}
localize=function(s)return s end
local misc=read('/functions/misc_functions.lua');local start=assert(misc:find('function darken(',1,true))
assert(loadstring(misc:sub(start,assert(misc:find('\nfunction ',start,true))-1)))()
local defs=read('/functions/UI_definitions.lua');start=assert(defs:find('function create_UIBox_current_hand_row(',1,true))
assert(loadstring(defs:sub(start,assert(defs:find('\nfunction ',start,true))-1)))()
local expected=create_UIBox_current_hand_row('test')
local function same(a,b)for i=1,4 do assert(math.abs(a[i]-b[i])<1e-8)end end
local T=require('ui.theme');local Row=require('ui.deck_row');local Button=require('ui.button')
same(Row.colours.background,expected.config.colour)
same(Row.colours.badge,expected.nodes[1].nodes[1].config.colour)
same(Row.colours.badgeText,expected.nodes[1].nodes[1].nodes[1].config.colour)
same(Row.colours.inset,expected.nodes[2].config.colour)
same(T.blue,expected.nodes[2].nodes[1].config.colour);same(T.red,expected.nodes[2].nodes[3].config.colour)
assert(expected.config.emboss==0.05 and expected.config.padding==0.05 and not expected.config.shadow)
assert(expected.nodes[1].nodes[1].config.outline==0.8)
local fills={};Button.panel=function(x,y,w,h,c)fills[#fills+1]={x=x,y=y,w=w,h=h,c=c}end
Button.outline=noop
T.font=function()return {getWidth=function(_,s)return #s*100 end,getHeight=function()return 200 end}end
for _,w in ipairs({392,416})do
 for _,hovered in ipairs({false,true})do
  fills={};Row.draw({x=0,y=0,h=36,rowWidth=w,arg={quantity=4,name='A very long Pokémon name that must fit'}},hovered,1280)
  same(fills[1].c,darken(expected.config.colour,hovered and 0.5 or 0.3))
  same(fills[2].c,darken(expected.config.colour,hovered and 85/255 or 0))
  same(fills[3].c,expected.nodes[1].nodes[1].config.colour)
  same(fills[4].c,expected.nodes[2].config.colour)
  for _,f in ipairs(fills)do assert(f.x>=0 and f.x+f.w<=w and f.h>0)end
 end
end
print('PASS: deck rows match source palette, badge, inset, emboss and hover layering at both layout widths')
