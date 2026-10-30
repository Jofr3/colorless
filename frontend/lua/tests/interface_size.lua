-- Interface size (audit LQX2): a tenth preference, 100% / 125% / 150%, chosen with a cycle on
-- Settings' Game tab under Reduced Motion. Records saved before it (eight or nine values) keep
-- every setting. The policy (ui/interface_size.lua) grows each layer by the largest step up to
-- the chosen one whose shrunken canvas still holds the layer's content.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local T=require('ui.theme')
local texts={}
T.text=function(text) texts[#texts+1]=tostring(text) end
local Preferences=require('ui.preferences')
local Settings=require('ui.settings')
local Size=require('ui.interface_size')
local function check(ok,message) if not ok then error(message,2) end end

-- The record.
local p=Preferences.new()
check(p.interfaceSize==0,'100% is the default')
check(p:serialize()=='50 -1 70 0 50 100 100 0 0 0','The size is the tenth value')
local eight=Preferences.new('20 1 0 1 35 80 60 1')
check(eight.screenshake==20 and eight.reducedMotion==1 and eight.crt==0 and eight.bloom==1 and eight.volume==35
  and eight.musicVolume==80 and eight.effectsVolume==60 and eight.muted==1 and eight.highFrameRate==0 and eight.interfaceSize==0,
  'An eight-value record keeps every setting and takes the defaults after it')
local nine=Preferences.new('20 1 0 1 35 80 60 1 1')
check(nine.highFrameRate==1 and nine.crt==0 and nine.muted==1 and nine.interfaceSize==0,'A nine-value record keeps its frame rate')
check(nine:serialize()=='20 1 0 1 35 80 60 1 1 0','and saves ten values')
local ten=Preferences.new('20 1 0 1 35 80 60 1 1 2')
check(ten.interfaceSize==2 and ten:serialize()=='20 1 0 1 35 80 60 1 1 2','A ten-value record round-trips')
check(Preferences.new('20 1 0 1 35 80 60 1 1 7').interfaceSize==2,'The size is clamped to 150%')
check(Preferences.new('20 1 0 1 35 80 60 1 1 2 1').crt==70,'A record with too many values is not read')
check(Preferences.new('{"crt":20,"interfaceSize":1}').interfaceSize==1,'A JSON record reads the size')
check(Size.steps[Preferences.new().interfaceSize+1]==1,'The default step is 100%')

-- The policy: a layer grows by the largest step, up to the chosen one, whose canvas holds it.
check(Size.factor(0,1280,800,812,640)==1,'100% grows nothing')
check(Size.factor(1,1280,800,812,640)==1.25,'125% fits a 812x640 box in 1280x800')
check(Size.factor(2,1280,800,812,640)==1.25,'150% falls back to 125% where 533 is too short')
check(Size.factor(2,1280,800,720,520)==1.5,'A 720x520 box takes 150%')
check(Size.factor(2,480,850,472,640)==1,'A portrait box as wide as the canvas never grows')
check(Size.factor(1,1280,800,1280,800)==1,'A full-canvas layer never grows')

-- The Settings control.
local changes,announcements=0,{}
local popup=Settings.new(p,{
  changed=function() changes=changes+1 end,close=function() end,
  announce=function(text) announcements[#announcements+1]=text end,
  feedback=function() end,reduced=function() return false end,
},false,true)
local function byLabel(label)
  for i,item in ipairs(popup.items) do if item.label==label then return item,i end end
end
local function drawn(text)
  texts={};popup:draw()
  for _,t in ipairs(texts) do if t==text then return true end end
  return false
end
for _,size in ipairs({{1280,800},{480,850},{1024,640}}) do
  popup:layout(size[1],size[2])
  popup.tab=Settings.tabs.game;popup:build()
  local narrow=size[1]<600
  local shake,motion,back=byLabel('Screenshake'),byLabel('Reduced Motion'),byLabel('Back')
  check(shake.x==popup.x+(popup.w-240-56)/2 and shake.y==popup.y+180 and shake.w==240 and shake.h==40,'Screenshake stays put')
  check(motion.x==popup.x+(popup.w-180-56)/2 and motion.y==popup.y+292 and motion.w==180 and motion.h==40,'Reduced Motion stays put')
  check(back.x==popup.x+16 and back.y==popup.y+popup.h-58 and back.w==popup.w-32 and back.h==38,'Back stays put')
  local item,index=byLabel('Interface Size')
  check(item and item.kind=='cycle' and item.key=='interfaceSize','Game has an Interface Size cycle')
  check(item.w==264 and item.h==38.4 and item.x==popup.x+(popup.w-264)/2,'It is the CRT Bloom cycle\'s size, centred')
  check(item.y==popup.y+404,'It takes the next row under Reduced Motion')
  check(item.y-32>motion.y+motion.h+6 and item.y+item.h+6<back.y,'It fits between Reduced Motion and Back')
  check(index==#popup.items-1,'Tab reaches it after Reduced Motion and before Back')
  check(not narrow or item.x>=popup.x,'It fits the portrait popup')
end
popup:layout(1280,800);popup.tab=Settings.tabs.game;popup:build()
check(drawn('Interface Size') and drawn('100%') and not drawn('125%'),'It shows 100% by default')
local item,index=byLabel('Interface Size')
popup.focus=index
popup:keypressed('right')
check(p.interfaceSize==1 and changes==1,'Right picks 125% and saves')
check(announcements[#announcements]=='Interface Size: 125%','It says its new value')
check(drawn('125%'),'It shows 125%')
popup:keypressed('right')
check(p.interfaceSize==2,'Right again picks 150%')
popup:keypressed('right')
check(p.interfaceSize==0,'and wraps to 100%')
popup:keypressed('left')
check(p.interfaceSize==2,'Left wraps back to 150%')
check(popup:describe(item)=='Interface Size: 150%','It describes its value')
-- Three pips, the third lit.
local pips=0
local panel=require('ui.button').panel
require('ui.button').panel=function(x,y,w,h,c,...) if w==4.8 and h==4.8 then pips=pips+1 end return panel(x,y,w,h,c,...) end
popup:draw()
require('ui.button').panel=panel
check(pips==3,'It shows three pips, got '..pips)
popup:update(1/60,20,-1000,-1000,true)
popup:mousepressed(item.x+5,item.y+15);popup:mousereleased(item.x+5,item.y+15)
check(p.interfaceSize==1,'Its left arrow steps down')
popup:mousepressed(item.x+item.w-5,item.y+15);popup:mousereleased(item.x+item.w-5,item.y+15)
check(p.interfaceSize==2,'Its right arrow steps up')
-- The two-valued cycles still flip.
popup.tab=Settings.tabs.graphics;popup:build()
local bloom,bloomIndex=byLabel('CRT Bloom')
popup.focus=bloomIndex
popup:keypressed('left')
check(p.bloom==1,'CRT Bloom still flips with Left')
popup:keypressed('right')
check(p.bloom==0,'and with Right')
print('PASS: Interface Size preference (old records load), its Settings cycle and the layer policy')
