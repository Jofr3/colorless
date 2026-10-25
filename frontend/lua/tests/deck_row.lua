-- Compare the adapted deck row with Balatro's actual poker-hand definition.
package.path='frontend/lua/?.lua;'..package.path
local source=require('tests.support.balatro_source').required()
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
start=assert(defs:find('function create_UIBox_card_alert(',1,true))
assert(loadstring(defs:sub(start,assert(defs:find('\nfunction ',start,true))-1)))()
G.C.RED=colour('RED');G.C.CLEAR={0,0,0,0};G.UIT.ROOT='ROOT';G.UIT.O='O'
DynaText=function(cfg)return cfg end
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
-- The '!' alert: compare the badge and its DynaText with create_UIBox_card_alert.
local alert=create_UIBox_card_alert({red_bad=true});local box=alert.nodes[1];local dyna=box.nodes[1].config.object
same(Row.alert.colour,box.config.colour);same(Row.alert.colour,darken(G.C.RED,0.1))
assert(box.config.r==0.15 and Row.alert.radius==1.8,'Boxes under 3.5 tiles step their corners at res 0.6')
assert(box.config.minw==0.42 and box.config.minh==0.42 and Row.alert.size==0.42*60)
assert(box.config.emboss==0.05 and Row.alert.emboss==3 and box.config.draw_layer==1)
assert(dyna.string=='!' and Row.alert.text.string=='!');same(Row.alert.text.colours[1],dyna.colours[1])
for _,key in ipairs({'shadow','rotate','bump'})do assert(dyna[key]==true and Row.alert.text[key]==true,key)end
for _,key in ipairs({'bump_rate','bump_amount','scale','spacing','text_rot'})do assert(dyna[key]==Row.alert.text[key],key)end
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
local Dyna=require('ui.dynatext')
-- The glyph carries the font's TEXT_OFFSET*scale like DynaText:init does.
local prints={};love.graphics.print=function(_,x,y)prints[#prints+1]={x=x,y=y}end
local function glyph(cfg)prints={};local d=Dyna.new(cfg);d:update(0,true);d:draw(100,100,1280);return prints[#prints]end
local plain,shifted=glyph({string='!',scale=0.48}),glyph({string='!',scale=0.48,font_offset=true})
local f=0.48*0.1/20*60
assert(math.abs((shifted.x-plain.x)-10*f)<1e-9 and math.abs((shifted.y-plain.y)+20*f)<1e-9,'font_offset applies TEXT_OFFSET*scale')
assert(Row.alert.text.font_offset==true,'The alert glyph uses the font offset')
local drawn;Dyna.new=function(cfg)return {update=function()end,draw=function(_,cx,cy)drawn={cx=cx,cy=cy}end}end
for _,w in ipairs({392,416})do
 local row={x=0,y=0,h=36,rowWidth=w,arg={quantity=4,name='Illegal card',illegal=true}}
 fills={};Row.drawAlert(row,1,false,1280)
 same(fills[1].c,darken(darken(G.C.RED,0.1),0.3));same(fills[2].c,darken(G.C.RED,0.1))
 local bx,by,bw,bh=Row.alertBox(row)
 assert(fills[2].x==bx and fills[2].y==by and fills[1].y==by+3 and bw==bh)
 assert(bx>48 and bx+bw<=w-81,'Alert sits at the inner top-right of the name cell')
 assert(drawn.cx==bx+bw/2 and drawn.cy==by+bh/2,'The ! is centred in the badge')
end
print('PASS: the illegal-card alert matches create_UIBox_card_alert and is anchored to the name cell')
print('PASS: deck rows match source palette, badge, inset, emboss and hover layering at both layout widths')
