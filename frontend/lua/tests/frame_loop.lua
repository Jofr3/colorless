-- The real main.lua's love.run (audit LC1): events are pumped on every animation frame, update
-- and draw run at most 60 a second (144 with Max Frame Rate), and the redraw gate skips draw and
-- present only where the frame would repeat the last one: home and its Settings under reduced
-- motion, with nothing moving. Input, a mailbox change, a resize, a notice, a slider drag or a
-- page change draws again; the animated vortex keeps drawing at the cap.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local files=require('ui.host_constants').mailboxes
local noop=function() end
local function check(ok,message) if not ok then error(message,2) end end
local audio=setmetatable({isPlaying=function() return false end},{__index=function() return noop end})
love.audio={newSource=function() return audio end}
love.window={setMode=noop,setTitle=noop}
local mouseX,mouseY,held=-50,-50,false
love.mouse={getPosition=function() return mouseX,mouseY end,isDown=function() return held end,
  getSystemCursor=function() return {} end,setCursor=noop}
local clock,stepped=0,0
local pumps,presents,queue=0,0,{}
love.timer={getTime=function() return clock end,step=function() local dt=clock-stepped;stepped=clock;return dt end,sleep=noop}
love.event={pump=function() pumps=pumps+1 end,poll=function()
  return function()
    local e=table.remove(queue,1)
    if e then return unpack(e) end
  end
end}
love.handlers=setmetatable({},{__index=function(_,name) return function(...) if love[name] then love[name](...) end end end})
Stub.graphics.isActive=function() return true end
Stub.graphics.newShader=function() return Stub.shader() end
Stub.graphics.getBackgroundColor=function() return 0,0,0,1 end
Stub.graphics.present=function() presents=presents+1 end
package.loaded['ui.menu_logo']={new=function() return {update=noop,draw=noop,getDimensions=function() return 1850,800 end} end}
local T=require('ui.theme')
for _,name in ipairs({'library','builder','sandbox','simulator','online'}) do
  package.loaded['ui.'..name]={new=function(callbacks)
    local s={callbacks=callbacks,cards={},hover=0}
    for _,method in ipairs({'open','keypressed','mousepressed','mousereleased','wheelmoved','retarget','command',
      'close','cancelInteractions','closeModal','layout','draw','update'}) do s[method]=noop end
    function s:offset() return 0 end
    function s:backgroundColours() return {T.blue,T.panel,T.panel} end
    return s
  end}
