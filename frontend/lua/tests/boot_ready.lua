-- The real main.lua tells the host it is ready only once a frame has been drawn: the host hides
-- its loading overlay on that print, and hiding it before the first love.draw showed one black
-- frame between the bar and the menu.
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
 mouse={getSystemCursor=noop,setCursor=noop,getPosition=function()return 0,0 end,isDown=function()return false end},
 keyboard={isDown=function()return false end},
 filesystem={getInfo=function(name)return files[name] or name:match('sounds/')end,read=function(name)return files[name]end}}
local T=require('ui.theme');T.text=noop
require('ui.button').draw=noop
for _,name in ipairs({'library','builder','sandbox','simulator','online'})do
 package.loaded['ui.'..name]={new=function(callbacks)
  local s={callbacks=callbacks,cards={},hover=0}
  for _,method in ipairs({'open','offset','backgroundColours','keypressed','mousepressed','mousereleased','wheelmoved',
   'retarget','command','close','cancelInteractions','editBox','closeModal','layout','draw','update'})do s[method]=noop end
  function s:offset()return 0 end
  function s:backgroundColours()return {T.blue,T.panel,T.panel}end
  return s
 end}
end
package.loaded['ui.settings']={tabs={game=1,graphics=2,audio=3,account=4},new=function()
 local popup={hover=0,focus=0}
 for _,method in ipairs({'layout','draw','update','accountChanged','cancelInteractions','editBox','openAuth','openNamePrompt',
  'mousepressed','keypressed','mousereleased'})do popup[method]=noop end
 return popup
end}
local output=print
local readies=0
print=function(line)if line=='COLORLESS:ready' then readies=readies+1 end end
dofile('frontend/lua/main.lua')
love.load()
assert(readies==0,'Loading alone does not say ready: nothing is on the canvas yet')
love.update(1/60)
assert(readies==0,'The first update, before any draw, does not say ready')
love.draw()
assert(readies==0,'Ready waits for the frame after the first draw, so the drawn frame is on screen')
love.update(1/60)
assert(readies==1,'The update after the first draw says ready')
for _=1,5 do love.draw();love.update(1/60)end
assert(readies==1,'Ready is said once')
print=output
print('PASS: main.lua says ready only after its first frame is drawn')
