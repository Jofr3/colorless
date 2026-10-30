-- Settings' Graphics tab gains a Max Frame Rate cycle (60 FPS / 144 FPS) in the free space
-- under CRT Bloom: the tab's existing controls keep their place and size, keyboard and pointer
-- reach the new one, and it shows and says its value.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local T=require('ui.theme')
local texts={}
T.text=function(text) texts[#texts+1]=tostring(text) end
local Preferences=require('ui.preferences')
local Settings=require('ui.settings')
local function check(ok,message) if not ok then error(message,2) end end
local p=Preferences.new()
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
for _,size in ipairs({{1280,800},{480,850}}) do
  popup:layout(size[1],size[2])
  popup.tab=Settings.tabs.graphics;popup:build()
  -- The places the tab's controls had before the new one (settings.lua's row formula).
  local crt,bloom,back=byLabel('CRT'),byLabel('CRT Bloom'),byLabel('Back')
  check(crt.x==popup.x+(popup.w-240-56)/2 and crt.y==popup.y+180 and crt.w==240 and crt.h==40,'CRT stays put')
  check(bloom.x==popup.x+(popup.w-264)/2 and bloom.y==popup.y+292 and bloom.w==264 and bloom.h==38.4,'CRT Bloom stays put')
  check(back.x==popup.x+16 and back.y==popup.y+popup.h-58 and back.w==popup.w-32 and back.h==38,'Back stays put')
  local rate,index=byLabel('Max Frame Rate')
  check(rate and rate.kind=='cycle' and rate.key=='highFrameRate','Graphics has a Max Frame Rate cycle')
  check(rate.w==bloom.w and rate.h==bloom.h and rate.x==bloom.x,'It is a cycle the size of CRT Bloom, in its column')
  check(rate.y==popup.y+404,'It takes the next row under CRT Bloom')
  -- Its label sits 32 above it; nothing it draws reaches CRT Bloom or Back.
  check(rate.y-32>bloom.y+bloom.h+6 and rate.y+rate.h+6<back.y,'It fits between CRT Bloom and Back')
  check(index==#popup.items-1,'Tab reaches it after CRT Bloom and before Back')
end
popup:layout(1280,800);popup.tab=Settings.tabs.graphics;popup:build()
check(drawn('Max Frame Rate') and drawn('60 FPS') and not drawn('144 FPS'),'It shows 60 FPS by default')
check(drawn('Off'),'CRT Bloom still shows Off')
local rate,index=byLabel('Max Frame Rate')
popup.focus=index
popup:keypressed('right')
check(p.highFrameRate==1 and changes==1,'Right picks 144 FPS and saves')
check(announcements[#announcements]=='Max Frame Rate: 144 FPS','It says its new value')
check(drawn('144 FPS') and not drawn('60 FPS'),'It shows 144 FPS')
popup:keypressed('left')
check(p.highFrameRate==0,'Left goes back to 60 FPS')
check(popup:describe(rate)=='Max Frame Rate: 60 FPS','It describes its value')
popup:update(1/60,20,-1000,-1000,true) -- the popup has slid in
popup:mousepressed(rate.x+rate.w-10,rate.y+15);popup:mousereleased(rate.x+rate.w-10,rate.y+15)
check(p.highFrameRate==1,'Its arrow toggles it')
check(popup:describe(byLabel('CRT Bloom'))=='CRT Bloom: off','CRT Bloom still says on and off')
print('PASS: Settings Graphics adds Max Frame Rate under CRT Bloom without moving its controls')
