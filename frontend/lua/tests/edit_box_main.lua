-- The real main.lua tells the page where the field a text proxy edits is drawn (audit BR6): a
-- command that opens an edit (a screen's input, Settings' account and sign-in edit) carries the
-- field's box after its own fields, and a 'field-box' print follows when the box moves. The box
-- is in whole CSS pixels from the canvas's top-left: love.draw's offset and scale, the
-- collections' 0.9 desktop inset and entrance slide, divided by the device pixel ratio.
package.path='frontend/lua/?.lua;'..package.path
local noop=function()end
-- 700 x 400 CSS pixels at a device pixel ratio of 2: layout scale 1, offset 60 across.
local files={['__viewport.txt']='700 400 0 1400 800',['__page.txt']='1\thome\t'}
local image={release=noop,setFilter=noop,getDimensions=function()return 1850,800 end,getWidth=function()return 245 end,getHeight=function()return 337 end}
local shader={send=noop,release=noop,hasUniform=function()return true end}
package.loaded['ui.menu_logo']={new=function()return {update=noop,draw=noop,getDimensions=function()return 1850,800 end}end}
local audio=setmetatable({isPlaying=function()return false end},{__index=function()return noop end})
-- The graphics transform, translate and scale only.
local t,stack={x=0,y=0,s=1},{}
love={graphics=setmetatable({getDimensions=function()return 1400,800 end,newCanvas=function()return image end,
 newImage=function()return image end,newQuad=function()return {}end,newShader=function()return shader end,
 origin=function()t={x=0,y=0,s=1}end,push=function()stack[#stack+1]={x=t.x,y=t.y,s=t.s}end,pop=function()t=table.remove(stack)end,
 translate=function(dx,dy)t.x,t.y=t.x+dx*t.s,t.y+dy*t.s end,scale=function(s)t.s=t.s*s end,
 transformPoint=function(x,y)return t.x+x*t.s,t.y+y*t.s end},{__index=function()return noop end}),
 math={random=math.random},window={setTitle=noop,setMode=noop},audio={newSource=function()return audio end},
 mouse={getSystemCursor=noop,setCursor=noop,getPosition=function()return 4,4 end,isDown=function()return false end},
 keyboard={isDown=function()return false end},
 filesystem={getInfo=function(name)return files[name] or name:match('sounds/')end,read=function(name)return files[name]end}}
local T=require('ui.theme');T.text=noop
require('ui.button').draw=noop
local screens={}
local function stub(callbacks)
 local s={callbacks=callbacks,cards={},hover=0,slide=0}
 for _,method in ipairs({'open','backgroundColours','keypressed','mousepressed','mousereleased','wheelmoved',
  'retarget','command','close','cancelInteractions','closeModal','layout','draw','drawModal','update'})do s[method]=noop end
 function s:offset()return self.slide end
 function s:backgroundColours()return {T.blue,T.panel,T.panel}end
 function s:editBox()if self.box then return unpack(self.box)end end
 return s
end
for _,name in ipairs({'library','builder','sandbox','simulator','online'})do
 package.loaded['ui.'..name]={new=function(callbacks)local s=stub(callbacks);screens[name]=s;return s end}
end
local popup
package.loaded['ui.settings']={tabs={game=1,graphics=2,audio=3,account=4},new=function(_,callbacks)
 popup=stub(callbacks)
 for _,method in ipairs({'accountChanged','openAuth','openNamePrompt'})do popup[method]=noop end
 function popup:authInput()return false end
 function popup:keypressed(key)if key=='escape' then self.callbacks.close()end end
 return popup
end}
local printed={}
local output=print
print=function(line)if line:find('^COLORLESS:') then printed[#printed+1]=line end end
dofile('frontend/lua/main.lua');love.load()
local function frame()love.update(1/60)end
-- The prints on `channel` since the last look.
local function sent(channel)
 local out={}
 for _,line in ipairs(printed)do
  local c,rest=line:match('^COLORLESS:([%a%-]+):?(.*)$')
  if c==channel then out[#out+1]=rest end
 end
 printed={}
 return table.concat(out,'|')
end
local function expect(got,want,message)
 if got~=want then print=output;error(message..': printed '..got..', wanted '..want,2) end
end
frame();frame();printed={}

-- The deck library at 0.9 about the room's middle: (100,200) is (154,220) in the room, 214 across
-- with the offset, and 360 x 36 large; halved to CSS pixels.
files['__page.txt']='2\tdecks\t';frame();printed={}
local library=screens.library
library.box={100,200,400,40}
library.callbacks.command('input\tsearch\tfire')
expect(sent('library'),'input\tsearch\tfire\t107\t110\t180\t18','The library search opens with its box')
frame();expect(sent('field-box'),'','The box it opened with is not printed again')
library.callbacks.command('edit\tdeck1')
expect(sent('library'),'edit\tdeck1','Opening a deck is no text edit: it carries no box')
library.slide=40;frame()
expect(sent('field-box'),'107\t128\t180\t18','The page sliding down moves the box, at the 0.9 inset')
frame();expect(sent('field-box'),'','An unmoved box prints once')
library.box=nil;frame();expect(sent('field-box'),'','An ended edit prints no box')
library.slide=0;library.box={100,200,400,40};frame()
expect(sent('field-box'),'107\t110\t180\t18','A field that edits again prints its box')
library.box=nil;frame()

-- The lobby draws at the layout scale alone.
files['__page.txt']='3\tonline\t';frame();printed={}
local online=screens.online
online.box={510,300,260,56}
online.callbacks.command('input\tcode\tAB')
expect(sent('online'),'input\tcode\tAB\t285\t150\t130\t28','The lobby code opens with its box')
online.box={510,300.8,260,56};frame()
expect(sent('field-box'),'','Under half a CSS pixel is no move')
online.box={510,320,260,56};frame()
expect(sent('field-box'),'285\t160\t130\t28','The lobby sliding in moves the box')

-- Settings over the lobby: the account name and the sign-in fields; its other commands are bare.
files['__settings.txt']='1\taccount';frame();assert(popup,'Settings opens');printed={}
frame();expect(sent('field-box'),'','Under Settings the lobby\'s field is not followed')
popup.box={460,200,360,40}
popup.callbacks.account('edit\tAsh')
expect(sent('account'),'edit\tAsh\t260\t100\t180\t20','The account name opens with its box')
popup.callbacks.auth('edit\temail')
expect(sent('auth'),'edit\temail\t260\t100\t180\t20','A sign-in field opens with its box')
popup.callbacks.auth('submit');popup.callbacks.account('save\tAsh')
expect(sent('auth'),'submit','Submit carries no box')
popup.box=nil;popup.callbacks.auth('edit\tpassword')
expect(sent('auth'),'edit\tpassword','A field Settings does not draw carries no box')

-- A resize moves it: 480 x 850 CSS pixels at a ratio of 1 is portrait, scale 1, offset 0.
popup.box={60,300,360,40};popup.callbacks.auth('edit\temail');printed={}
files['__viewport.txt']='480 850 0 480 850'
for _=1,20 do frame() end
expect(sent('field-box'),'60\t300\t360\t40','A resize moves the box')
print=output
print('PASS: an edit\'s command carries its field\'s box in CSS pixels, and the box prints again only when it moves')
