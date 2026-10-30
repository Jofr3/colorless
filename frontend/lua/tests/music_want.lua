-- The host downloads the menu music only when Lua asks for it (audit BT8): once the stored
-- preferences say it would be heard ('start'), and when the player unmutes or turns a volume up
-- ('change'). A muted player, or one whose volume or music volume is zero, never asks.
package.path='frontend/lua/?.lua;'..package.path
local noop=function()end
local image={release=noop,setFilter=noop,getDimensions=function()return 1850,800 end,getWidth=function()return 245 end,getHeight=function()return 337 end}
local shader={send=noop,release=noop,hasUniform=function()return true end}
package.loaded['ui.menu_logo']={new=function()return {update=noop,draw=noop,getDimensions=function()return 1850,800 end}end}
local T=require('ui.theme');T.text=noop
local settings
for _,name in ipairs({'library','builder','sandbox','simulator','settings','online'})do
 package.loaded['ui.'..name]={tabs={game=1},new=function(preferences,callbacks)
  local s={hover=0,cards={},preferences=preferences,callbacks=callbacks}
  for _,m in ipairs({'open','offset','keypressed','mousepressed','mousereleased','wheelmoved','command','close','cancelInteractions','layout','closeModal','update','draw','authInput','accountChanged','openAuth'})do s[m]=noop end
  function s:backgroundColours()return {T.blue,T.panel,T.panel}end
  if name=='settings' then settings=s end
  return s
 end}
end
local Preferences=require('ui.preferences')
local output=print
local said
print=function(message) said[#said+1]=message end
-- One boot of main.lua with these stored preferences (nil: the page has none yet).
local function boot(stored,extraFiles)
  local files={['__viewport.txt']='1280 800 0',['__page.txt']='1\thome\t',['__preferences.txt']=stored or ''}
  for name,value in pairs(extraFiles or {}) do files[name]=value end
  local audio=setmetatable({isPlaying=function()return false end},{__index=function()return noop end})
  love={graphics=setmetatable({getDimensions=function()return 1280,800 end,newCanvas=function()return image end,
   newImage=function()return image end,newQuad=function()return {}end,newShader=function()return shader end,
   transformPoint=function(x,y)return x,y end},{__index=function()return noop end}),
   math={random=math.random},window={setTitle=noop,setMode=noop},audio={newSource=function()return audio end},
   mouse={getSystemCursor=noop,setCursor=noop,getPosition=function()return 0,0 end,isDown=function()return false end},keyboard={isDown=function()return false end},
   filesystem={getInfo=function(name)return files[name] and {} or nil end,read=function(name)return files[name]end}}
  said={}
  settings=nil
  dofile('frontend/lua/main.lua');love.load()
  for _=1,30 do love.update(1/60) end
  return files
end
local function asks(reason)
  local n=0
  for _,message in ipairs(said) do
    if message=='COLORLESS:music:want\t'..reason then n=n+1 end
    assert(not message:match('^COLORLESS:music') or message:match('^COLORLESS:music:want\t%a+$'),'unexpected '..message)
  end
  return n
end
local function record(values)
  local p=Preferences.new()
  for key,value in pairs(values) do p[key]=value end
  return p:serialize()
end
-- The settings popup, as the page's Settings link opens it, with a value changed in it.
local function change(files,key,value)
  files['__settings.txt']='1\tgame'
  for _=1,2 do love.update(1/60) end
  assert(settings,'Settings opened')
  settings.preferences[key]=value
  said={}
  settings.callbacks.changed()
end

-- Default and stored audible preferences ask once, at start.
boot(nil)
assert(asks('start')==1,'Audible defaults ask for the music once')
love.keypressed('m');assert(asks('start')==1 and asks('change')==0,'Muting asks for nothing')
said={};love.keypressed('m');assert(asks('change')==1,'Unmuting asks again')

-- Muted: no ask until the player unmutes.
boot(record({muted=1}))
assert(asks('start')+asks('change')==0,'A muted player never asks at start')
love.keypressed('m')
assert(asks('change')==1,'Unmuting asks for the music')

-- Volume zero or music volume zero: no ask; turning it up asks.
local files=boot(record({volume=0}))
assert(asks('start')+asks('change')==0,'Volume zero asks for nothing')
change(files,'volume',40)
assert(asks('change')==1,'Raising the volume from zero asks')
files=boot(record({musicVolume=0}))
assert(asks('start')+asks('change')==0,'Music volume zero asks for nothing')
change(files,'effectsVolume',20)
assert(asks('change')==0,'An effects change is not a music raise')
change(files,'musicVolume',10)
assert(asks('change')==1,'Raising the music volume from zero asks')
-- A raise while audible asks too (the host skipped the start ask under Save-Data); a lowering
-- does not.
files=boot(record({volume=30}))
assert(asks('start')==1)
change(files,'volume',20);assert(asks('change')==0,'Turning the volume down asks for nothing')
change(files,'volume',60);assert(asks('change')==1,'Turning the volume up asks')

-- Once the music is there, nothing asks.
files=boot(record({muted=1}),{['assets/sounds/music1.ogg']=true})
love.keypressed('m');assert(asks('change')==0,'Music already written asks for nothing')
files=boot(nil,{['assets/sounds/music1.ogg']=true})
assert(asks('start')==0,'Music already written asks for nothing at start')

print=output
print('PASS: music is asked for at start only when audible, and on unmute or a volume raise')
