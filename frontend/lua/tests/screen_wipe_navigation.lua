-- Exercise the real main.lua routing/input lifecycle with isolated mailboxes.
package.path='frontend/lua/?.lua;'..package.path
local noop=function()end
local files={['__viewport.txt']='1280 800 0 0 0 0',['__page.txt']='1\thome\t'}
local image={release=noop,setFilter=noop,getDimensions=function()return 1850,800 end,getWidth=function()return 245 end,getHeight=function()return 337 end}
local shader={send=noop,hasUniform=function()return true end}
local audio=setmetatable({isPlaying=function()return false end},{__index=function()return noop end})
love={graphics=setmetatable({getDimensions=function()return 1280,800 end,newCanvas=function()return image end,
 newImage=function()return image end,newQuad=function()return {}end,newShader=function()return shader end,
 transformPoint=function(x,y)return x,y end},{__index=function()return noop end}),
 math={random=math.random},window={setTitle=noop,setMode=noop},audio={newSource=function()return audio end},
 mouse={getSystemCursor=noop,setCursor=noop,getPosition=function()return 0,0 end},keyboard={isDown=function()return false end},
 filesystem={getInfo=function(name)return files[name] or name:match('sounds/')end,read=function(name)return files[name]end}}
local T=require('ui.theme');T.text=noop
local scenes={}
for _,name in ipairs({'library','builder','sandbox','simulator','settings'})do
 package.loaded['ui.'..name]={new=function(callbacks)
  local s={callbacks=callbacks,cards={},hover=0,opens=0,inputs=0}
  function s:open()self.opens=self.opens+1 end
  function s:offset()return 0 end
  function s:backgroundColours()return {T.blue,T.panel,T.panel}end
  function s:keypressed()self.inputs=self.inputs+1 end
  s.mousepressed=s.keypressed;s.mousereleased=s.keypressed;s.wheelmoved=s.keypressed
  for _,method in ipairs({'layout','command','closeModal','update','draw'})do s[method]=noop end
  scenes[name]=s;return s
 end}
end
local messages={}
local output=print
print=function(s)messages[#messages+1]=s end
dofile('frontend/lua/main.lua');love.load()
local function frames(n)for _=1,n do love.update(1/60)end end
local function route(rev,page)files['__page.txt']=rev..'\t'..page..'\t';frames(17)end
local function count(message)local n=0;for _,m in ipairs(messages)do if m==message then n=n+1 end end;return n end
route(2,'simulator')
assert(scenes.simulator.opens==0 and count('LUMINOUS:transition:open')==1)
love.mousepressed(200,200,1);love.mousereleased(200,200,1);love.keypressed('escape');love.wheelmoved(0,1)
assert(scenes.simulator.inputs==0,'All input paths must be locked during the wipe')
frames(36);assert(scenes.simulator.opens==0,'Destination cannot open before coverage')
frames(12);assert(scenes.simulator.opens==1,'Destination must open while covered')
love.resize(390,844);frames(120)
assert(count('LUMINOUS:transition:closed')==1,'Resize must not replay or strand the wipe')
love.keypressed('escape');assert(scenes.simulator.inputs==1,'Input unlocks after removal')
-- A second history destination before coverage replaces the first one.
route(3,'home');route(4,'decks');frames(140)
assert(scenes.library.opens==1 and scenes.simulator.opens==1)
assert(count('LUMINOUS:transition:open')==2 and count('LUMINOUS:transition:closed')==2)
-- Reduced motion switches immediately once the mailbox is processed.
files['__viewport.txt']='1280 800 1 0 0 0'
route(5,'simulator');frames(5)
assert(scenes.simulator.opens==2)
assert(count('LUMINOUS:transition:open')==3 and count('LUMINOUS:transition:closed')==3)
print=output
print('PASS: covered scene changes, input lock/unlock, resize, coalesced navigation and reduced-motion routing')
