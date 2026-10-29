-- The real main.lua tells the page where home's keyboard focus sits in its ring: 'last' on the
-- last button and 'first' on the first, so the host lets the next Tab or Shift+Tab leave the
-- canvas, and 'none' anywhere else, with nothing focused, under Settings, during a wipe and off
-- home. It prints only when the edge changes.
package.path='frontend/lua/?.lua;'..package.path
local noop=function()end
local files={['__viewport.txt']='1280 800 0',['__page.txt']='1\thome\t'}
local image={release=noop,setFilter=noop,getDimensions=function()return 1850,800 end,getWidth=function()return 245 end,getHeight=function()return 337 end}
local shader={send=noop,release=noop,hasUniform=function()return true end}
package.loaded['ui.menu_logo']={new=function()return {update=noop,draw=noop,getDimensions=function()return 1850,800 end}end}
local audio=setmetatable({isPlaying=function()return false end},{__index=function()return noop end})
local shift=false
love={graphics=setmetatable({getDimensions=function()return 1280,800 end,newCanvas=function()return image end,
 newImage=function()return image end,newQuad=function()return {}end,newShader=function()return shader end,
 transformPoint=function(x,y)return x,y end},{__index=function()return noop end}),
 math={random=math.random},window={setTitle=noop,setMode=noop},audio={newSource=function()return audio end},
 mouse={getSystemCursor=noop,setCursor=noop,getPosition=function()return 4,4 end,isDown=function()return false end},
 keyboard={isDown=function()return shift end},
 filesystem={getInfo=function(name)return files[name] or name:match('sounds/')end,read=function(name)return files[name]end}}
local T=require('ui.theme');T.text=noop
require('ui.button').draw=noop
for _,name in ipairs({'library','builder','sandbox','simulator','online'})do
 package.loaded['ui.'..name]={new=function(callbacks)
  local s={callbacks=callbacks,cards={},hover=0}
  for _,method in ipairs({'open','offset','backgroundColours','keypressed','mousepressed','mousereleased','wheelmoved',
   'retarget','command','close','cancelInteractions','closeModal','layout','draw','update'})do s[method]=noop end
  function s:offset()return 0 end
  function s:backgroundColours()return {T.blue,T.panel,T.panel}end
  return s
 end}
end
local popup
package.loaded['ui.settings']={tabs={game=1,graphics=2,audio=3,account=4},new=function(_,callbacks)
 popup={callbacks=callbacks,hover=0,focus=0}
 for _,method in ipairs({'layout','draw','accountChanged','cancelInteractions','openAuth','openNamePrompt','mousepressed','update'})do popup[method]=noop end
 function popup:keypressed(key)if key=='escape' then self.callbacks.close()end end
 function popup:authInput()return false end
 return popup
end}
local edges={}
local output=print
print=function(line)
 local edge=line:match('^COLORLESS:focus%-edge:(.*)$')
 if edge then edges[#edges+1]=edge end
end
dofile('frontend/lua/main.lua');love.load()
local function frame()love.update(1/60);love.draw()end
local function press(key)love.keypressed(key);frame()end
local function heard(...)
 local want={...}
 local got=table.concat(edges,',');edges={}
 return got==table.concat(want,','),got
end
local function expect(message,...)
 local ok,got=heard(...)
 if not ok then print=output;error(message..' (printed '..got..')',2) end
end
frame();expect('Home with nothing focused prints nothing: the page starts at none')
-- The ring is Sandbox, Online, Decks, Account, Settings.
press('tab');expect('Tab onto Sandbox reaches the first edge','first')
press('tab');expect('Online is inside the ring','none')
press('tab');press('tab');expect('Decks and Account are inside the ring; nothing repeats')
press('tab');expect('Settings is the last edge','last')
frame();expect('The edge prints once')
press('tab');expect('A Tab that reaches Lua wraps to Sandbox','first')
shift=true;press('tab');shift=false;expect('Shift+Tab wraps back to Settings','last')
press('left');press('left');press('left');press('left');expect('Arrows move it too','none','first')
press('escape');expect('Escape clears focus','none')
press('up');expect('Up from nothing lands on the last button','last')
press('return');assert(popup and popup.callbacks,'Enter on Settings opens it');frame()
expect('Settings over home has no edge','none')
press('escape');expect('A keyboard close back on Settings restores the edge','last')
love.mousepressed(4,4,1);love.mousereleased(4,4,1);frame();expect('A click clears focus','none')
press('tab');expect('Tab after a click starts at the first button','first')
files['__page.txt']='2\tdecks\t';frame();frame()
expect('Off home there is no edge','none')
files['__page.txt']='3\thome\t';frame()
press('down');expect('Back on home the ring starts again','first')
files['__page.txt']='4\tsimulator\t';frame()
expect('A wipe to the table has no edge','none')
print=output
print('PASS: home prints its focus edge as the ring moves, none off home, under Settings and with nothing focused')
