-- Boot compiles only what home's first frame needs (audit LC8): splash and CRT in love.load. The
-- table and card shaders (background, dissolve, played) compile one per update once the host has
-- been told ready, and at once when a page or a wipe needs them first: a deep link to a table or
-- the decks page, or a wipe started before the warm-up got to them. No draw meets a missing one.
package.path='frontend/lua/?.lua;'..package.path
local noop=function() end
local function check(ok,message) if not ok then error(message,2) end end
local files={['__viewport.txt']='1280 800 0',['__page.txt']='1\thome\t'}
local compiled,order={},{}
local function shader(name)
  return {name=name,send=function() check(compiled[name],name..' is used before it compiled') end,release=noop,hasUniform=function() return true end}
end
local image={release=noop,setFilter=noop,getDimensions=function() return 1850,800 end,getWidth=function() return 245 end,getHeight=function() return 337 end}
package.loaded['ui.menu_logo']={new=function() return {update=noop,draw=noop,getDimensions=function() return 1850,800 end} end}
local audio=setmetatable({isPlaying=function() return false end},{__index=function() return noop end})
love={graphics=setmetatable({getDimensions=function() return 1280,800 end,newCanvas=function() return image end,
  newImage=function() return image end,newQuad=function() return {} end,
  newShader=function(path)
    local name=path:match('([%w_]+)%.fs$')
    check(not compiled[name],name..' compiles once')
    compiled[name]=true;order[#order+1]=name
    return shader(name)
  end,
  setShader=function(s) if s then check(compiled[s.name],'A draw sets '..s.name..' before it compiled') end end,
  transformPoint=function(x,y) return x,y end},{__index=function() return noop end}),
  math={random=math.random},window={setTitle=noop,setMode=noop},audio={newSource=function() return audio end},
  mouse={getSystemCursor=noop,setCursor=noop,getPosition=function() return 0,0 end,isDown=function() return false end},
  keyboard={isDown=function() return false end},
  filesystem={getInfo=function(name) return files[name] or name:match('sounds/') end,read=function(name) return files[name] end}}
local T=require('ui.theme');T.text=noop
require('ui.button').draw=noop
-- Every page draws with the shaders it needs: the table background.fs, dissolve and played; the
-- collection pages dissolve and played.
local need={simulator={'dissolve','played'},library={'dissolve','played'},builder={'dissolve','played'},sandbox={'dissolve','played'}}
for _,name in ipairs({'library','builder','sandbox','simulator','online'}) do
  package.loaded['ui.'..name]={new=function(callbacks)
    local s={callbacks=callbacks,cards={},hover=0}
    for _,method in ipairs({'open','keypressed','mousepressed','mousereleased','wheelmoved','retarget','command','close',
      'cancelInteractions','editBox','closeModal','layout','update','drawModal'}) do s[method]=noop end
    function s:offset() return 0 end
    function s:backgroundColours() return {T.blue,T.panel,T.panel} end
    function s:draw(shaders)
      for _,n in ipairs(need[name] or {}) do
        check(shaders[n],name..' draws with '..n)
        love.graphics.setShader(shaders[n])
      end
    end
    return s
  end}
end
local readies=0
local output=print
print=function(line) if line=='COLORLESS:ready' then readies=readies+1 end end
dofile('frontend/lua/main.lua')
local function has(...)
  for _,name in ipairs({...}) do if not compiled[name] then return false end end
  return true
end
local function count() return #order end
-- Starts main.lua afresh, with nothing compiled.
local function reboot(page)
  for k in pairs(compiled) do compiled[k]=nil end
  for i=#order,1,-1 do order[i]=nil end
  files['__page.txt']=page
  dofile('frontend/lua/main.lua')
  readies=0
end
love.load()
check(count()==2 and has('splash','CRT'),'love.load compiles only splash and CRT: '..table.concat(order,' '))
love.update(1/60);love.draw()
check(count()==2,'The first frame compiles nothing more')
love.update(1/60)
check(readies==1 and count()==2,'The update that says ready compiles nothing more')
love.draw()
for i=1,3 do
  love.update(1/60);love.draw()
  check(count()==2+i,'Each update after ready compiles one more shader ('..count()..')')
end
check(has('background','dissolve','played'),'The warm-up compiles the table and card shaders')
for _=1,10 do love.update(1/60);love.draw() end
check(count()==5,'and then nothing more')
-- A second boot whose wipe starts before the warm-up: a page change to the table right after
-- ready compiles what the wipe and the table draw with, at once.
reboot('1\thome\t')
love.load();love.update(1/60);love.draw();love.update(1/60)
check(readies==1 and count()==2,'Ready, with only splash and CRT compiled')
files['__page.txt']='2\tsimulator\t'
love.update(1/60)
check(has('background','dissolve','played'),'A wipe to the table compiles its shaders when it starts')
for _=1,120 do love.update(1/60);love.draw() end
-- Deep links: the table and the decks page draw their first frame with their shaders.
for _,page in ipairs({'1\tsimulator\t','1\tdecks\t','1\tbuilder\tdeck-1','1\tsandbox\t'}) do
  reboot(page)
  love.load()
  check(has('dissolve','played'),page:gsub('\t',' ')..' compiles its card shaders in love.load')
  if page:match('simulator') then check(has('background'),'The table compiles background.fs in love.load') end
  love.update(1/60);love.draw()
end
print=output
print('PASS: boot compiles splash and CRT, warms the rest one per update after ready, and compiles early for wipes')
