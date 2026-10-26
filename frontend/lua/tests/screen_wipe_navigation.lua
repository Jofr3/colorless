-- Exercise the real main.lua routing/input lifecycle with isolated mailboxes.
package.path='frontend/lua/?.lua;'..package.path
local noop=function()end
local files={['__viewport.txt']='1280 800 0',['__page.txt']='1\thome\t'}
local image={release=noop,setFilter=noop,getDimensions=function()return 1850,800 end,getWidth=function()return 245 end,getHeight=function()return 337 end}
local shader={send=noop,release=noop,hasUniform=function()return true end}
-- Logo loading is exercised separately; this test owns routing.
package.loaded['ui.menu_logo']={new=function()return {update=noop,draw=noop,getDimensions=function()return 1850,800 end}end}
local audio=setmetatable({isPlaying=function()return false end},{__index=function()return noop end})
love={graphics=setmetatable({getDimensions=function()return 1280,800 end,newCanvas=function()return image end,
 newImage=function()return image end,newQuad=function()return {}end,newShader=function()return shader end,
 transformPoint=function(x,y)return x,y end},{__index=function()return noop end}),
 math={random=math.random},window={setTitle=noop,setMode=noop},audio={newSource=function()return audio end},
 mouse={getSystemCursor=noop,setCursor=noop,getPosition=function()return 0,0 end},keyboard={isDown=function()return false end},
 filesystem={getInfo=function(name)return files[name] or name:match('sounds/')end,read=function(name)return files[name]end}}
local T=require('ui.theme');T.text=noop
local scenes={}
for _,name in ipairs({'library','builder','sandbox','simulator','settings','online'})do
 package.loaded['ui.'..name]={new=function(callbacks)
  local s={callbacks=callbacks,cards={},hover=0,opens=0,inputs=0}
  function s:open(...)self.opens=self.opens+1;self.args={...}end
  function s:offset()return 0 end
  function s:backgroundColours()return {T.blue,T.panel,T.panel}end
  function s:keypressed()self.inputs=self.inputs+1 end
  s.mousepressed=s.keypressed;s.mousereleased=s.keypressed;s.wheelmoved=s.keypressed
  function s:retarget(id)self.target=id end
  function s:command(c)self.last=c end
  function s:close()self.closes=(self.closes or 0)+1 end
  function s:cancelInteractions()self.cancels=(self.cancels or 0)+1 end
  function s:openAuth(mode)self.auth=mode end
  for _,method in ipairs({'layout','closeModal','update','draw','authInput','accountChanged'})do s[method]=noop end
  scenes[name]=s;return s
 end}
end
package.loaded['ui.settings'].tabs={game=1,graphics=2,audio=3,account=4}
local messages={}
local output=print
print=function(s)messages[#messages+1]=s end
dofile('frontend/lua/main.lua');love.load()
local function frames(n)for _=1,n do love.update(1/60)end end
local function route(rev,page)files['__page.txt']=rev..'\t'..page..'\t';frames(3)end
local function count(message)local n=0;for _,m in ipairs(messages)do if m==message then n=n+1 end end;return n end
local pages={'library','builder','sandbox','online','simulator'}
for _,name in ipairs(pages)do
 scenes[name].callbacks.command('probe')
 assert(messages[#messages]=='COLORLESS:'..name..':probe','Each screen prints on its own channel')
end
route(2,'simulator')
assert(scenes.simulator.opens==0 and count('COLORLESS:transition:open')==1)
for _,name in ipairs(pages)do assert(scenes[name].cancels==1,name..' drops held interactions when the wipe starts')end
for _,name in ipairs(pages)do scenes[name].callbacks.signin()end
assert(not scenes.settings,'Sign-in waits out the wipe on every page')
love.mousepressed(200,200,1);love.mousereleased(200,200,1);love.keypressed('escape');love.wheelmoved(0,1)
assert(scenes.simulator.inputs==0,'All input paths must be locked during the wipe')
frames(36);assert(scenes.simulator.opens==0,'Destination cannot open before coverage')
frames(12);assert(scenes.simulator.opens==1,'Destination must open while covered')
love.resize(390,844);frames(120)
assert(count('COLORLESS:transition:closed')==1,'Resize must not replay or strand the wipe')
love.keypressed('escape');assert(scenes.simulator.inputs==1,'Input unlocks after removal')
-- A second history destination before coverage replaces the first one.
route(3,'home');route(4,'decks');frames(140)
assert(scenes.library.opens==1 and scenes.simulator.opens==1)
assert(count('COLORLESS:transition:open')==2 and count('COLORLESS:transition:closed')==2)
-- Reduced motion switches immediately once the mailbox is processed.
files['__viewport.txt']='1280 800 1';frames(16)
route(5,'simulator');frames(5)
assert(scenes.simulator.opens==2)
assert(count('COLORLESS:transition:open')==3 and count('COLORLESS:transition:closed')==3)
-- The lobby modal opens over home without a wipe; its code retargets in place.
files['__viewport.txt']='1280 800 0'
route(6,'home');frames(140);route(7,'online');frames(5)
assert(scenes.online.opens==1 and count('COLORLESS:transition:open')==4,'Home to online must not wipe')
route(8,'online\tABCD');frames(5)
assert(scenes.online.opens==1 and scenes.online.target=='ABCD','Online to online retargets without reopening')
love.keypressed('escape');assert(scenes.online.inputs==1,'Online receives input')
-- The live match is a table page: online to match wipes and opens it online.
route(9,'match\tABCD')
assert(count('COLORLESS:transition:open')==5 and scenes.simulator.opens==2,'Online to match wipes before opening')
frames(140)
assert(scenes.simulator.opens==3 and scenes.online.closes==1,'The lobby closes while covered')
local a=scenes.simulator.args;assert(a[3]=='online' and a[4]=='ABCD','Match opens the online table')
love.keypressed('escape');assert(scenes.simulator.inputs==2,'The match table receives input')
-- A rematch hands back to the lobby modal with another wipe.
route(10,'online\tABCD');frames(140)
assert(count('COLORLESS:transition:open')==6 and scenes.online.opens==2 and scenes.simulator.last=='close','Match to online wipes and closes the table')
-- The page mailbox is followed on the next frame, without waiting for the viewport poll.
files['__page.txt']='11\tdecks\t';love.update(1/60)
assert(scenes.library.opens==2,'A route change applies on the next frame')
-- A Settings request opens Settings on the named tab, once per request.
files['__settings.txt']='1\taccount';love.update(1/60)
assert(scenes.settings.tab==4 and count('COLORLESS:settings:open')==1,'Settings opens on the Account tab')
frames(3);assert(count('COLORLESS:settings:open')==1,'A request is answered once')
for _,name in ipairs(pages)do
 scenes.settings.auth=nil;scenes[name].callbacks.signin()
 assert(scenes.settings.auth=='login',name..' signs in through the open Settings')
end
local before=scenes.library.cancels
love.focus(false)
assert(scenes.settings.cancels==1 and scenes.library.cancels==before+1,'Losing focus drops held interactions, Settings included')
print=output
print('PASS: covered scene changes, input lock/unlock, resize, coalesced navigation, reduced-motion, online and match routing')
