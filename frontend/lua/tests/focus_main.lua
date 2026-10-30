-- The real main.lua: a key press hands the highlight from the resting pointer to
-- keyboard focus and pointer movement takes it back, so one home button looks
-- active at a time; the pointer leaving the canvas or a lifted finger clears
-- hover; closing Settings by keyboard returns focus to the button that opened it.
package.path='frontend/lua/?.lua;'..package.path
local noop=function()end
local files={['__viewport.txt']='1280 800 0',['__page.txt']='1\thome\t'}
local image={release=noop,setFilter=noop,getDimensions=function()return 1850,800 end,getWidth=function()return 245 end,getHeight=function()return 337 end}
local shader={send=noop,release=noop,hasUniform=function()return true end}
package.loaded['ui.menu_logo']={new=function()return {update=noop,draw=noop,getDimensions=function()return 1850,800 end}end}
local audio=setmetatable({isPlaying=function()return false end},{__index=function()return noop end})
local mouseX,mouseY,held=0,0,false
love={graphics=setmetatable({getDimensions=function()return 1280,800 end,newCanvas=function()return image end,
 newImage=function()return image end,newQuad=function()return {}end,newShader=function()return shader end,
 transformPoint=function(x,y)return x,y end},{__index=function()return noop end}),
 math={random=math.random},window={setTitle=noop,setMode=noop},audio={newSource=function()return audio end},
 mouse={getSystemCursor=noop,setCursor=noop,getPosition=function()return mouseX,mouseY end,isDown=function()return held end},
 keyboard={isDown=function()return false end},
 filesystem={getInfo=function(name)return files[name] or name:match('sounds/')end,read=function(name)return files[name]end}}
local T=require('ui.theme');T.text=noop
local Button=require('ui.button')
local lit={}
Button.draw=function(b,active)lit[b.label]=active or nil end
local scenes={}
for _,name in ipairs({'library','builder','sandbox','simulator','online'})do
 package.loaded['ui.'..name]={new=function(callbacks)
  local s={callbacks=callbacks,cards={},hover=0}
  for _,method in ipairs({'open','offset','backgroundColours','keypressed','mousepressed','mousereleased','wheelmoved',
   'retarget','command','close','cancelInteractions','editBox','closeModal','layout','draw'})do s[method]=noop end
  function s:offset()return 0 end
  function s:backgroundColours()return {T.blue,T.panel,T.panel}end
  function s:update(_,_,mx,my)self.mx,self.my=mx,my end
  scenes[name]=s;return s
 end}
end
local popup
package.loaded['ui.settings']={tabs={game=1,graphics=2,audio=3,account=4},new=function(_,callbacks)
 popup={callbacks=callbacks,hover=0,focus=0}
 for _,method in ipairs({'layout','draw','accountChanged','cancelInteractions','editBox','openAuth','openNamePrompt','mousepressed'})do popup[method]=noop end
 function popup:update(_,_,mx)self.mx=mx end
 function popup:keypressed(key)if key=='escape' then self.callbacks.close()end end
 function popup:mousereleased()self.callbacks.close()end
 function popup:authInput(raw)return raw=='next' end
 return popup
end}
local output=print
print=noop
dofile('frontend/lua/main.lua');love.load()
local function frame()love.update(1/60);lit={};love.draw()end
local function only(label,message)
 local n=0;for _ in pairs(lit)do n=n+1 end
 if label then assert(lit[label] and n==1,message) else assert(n==0,message) end
end
local function move(x,y)mouseX,mouseY=x,y;love.mousemoved(x,y,1,1);frame()end
-- The raw pointer position that hovers Sandbox, through the room and CRT mapping.
local sandboxAt
for y=560,640,8 do for x=320,500,8 do
 if not sandboxAt then move(x,y);if lit.Sandbox then sandboxAt={x,y} end end
end end
assert(sandboxAt,'A pointer position hovers Sandbox')
move(sandboxAt[1],sandboxAt[2]);only('Sandbox','The pointer lights the button under it')
love.keypressed('tab');love.keypressed('tab');frame()
only('Online','A key press moves the highlight to keyboard focus; the resting pointer no longer lights Sandbox')
frame();only('Online','The highlight stays with focus until the pointer moves')
move(sandboxAt[1]+1,sandboxAt[2])
only('Sandbox','Moving the pointer takes the highlight back')
move(4,4);only('Online','Over no button, keyboard focus shows again')
love.mousepressed(4,4,1);love.mousereleased(4,4,1)
move(sandboxAt[1],sandboxAt[2]);only('Sandbox','A click clears focus')
love.mousefocus(false);frame()
only(nil,'Hover clears when the pointer leaves the canvas')
move(sandboxAt[1]+1,sandboxAt[2]);only('Sandbox','Hover returns with the next move')
love.touchreleased(1,sandboxAt[1],sandboxAt[2]);frame()
only(nil,'Hover clears when the finger lifts')
move(sandboxAt[1],sandboxAt[2])
love.mousepressed(sandboxAt[1],sandboxAt[2],1);held=true;love.mousereleased(sandboxAt[1],sandboxAt[2],1,true);held=false;frame()
only(nil,'A tap leaves no button highlighted')

-- Settings: a keyboard close restores the opener, a pointer close leaves none.
local function focusAndOpen(label,steps)
 move(4,4);love.mousepressed(4,4,1);love.mousereleased(4,4,1);frame()
 for _=1,steps do love.keypressed('tab')end
 frame();only(label,label..' has keyboard focus')
 love.keypressed('return');assert(popup and popup.callbacks,label..' opens Settings')
end
focusAndOpen('Account',4)
love.keypressed('escape');frame()
only('Account','Escape returns focus to Account, which opened Settings')
focusAndOpen('Settings',5)
love.keypressed('escape');frame()
only('Settings','Escape returns focus to Settings')
focusAndOpen('Account',4)
love.mousepressed(4,4,1);love.mousereleased(4,4,1);frame()
only(nil,'A pointer close leaves no control focused')
files['__settings.txt']='1\taccount';frame();assert(popup,'A host request opens Settings')
love.keypressed('escape');frame()
only('Account','A host-opened Account tab returns focus to Account')

-- A native field's Tab is keyboard input too, and every page's hover parks with it.
files['__settings.txt']='2\tgame';frame()
move(sandboxAt[1],sandboxAt[2]);assert(popup.mx>0,'Settings follows the pointer')
files['__auth_input.txt']='next';frame();files['__auth_input.txt']=nil;frame()
assert(popup.mx==-1000,'A native field\'s Tab parks the pointer')
love.keypressed('escape');frame()
files['__page.txt']='2\tdecks\t';frame()
move(sandboxAt[1],sandboxAt[2]);assert(scenes.library.mx>0,'The collection follows the pointer')
love.keypressed('down');frame();assert(scenes.library.mx<-900,'A key press parks the collection\'s pointer')
move(sandboxAt[1]+1,sandboxAt[2]);assert(scenes.library.mx>0,'Moving the pointer brings it back')
held=true;love.keypressed('down');frame();assert(scenes.library.mx>0,'A key press during a drag keeps the pointer')
held=false;frame();assert(scenes.library.mx>0,'Ending that drag leaves the pointer live')
held=true;love.mousefocus(false);frame();assert(scenes.library.mx>0,'A drag off the canvas keeps its pointer')
held=false;frame();assert(scenes.library.mx<-900,'Releasing it off the canvas parks the pointer')
print=output
print('PASS: one home highlight at a time, keyboard takes over and pointer movement takes back, hover clears on leave and tap, Settings returns focus to its opener')
