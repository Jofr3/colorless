-- The menu boots and takes input before the host has written the music; the music starts once it
-- arrives, and effects decode on first use or one per frame.
package.path='frontend/lua/?.lua;'..package.path
local noop=function()end
local files={['__viewport.txt']='1280 800 0',['__page.txt']='1\thome\t',['assets/sounds/button.ogg']=true,['assets/sounds/win.ogg']=true}
local image={release=noop,setFilter=noop,getDimensions=function()return 1850,800 end,getWidth=function()return 245 end,getHeight=function()return 337 end}
local shader={send=noop,release=noop,hasUniform=function()return true end}
package.loaded['ui.menu_logo']={new=function()return {update=noop,draw=noop,getDimensions=function()return 1850,800 end}end}
local created={}
local function source(path,kind)
  local s={path=path,kind=kind,playing=false,plays=0}
  function s:play()self.playing=true;self.plays=self.plays+1 end
  function s:pause()self.playing=false end
  function s:stop()self.playing=false end
  function s:isPlaying()return self.playing end
  function s:clone()return source(path,kind)end
  for _,m in ipairs({'setLooping','setVolume','setPitch','release'})do s[m]=noop end
  created[#created+1]=s
  return s
end
love={graphics=setmetatable({getDimensions=function()return 1280,800 end,newCanvas=function()return image end,
 newImage=function()return image end,newQuad=function()return {}end,newShader=function()return shader end,
 transformPoint=function(x,y)return x,y end},{__index=function()return noop end}),
 math={random=math.random},window={setTitle=noop,setMode=noop},audio={newSource=source},
 mouse={getSystemCursor=noop,setCursor=noop,getPosition=function()return 0,0 end},keyboard={isDown=function()return false end},
 filesystem={getInfo=function(name)return files[name] and {} or nil end,read=function(name)return files[name]end}}
local T=require('ui.theme');T.text=noop
for _,name in ipairs({'library','builder','sandbox','simulator','settings','online'})do
 package.loaded['ui.'..name]={tabs={game=1},new=function()
  local s={hover=0,cards={}}
  for _,m in ipairs({'open','offset','keypressed','mousepressed','mousereleased','wheelmoved','command','close','cancelInteractions','layout','closeModal','update','draw'})do s[m]=noop end
  function s:backgroundColours()return {T.blue,T.panel,T.panel}end
  return s
 end}
end
local output=print
print=noop
local function sourceFor(path)for _,s in ipairs(created)do if s.path==path then return s end end end
local function frames(n)for _=1,n do love.update(1/60)end end
dofile('frontend/lua/main.lua');love.load()
assert(#created==0,'No source decodes before the first frame')
love.mousepressed(10,10,1);love.mousereleased(10,10,1)
love.keypressed('m');love.keypressed('m')
love.focus(false);love.focus(true)
frames(30)
assert(not sourceFor('assets/sounds/music1.ogg'),'Without the music file the menu runs silent')
assert(sourceFor('assets/sounds/button.ogg') and sourceFor('assets/sounds/win.ogg'),'Effects decode one per frame')
assert(sourceFor('assets/sounds/button.ogg').kind=='static')
files['assets/sounds/music1.ogg']=true;frames(20)
local music=sourceFor('assets/sounds/music1.ogg')
assert(music and music.kind=='stream','The music loads once the host writes it')
assert(music.playing,'Music plays at once when audio was already unlocked')
love.focus(false);assert(not music.playing,'Music pauses without focus')
love.focus(true);assert(music.playing,'Music resumes with focus')
love.keypressed('m');assert(not music.playing,'Muting pauses the music')
print=output
print('PASS: menu boots without music, music starts when it arrives, effects load lazily')
