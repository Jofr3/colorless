-- Settings' Credits: a button on the Game tab, under Interface Size and above Back, that asks the
-- page to open the third-party notices in a new tab. A press, a release on it or Enter while it
-- has focus asks once; a release elsewhere cancels; Settings stays open.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
require('support.draw_stub').install()
local T=require('ui.theme')
T.text=function() end
local Button=require('ui.button')
local Preferences=require('ui.preferences')
local Settings=require('ui.settings')
local function check(ok,message) if not ok then error(message,2) end end

local credits,closed,said=0,0,{}
local drawnLabels={}
local draw=Button.draw
Button.draw=function(b,...) drawnLabels[b.label]=b; return draw(b,...) end
local popup=Settings.new(Preferences.new(),{
  changed=function() end,close=function() closed=closed+1 end,
  announce=function(text) said[#said+1]=text end,
  feedback=function() end,reduced=function() return false end,
  credits=function() credits=credits+1 end,
},true,true)
local function byLabel(label)
  for i,item in ipairs(popup.items) do if item.label==label then return item,i end end
end

for _,size in ipairs({{1280,800},{480,850},{1024,640}}) do
  popup:layout(size[1],size[2])
  popup.tab=Settings.tabs.game;popup:build()
  local item,index=byLabel('Credits')
  local cycle,back=byLabel('Interface Size'),byLabel('Back')
  check(item and item.kind=='credits','The Game tab has a Credits button')
  check(index==#popup.items-1,'Tab reaches it after Interface Size and before Back')
  check(item.x>=popup.x and item.x+item.w<=popup.x+popup.w,'It fits the popup\'s width')
  check(math.abs(item.x+item.w/2-(popup.x+popup.w/2))<0.01,'It is centred')
  check(item.y>cycle.y+cycle.h+6 and item.y+item.h+6<back.y,'It sits between Interface Size and Back')
  drawnLabels={};popup:draw()
  check(drawnLabels.Credits==item and item.colour==T.blue,'It is drawn as a blue button')
end
for _,tab in ipairs({'graphics','audio','account'}) do
  popup.tab=Settings.tabs[tab];popup:build()
  check(byLabel('Credits')==nil,'Only the Game tab has Credits ('..tab..')')
end

popup:layout(1280,800);popup.tab=Settings.tabs.game;popup:build()
local item,index=byLabel('Credits')
check(popup:describe(item)=='Credits. Opens in a new tab.','It says what it does')
local x,y=item.x+item.w/2,item.y+item.h/2
check(popup:hit(x,y)==index,'A pointer over it hits it')
popup:mousepressed(x,y);popup:mousereleased(x,y)
check(credits==1 and closed==0,'A click asks for the notices once and keeps Settings open')
popup:mousepressed(x,y);popup:mousereleased(x,popup.y-50)
check(credits==1,'Releasing outside it cancels')
popup.focus=index-1;popup:keypressed('tab')
check(popup.focus==index and said[#said]=='Credits. Opens in a new tab.','Tab moves to it and says it')
popup:keypressed('return')
check(credits==2 and closed==0,'Enter asks for the notices')
popup:keypressed('tab')
check(popup.items[popup.focus].kind=='back','Tab moves on to Back')
print('PASS: Settings\' Game tab has a Credits button that opens the notices by pointer and keyboard')