end
local Settings=require('ui.settings')
local newSettings,popup=Settings.new,nil
Settings.new=function(...) popup=newSettings(...);return popup end
-- The host's mailboxes, behind a revision list as host.js writes them.
local revisions,serial={},0
local function write(name,text)
  Stub.files[files[name]]=text
  serial=serial+1;revisions[files[name]]=serial
  local rows={}
  for file,revision in pairs(revisions) do rows[#rows+1]=file..'\t'..revision end
  Stub.files[files.revisions]=table.concat(rows,'\n')
end
-- CRT 0, so a pointer position is a layout position.
local PREFERENCES='50 -1 0 0 50 100 100 0'
write('viewport','1280 800 0');write('page','1\thome\t');write('preferences',PREFERENCES)
_G.print=noop
dofile('frontend/lua/main.lua')
local draw=love.draw
local draws=0
-- What the last drawn frame showed: the page notice, and the sign-in form's email field.
local shown={}
local Button,Input=require('ui.button'),require('ui.text_input')
local errorLine,inputDraw=Button.errorLine,Input.draw
Button.errorLine=function(text,...) shown.notice=text;return errorLine(text,...) end
Input.draw=function(item,value,...) if item.field=='email' then shown.email=value end;return inputDraw(item,value,...) end
love.draw=function() draws=draws+1;shown={};draw() end
local loop=love.run()
local updates=0
local update=love.update
love.update=function(dt) updates=updates+1;update(dt) end

-- Runs `seconds` of animation frames at `hz`, with `events` queued on the first. Returns the draws,
-- updates and presents it made.
local function frames(seconds,hz,events)
  for _,e in ipairs(events or {}) do queue[#queue+1]=e end
  local d,u,p,n=draws,updates,presents,pumps
  for _=1,math.floor(seconds*hz+0.5) do clock=clock+1/hz;loop() end
  check(pumps-n==math.floor(seconds*hz+0.5),'Events are pumped on every animation frame')
  check(draws-d==presents-p,'Each draw is presented, and a skipped frame presents nothing')
  return draws-d,updates-u
end
-- Runs frames until the redraw gate's once-a-second backstop draws, so the next second has no
-- backstop of its own.
local function untilBackstop()
  local before=draws
  for _=1,300 do
    clock=clock+1/144;loop()
    if draws>before then return end
  end
  error('No backstop draw within two seconds')
end
local function near(value,expected,message) check(math.abs(value-expected)<=2,message..' ('..value..')') end

local drawn,updated=frames(2,144)
near(updated,120,'144 Hz runs update 60 a second')
near(drawn,120,'The animated menu draws every update at the cap')
drawn,updated=frames(1,60)
near(drawn,60,'A 60 Hz display draws every frame')
local Preferences=require('ui.preferences')

-- Max Frame Rate 144: open Settings' Graphics tab and choose 144 FPS by keyboard.
frames(0.1,144,{{'keypressed','tab'},{'keypressed','tab'},{'keypressed','tab'},{'keypressed','tab'},{'keypressed','tab'},{'keypressed','return'}})
check(popup,'Settings opened from the keyboard')
popup.tab=Settings.tabs.graphics;popup:build()
for i,item in ipairs(popup.items) do if item.key=='highFrameRate' then popup.focus=i end end
frames(0.1,144,{{'keypressed','right'}})
check(popup.preferences.highFrameRate==1,'Max Frame Rate is 144')
frames(0.1,144,{{'keypressed','escape'}})
check(not popup or popup.preferences.highFrameRate==1,'Closing Settings keeps it')
drawn,updated=frames(2,144)
near(updated,288,'With Max Frame Rate 144 a 144 Hz display updates every frame')
near(drawn,288,'and draws every frame')
drawn=frames(1,60)
near(drawn,60,'and a 60 Hz display still draws 60')
-- Back to 60 for the rest.
frames(0.1,144,{{'keypressed','tab'},{'keypressed','tab'},{'keypressed','tab'},{'keypressed','tab'},{'keypressed','tab'},{'keypressed','return'}})
popup.tab=Settings.tabs.graphics;popup:build()
for i,item in ipairs(popup.items) do if item.key=='highFrameRate' then popup.focus=i end end
frames(0.1,144,{{'keypressed','left'},{'keypressed','escape'}})
check(popup.preferences.highFrameRate==0,'Max Frame Rate is back to 60')

-- Reduced motion (the system preference, through the viewport mailbox): home stops drawing once
-- settled, but keeps updating and polling, and draws once a second as a backstop.
write('viewport','1280 800 1')
frames(1,144)
drawn,updated=frames(3,144)
near(updated,180,'Reduced-motion home keeps updating at 60')
check(drawn>=2 and drawn<=4,'Reduced-motion home draws only its once-a-second backstop ('..drawn..')')
-- Pointer movement (an event) draws for the next half second, then it stops again.
mouseX,mouseY=640,600
drawn=frames(0.25,144,{{'mousemoved',640,600,4,4,false}})
near(drawn,15,'Moving the pointer draws every update')
frames(0.5,144)
drawn=frames(2,144)
check(drawn<=3,'Then the static home stops drawing ('..drawn..')')
-- A mailbox change (a notice from the page) draws, and the notice keeps it drawing until it goes.
write('notice','1\tThis table could not load.')
drawn=frames(2,144)
near(drawn,120,'A notice draws while shown')
frames(5.7,144)
check(shown.notice=='This table could not load.','The notice is still up 7.7 s after it came')
-- It goes 8 s after it showed: the update that clears it is followed by a draw, not by the
-- backstop a second later.
frames(0.6,144)
check(shown.notice==nil,'The frame after the notice goes is drawn without it')
drawn=frames(2,144)
check(drawn<=3,'Once the notice is gone the home is static again ('..drawn..')')
-- Settings under reduced motion: static once open; dragging a slider draws without events.
frames(0.1,144,{{'keypressed','tab'},{'keypressed','tab'},{'keypressed','tab'},{'keypressed','tab'},{'keypressed','tab'},{'keypressed','return'}})
check(popup and popup.tab==Settings.tabs.game,'Settings is open')
frames(1,144)
drawn=frames(2,144)
check(drawn<=3,'Static Settings under reduced motion stops drawing ('..drawn..')')
local slider
for _,item in ipairs(popup.items) do if item.key=='screenshake' then slider=item end end
mouseX,mouseY=slider.x+20,slider.y+15
held=true
frames(0.05,144,{{'mousepressed',mouseX,mouseY,1,false,1}})
check(popup.drag,'The slider is held')
frames(0.6,144)
drawn=frames(1,144)
near(drawn,60,'A held slider keeps drawing with no events')
held=false
frames(0.05,144,{{'mousereleased',mouseX,mouseY,1,false,1}})
frames(0.6,144)
drawn=frames(2,144)
check(drawn<=3,'Released, Settings is static again ('..drawn..')')
-- Typing in the sign-in form arrives as a mailbox (the page's native field): it draws at once,
-- with no event in the canvas.
popup:openAuth('login')
frames(1,144)
untilBackstop()
check(shown.email=='','The sign-in form shows an empty email')
write('authInput','1\temail\tab@x\t\t\t4\t4\tinput\temail')
frames(0.1,144)
check(shown.email=='ab@x','A typed email shows within a frame or two, not at the next backstop')
popup:closeAuth()
frames(0.6,144)
-- A resize draws.
write('viewport','1000 700 1')
drawn=frames(0.5,144)
check(drawn>=10,'A resize draws ('..drawn..')')
frames(0.1,144,{{'keypressed','escape'}})
-- Other pages keep drawing under reduced motion.
write('page','2\tdecks\t')
frames(1,144)
drawn=frames(2,144)
near(drawn,120,'The decks page under reduced motion draws every update')
write('page','3\thome\t')
frames(1,144)
drawn=frames(2,144)
check(drawn<=3,'Back home it stops ('..drawn..')')
-- Motion on again: the vortex animates, so every update draws.
write('viewport','1000 700 0')
frames(0.5,144)
drawn=frames(2,144)
near(drawn,120,'Motion on draws every update')

-- Settings:still, the popup's own report.
local p=Preferences.new()
local s=Settings.new(p,{changed=noop,close=noop,announce=noop,feedback=noop,reduced=function() return true end},true,false)
s:layout(1280,800);s:update(1/60,20,-1000,-1000,true)
check(s:still(),'A settled Settings is still')
s.drag=5;check(not s:still(),'A slider drag is not still');s.drag=nil
s.armed=20;check(not s:still(),'An armed delete button (it disarms after 3 s) is not still');s.armed=nil
s.account.savedRemaining=2;check(not s:still(),'A "Saved." waiting to clear is not still');s.account.savedRemaining=nil
local moving=Settings.new(p,{changed=noop,close=noop,announce=noop,feedback=noop,reduced=function() return false end},false,false)
moving:layout(1280,800);moving:update(1/60,20,-1000,-1000,false)
check(not moving:still(),'Settings sliding in is not still')
print('PASS: love.run paces at 60/144, pumps events every frame, and skips only repeated reduced-motion home and Settings frames')
