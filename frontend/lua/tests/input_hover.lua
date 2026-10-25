package.path='frontend/lua/?.lua;'..package.path
local noop=function()end
love={graphics={push=noop,pop=noop,translate=noop,scale=noop,setColor=noop,setFont=noop,rectangle=noop,polygon=noop,
 printf=noop,print=noop,setLineWidth=noop,setLineStyle=noop,line=noop},keyboard={isDown=function()return false end}}
local T=require('ui.theme');T.text=noop;T.font=function(size)return {getWidth=function(_,s)return #s*size*0.5 end,getHeight=function()return size end}end
local Button=require('ui.button')
local panels={}
Button.panel=function(x,y,w,h,colour)panels[#panels+1]={x=x,y=y,w=w,h=h,colour=colour}end
local function same(a,b)for i=1,4 do if math.abs(a[i]-b[i])>1e-8 then return false end end;return true end
local source=require('tests.support.balatro_source').required()
local function read(path)local f=assert(io.open(source..path));local raw=f:read('*a');f:close();return raw end
local globals=read('/globals.lua')
local hoverHex=assert(globals:match("HOVER%s*=%s*HEX%('(%x+)'"))
local alpha=tonumber(hoverHex:sub(7,8),16)/255
local function shade(c,amount)return {c[1]*(1-amount),c[2]*(1-amount),c[3]*(1-amount),c[4]}end
local defs=read('/functions/UI_definitions.lua')
G={C={RED=T.red,BLACK=T.panel,CLEAR={0,0,0,0},WHITE=T.white,UI={TEXT_LIGHT=T.white}},
 UIT={R='R',C='C',B='B',T='T',O='O'},ASSET_ATLAS={}}
Sprite=function()return {states={drag={},visible=false}}end
local function constructor(name)
 local start=assert(defs:find('function '..name..'(',1,true))
 assert(loadstring(defs:sub(start,assert(defs:find('\nfunction ',start,true))-1)))()
end
constructor('create_slider');constructor('create_toggle')
local reference=create_slider({w=4,h=0.4,ref_table={value=50},ref_value='value',max=100})
local track,number=reference.nodes[1],reference.nodes[2]
assert(track.config.hover and track.config.emboss==0.05)
assert(not track.nodes[1].config.hover and not number.config.hover and number.config.shadow)
local checkbox=create_toggle({}).nodes[2].nodes[1].nodes[1]
assert(checkbox.config.hover and same(checkbox.config.outline_colour,T.white))
local function face(x,y,w)
 for i=#panels,1,-1 do if panels[i].x==x and panels[i].y==y and (not w or panels[i].w==w)then return panels[i].colour end end
 error('Missing rendered panel')
end
local Input=require('ui.text_input')
local field={label='Email',x=0,y=32,w=300,h=40}
Input.draw(field,'hello',false,0,0,0,false,false);local normal=face(0,32)
Input.draw(field,'hello',false,0,0,0,false,true)
assert(same(face(0,32),shade(normal,alpha)),'Text input must use the source black overlay')
assert(same(face(0,36),{0,0,0,0.3}),'Text shadow must not change on hover')
Input.draw(field,'hello',true,0,0,0,false,true)
assert(same(face(0,32),shade(shade(normal,0.3),alpha)),'Editing and hover darkening compose')
Input.draw(field,'hello',false,0,0,0,true,false);local disabled=face(0,32)
Input.draw(field,'hello',false,0,0,0,true,true);assert(same(disabled,face(0,32)),'Disabled fields must ignore hover')
local Settings=require('ui.settings');local Preferences=require('ui.preferences');local prefs=Preferences.new()
local settings=Settings.new(prefs,{changed=noop,close=noop,announce=noop,feedback=noop,reduced=function()return prefs:reduced(false) end},true,false)
settings:layout(1280,800);settings.focus=0
local before=prefs:serialize()
local slider=settings.items[5]
for _,hover in ipairs({0,5})do
 settings.hover=hover;panels={};settings:draw()
 assert(same(face(slider.x,slider.y+7,slider.w),shade(track.config.colour,hover==5 and alpha or 0)))
 assert(same(face(slider.x,slider.y+10),shade(track.config.colour,hover==5 and 0.5 or 0.3)))
 assert(same(face(slider.x,slider.y+7,slider.w/2),track.nodes[1].config.colour),'Fill must not darken')
 assert(same(face(slider.x+slider.w+8,slider.y+7),number.config.colour),'Value badge must not darken')
end
assert(settings:hit(slider.x+slider.w+20,slider.y+15,true)==0,'Badge is not a hover target')
local toggle=settings.items[6];local x=toggle.x+toggle.w+12
for _,enabled in ipairs({0,1})do
 prefs:set('reducedMotion',enabled)
 for _,hover in ipairs({0,6})do
  settings.hover=hover;panels={};settings:draw()
  assert(same(face(x,toggle.y),checkbox.config.outline_colour),'White outline must not darken')
  assert(same(face(x+3,toggle.y+3),shade(enabled==1 and T.red or T.panel,hover==6 and alpha or 0)))
  assert(same(face(x,toggle.y+1.5),shade(T.white,hover==6 and 0.5 or 0.3)))
 end
end
prefs.reducedMotion=-1
assert(settings:hit(toggle.x+10,toggle.y+15,true)==0,'Toggle label is not a hover target')
settings.tab=2;settings:build();local cycle=settings.items[6]
assert(settings:hit(cycle.x+cycle.w/2,cycle.y+10)==0,'Cycle center must remain non-clickable')
local i,part=settings:hit(cycle.x+cycle.w/2,cycle.y+10,true)
assert(i==6 and part=='center','Cycle center must support hover-only detection')
settings.hover=6;settings.hoverPart='center';panels={};settings:draw()
assert(same(face(cycle.x+36,cycle.y),shade(T.red,alpha)))
assert(same(face(cycle.x+36,cycle.y+6),shade(T.red,0.5)))
assert(prefs:serialize()==before,'Hovering must not change settings')
print('PASS: source hover overlay, slider child/badge colours, checkbox outline/emboss, input shadow and non-clickable centers')
