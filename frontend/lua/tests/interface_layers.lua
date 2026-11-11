-- The real main.lua under Settings' Interface Size. 100% leaves every layer as it is. 125% and
-- 150% shrink the canvas each growing layer lays out in, so it draws larger over the same part of
-- the screen: home in landscape, Settings as far as its tallest form fits (125% at most on a 16:10
-- canvas), the collection panel without its 0.9 inset. A pointer lands on what is drawn under it.
-- Portrait layers fill their canvas and stay; the table's notice grows. Changing the size in
-- Settings lays everything out again at once.
package.path='frontend/lua/?.lua;'..package.path
local noop=function() end
local function check(ok,message) if not ok then error(message,2) end end
local files={['__viewport.txt']='1280 800 1 1280 800',['__page.txt']='1\thome\t',
  ['__preferences.txt']='50 1 0 0 50 100 100 0 0 0'} -- no CRT lens: screen points map straight
local image={release=noop,setFilter=noop,getDimensions=function() return 836,322 end,getWidth=function() return 245 end,getHeight=function() return 337 end}
local logo
package.loaded['ui.menu_logo']={new=function()
  logo={update=noop,getDimensions=function() return 836,322 end}
  function logo.draw(_,scale) logo.scale=scale end
  return logo
end}
local audio=setmetatable({isPlaying=function() return false end},{__index=function() return noop end})
local mouseX,mouseY=0,0
-- Where things draw: the transform stack's scale and offset (the room does not turn under
-- reduced motion), so a button's drawn rectangle can be compared with where it answers.
local m,stack={sx=1,sy=1,tx=0,ty=0},{}
local function translate(x,y) m.tx,m.ty=m.tx+m.sx*x,m.ty+m.sy*y end
local function scale(x,y) m.sx,m.sy=m.sx*x,m.sy*(y or x) end
love={graphics=setmetatable({getDimensions=function() return 1280,800 end,
  newCanvas=function() return image end,newImage=function() return image end,newQuad=function() return {} end,
  newShader=function() return {release=noop,send=noop,hasUniform=function() return true end} end,
  getSystemLimits=function() return {texturesize=16384} end,
  newFont=function(_,size) return {setFilter=noop,getWidth=function(_,t) return #tostring(t)*size/2 end,getHeight=function() return size end} end,
  translate=translate,scale=scale,origin=function() m={sx=1,sy=1,tx=0,ty=0} end,
  push=function() stack[#stack+1]={sx=m.sx,sy=m.sy,tx=m.tx,ty=m.ty} end,pop=function() m=table.remove(stack) end,
  transformPoint=function(x,y) return x,y end},{__index=function() return noop end}),
  math={random=math.random},window={setTitle=noop,setMode=noop},
  audio={newSource=function() return audio end},
  mouse={getSystemCursor=noop,setCursor=noop,getPosition=function() return mouseX,mouseY end,isDown=function() return false end},
  keyboard={isDown=function() return false end},
  filesystem={getInfo=function(name) return files[name] or name:match('sounds/') end,read=function(name) return files[name] end}}
local T=require('ui.theme');T.text=noop
local Button=require('ui.button')
local lit,noticeSize,drawn={},nil,{}
Button.draw=function(b,active)
  if active then lit[b.label]=true end
  drawn[b.label]={x=m.tx+m.sx*b.x,y=m.ty+m.sy*b.y,w=m.sx*b.w,h=m.sy*b.h}
end
Button.errorLine=function(_,size) noticeSize=size end
local scenes={}
for _,name in ipairs({'library','builder','sandbox','simulator','online'}) do
  package.loaded['ui.'..name]={new=function(callbacks)
    local s={callbacks=callbacks,cards={},hover=0}
    for _,method in ipairs({'open','offset','backgroundColours','keypressed','wheelmoved',
      'retarget','command','close','cancelInteractions','editBox','closeModal','draw'}) do s[method]=noop end
    function s:offset() return 0 end
    function s:backgroundColours() return {T.blue,T.panel,T.panel} end
    function s:layout(w,h) self.w,self.h=w,h end
    function s:update(_,_,mx,my) self.mx,self.my=mx,my end
    function s:mousepressed(x,y) self.pressedAt={x,y} end
    function s:mousereleased(x,y) self.releasedAt={x,y} end
    scenes[name]=s;return s
  end}
end
local Settings=require('ui.settings')
local popupLayout
local layout=Settings.layout
Settings.layout=function(self,w,h) popupLayout={w,h};return layout(self,w,h) end
local output=print
print=noop
dofile('frontend/lua/main.lua');love.load()
local function frame() love.update(1/60);lit={};drawn={};love.graphics.origin();love.draw() end
local function view(text) files['__viewport.txt']=text;for _=1,20 do frame() end end
local function at(x,y) mouseX,mouseY=x,y;love.mousemoved(x,y,1,1);frame();return next(lit) end
local function key(name) love.keypressed(name);frame() end
-- Closing Settings from the keyboard hands focus back to home's Settings button, which then
-- lights wherever the pointer is; a click on nothing clears it.
local function close() key('escape');love.mousepressed(2,2,1);love.mousereleased(2,2,1);frame() end
-- `label` is drawn over the rectangle x,y,w,h (screen pixels) and lights inside it and not just
-- outside it.
local function spans(label,x,y,w,h,message)
  at(x+w/2,y+h/2)
  local d=drawn[label]
  check(d and math.abs(d.x-x)<1e-6 and math.abs(d.y-y)<1e-6 and math.abs(d.w-w)<1e-6 and math.abs(d.h-h)<1e-6,
    message..': drawn at '..(d and ('%.2f,%.2f %.2fx%.2f'):format(d.x,d.y,d.w,d.h) or 'nowhere'))
  check(at(x+1,y+1)==label and at(x+w-1,y+h-1)==label,message..': inside')
  check(at(x-1,y+h/2)~=label and at(x+w+1,y+h/2)~=label and at(x+w/2,y-1)~=label and at(x+w/2,y+h+1)~=label,message..': not outside')
end
view('1280 800 1 1280 800')

-- 100%: home's Settings button and Settings' Back where they always were, no layer transform.
spans('Settings',664,696,120,48,'100% home Settings at 664,696')
check(logo.scale==900/836,'The logo is 900 wide')
files['__settings.txt']='1\tgame';frame()
check(popupLayout[1]==1280 and popupLayout[2]==800,'Settings lays out in 1280x800 at 100%')
spans('Back',266,642,748,38,'100% Settings Back')
-- Interface Size is the seventh stop: four tabs, Screenshake, Reduced Motion.
for _=1,6 do key('tab') end
key('right')
check(popupLayout[1]==1024 and popupLayout[2]==640,'125% lays Settings out at once in 1024x640, got '..popupLayout[1]..'x'..popupLayout[2])
-- Back in the 1024x640 canvas: x 138, y 20+600-58, 748x38; drawn 1.25 times about the centre.
spans('Back',172.5,702.5,935,47.5,'125% Settings Back')
key('right')
check(popupLayout[1]==1024 and popupLayout[2]==640,'150% keeps Settings at 125%: its 620-tall form does not fit 533')
-- A click lands where Back is drawn, outside where it was at 100%.
at(200,740);love.mousepressed(200,740,1);love.mousereleased(200,740,1);frame()
check(not drawn.Back,'A click on the grown Back closes Settings')
-- Home at 150%: a 853x533 canvas; Settings at its centre + 24, 104 above the bottom.
spans('Settings',676,644,180,72,'150% home Settings')
check(math.abs(logo.scale-(271.33333-32)*836/322/836)<1e-3,'The logo shrinks to fit above the menu')
-- 844x390 sideways phone: the same layers grow (the canvas is 1280x800 here too).
view('844 390 1 844 390')
local s=390/800
local ox=(844-1280*s)/2
spans('Settings',ox+676*s,644*s,180*s,72*s,'844x390 at 150%')
-- Portrait: home and Settings fill their canvas and stay at 100%.
view('390 844 1 390 844')
local ps=390/480
local oy=(844-850*ps)/2
spans('Settings',(240+24)*ps,oy+(850-104)*ps,120*ps,48*ps,'390x844 home stays at 100%')
files['__settings.txt']='2\tgame';frame()
check(popupLayout[1]==480 and popupLayout[2]==850,'Portrait Settings stays at 100%')
close()

-- The collection panel: 0.9 at 100% over the dimmed home, the whole canvas otherwise.
view('1280 800 1 1280 800')
files['__page.txt']='2\tdecks\t';for _=1,5 do frame() end
at(100,100)
check(math.abs(scenes.library.mx-100)<1e-6 and math.abs(scenes.library.my-100)<1e-6,'At 150% the collection is not inset')
check(scenes.library.w==1280 and scenes.library.h==800,'The collection lays out in its own canvas')

-- The table's notice grows with the size; the table itself fills the canvas.
files['__page.txt']='3\tsimulator\t';for _=1,5 do frame() end
files['__notice.txt']='1\tOffline';frame()
check(noticeSize==24,'The table notice is 16 x 1.5 at 150%, got '..tostring(noticeSize))
check(scenes.simulator.w==1280 and scenes.simulator.h==800,'The table lays out in 1280x800')
-- Its text overlays grow instead, in portrait too.
local Display=require('ui.display')
check(Display.tableText==1.5,'The table text grows by 1.5 at 150%, got '..tostring(Display.tableText))
view('390 844 1 390 844')
check(Display.tableText==1.5,'The table text grows in portrait as well')
view('1280 800 1 1280 800')
files['__notice.txt']=nil
files['__page.txt']='4\thome\t';for _=1,5 do frame() end

-- Back to 100% from Settings: everything returns.
files['__settings.txt']='3\tgame';frame()
for _=1,6 do key('tab') end
key('right')
check(popupLayout[1]==1280 and popupLayout[2]==800,'100% again lays Settings out in 1280x800')
spans('Back',266,642,748,38,'100% Settings Back again')
check(Display.tableText==1,'The table text is back at 100%')
close()
spans('Settings',664,696,120,48,'100% home Settings again')
files['__page.txt']='5\tdecks\t';for _=1,5 do frame() end
at(100,100)
check(math.abs(scenes.library.mx-40)<1e-6 and math.abs(scenes.library.my-(400-300/0.9))<1e-6,'At 100% the collection is inset 0.9')
print=output
print('PASS: Interface Size grows home, Settings and the collection where they fit, maps the pointer, and 100% is unchanged')
