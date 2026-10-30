-- The real main.lua shows and says the page's notice mailbox: a game table whose code could not
-- load offline says so on home, under the menu, instead of the page reloading onto an error page.
-- Each new revision is said again; the line goes after a few seconds.
package.path='frontend/lua/?.lua;'..package.path
local noop=function()end
local files={['__viewport.txt']='1280 800 0',['__page.txt']='1\thome\t'}
local image={release=noop,setFilter=noop,getDimensions=function()return 1850,800 end,getWidth=function()return 245 end,getHeight=function()return 337 end}
local shader={send=noop,release=noop,hasUniform=function()return true end}
package.loaded['ui.menu_logo']={new=function()return {update=noop,draw=noop,getDimensions=function()return 1850,800 end}end}
local audio=setmetatable({isPlaying=function()return false end},{__index=function()return noop end})
love={graphics=setmetatable({getDimensions=function()return 1280,800 end,newCanvas=function()return image end,
 newImage=function()return image end,newQuad=function()return {}end,newShader=function()return shader end,
 transformPoint=function(x,y)return x,y end},{__index=function()return noop end}),
 math={random=math.random},window={setTitle=noop,setMode=noop},audio={newSource=function()return audio end},
 mouse={getSystemCursor=noop,setCursor=noop,getPosition=function()return 4,4 end,isDown=function()return false end},
 keyboard={isDown=function()return false end},
 filesystem={getInfo=function(name)return files[name] or name:match('sounds/')end,read=function(name)return files[name]end}}
local T=require('ui.theme');T.text=noop
local Button=require('ui.button')
Button.draw=noop
local lines={}
Button.errorLine=function(text,_,_,y)lines[#lines+1]={text=text,y=y}end
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
local said={}
local output=print
print=function(line)
 local text=line:match('^COLORLESS:announce:(.*)$')
 if text then said[#said+1]=(text:gsub('%%(%x%x)',function(h)return string.char(tonumber(h,16))end)) end
end
local function fail(message)print=output;error(message,2)end
dofile('frontend/lua/main.lua');love.load()
local function frame(dt)lines={};love.update(dt or 1/60);love.draw()end
frame();said={}
if #lines>0 then fail('No notice, no line') end
local OFFLINE="You're offline. Check your connection, then try again."
files['__notice.txt']='1\tYou\'re%20offline.%20Check%20your%20connection%2C%20then%20try%20again.'
frame()
if said[1]~=OFFLINE then fail('The notice is said (said '..tostring(said[1])..')') end
if not lines[1] or lines[1].text~=OFFLINE then fail('The notice shows on home') end
if lines[1].y<650 or lines[1].y>700 then fail('Home shows it under the menu (y='..lines[1].y..')') end
said={};frame()
if #said>0 then fail('The same revision is said once') end
if not lines[1] then fail('It stays on screen for a while') end
files['__notice.txt']='2\tYou\'re%20offline.%20Check%20your%20connection%2C%20then%20try%20again.'
frame()
if said[1]~=OFFLINE then fail('A new revision of the same notice is said again') end
-- A frame advances the clock by at most 0.1 s.
for _=1,100 do frame(1) end
if #lines>0 then fail('The line goes after a few seconds') end
print=output
print('host_notice: ok')
