-- The real main.lua and the real online lobby under Settings' Interface Size. The lobby is its
-- own layer: it lays out in the canvas divided by the factor its step reaches (Online:minimum)
-- and draws that much larger about the canvas centre, so a control is drawn where the pointer
-- finds it (press, release, hover and the wheel), and the code and search fields' text proxy box
-- lands over the field. A step change moves it to its own factor at once. 100% and portrait draw
-- and answer unscaled.
package.path='frontend/lua/?.lua;'..package.path
local noop=function() end
local function check(ok,message) if not ok then error(message,2) end end
local files={['__viewport.txt']='1280 800 1 1280 800',['__page.txt']='1\thome\t',
  ['__preferences.txt']='50 1 0 0 50 100 100 0 0 2'} -- no CRT lens, Interface Size 150%
local image={release=noop,setFilter=noop,getDimensions=function() return 836,322 end,getWidth=function() return 245 end,getHeight=function() return 337 end}
package.loaded['ui.menu_logo']={new=function() return {update=noop,draw=noop,getDimensions=function() return 836,322 end} end}
local audio=setmetatable({isPlaying=function() return false end},{__index=function() return noop end})
local mouseX,mouseY=-50,-50
local m,stack={sx=1,sy=1,tx=0,ty=0},{}
local function translate(x,y) m.tx,m.ty=m.tx+m.sx*x,m.ty+m.sy*y end
local function scale(x,y) m.sx,m.sy=m.sx*x,m.sy*(y or x) end
local font={setFilter=noop,getWidth=function(_,t) return #tostring(t)*8 end,getHeight=function() return 20 end,
  getWrap=function(_,s) return #s*8,{s} end}
love={graphics=setmetatable({getDimensions=function() return 1280,800 end,
  newCanvas=function() return image end,newImage=function() return image end,newQuad=function() return {} end,
  newShader=function() return {release=noop,send=noop,hasUniform=function() return true end} end,
  getSystemLimits=function() return {texturesize=16384} end,newFont=function() return font end,
  translate=translate,scale=scale,origin=function() m={sx=1,sy=1,tx=0,ty=0} end,
  push=function() stack[#stack+1]={sx=m.sx,sy=m.sy,tx=m.tx,ty=m.ty} end,pop=function() m=table.remove(stack) end,
  transformPoint=function(x,y) return m.tx+m.sx*x,m.ty+m.sy*y end},{__index=function() return noop end}),
  math={random=function() return 0.5 end},window={setTitle=noop,setMode=noop},
  audio={newSource=function() return audio end},
  mouse={getSystemCursor=noop,setCursor=noop,getPosition=function() return mouseX,mouseY end,isDown=function() return false end},
  keyboard={isDown=function() return false end},timer={getTime=function() return os.clock()*1000 end},
  filesystem={getInfo=function(name) return files[name] or name:match('sounds/') end,read=function(name) return files[name] end}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=noop} end
local T=require('ui.theme');T.text=noop
local Button=require('ui.button')
local Input=require('ui.text_input')
-- Where each lobby control is drawn on the screen, by label (fields by name).
local drawn={}
local function note(key,b) drawn[key]={x=m.tx+m.sx*b.x,y=m.ty+m.sy*b.y,w=m.sx*b.w,h=m.sy*b.h} end
Button.draw=function(b) note(b.label,b) end
Input.background=function(b) note(b.field,b) end
for _,name in ipairs({'library','builder','sandbox','simulator'}) do
  package.loaded['ui.'..name]={new=function(callbacks)
    local s={callbacks=callbacks,cards={},hover=0}
    for _,method in ipairs({'open','keypressed','wheelmoved','retarget','command','close','cancelInteractions','closeModal',
      'draw','drawModal','layout','update','mousepressed','mousereleased'}) do s[method]=noop end
    function s:offset() return 0 end
    function s:editBox() end
    function s:backgroundColours() return {T.blue,T.panel,T.panel} end
    return s
  end}
end
local Online=require('ui.online')
local lobby
do local new=Online.new;Online.new=function(...) lobby=new(...);return lobby end end
local printed={}
local output=print
print=function(line) if tostring(line):find('^COLORLESS:') then printed[#printed+1]=line end end
dofile('frontend/lua/main.lua');love.load()
local function frame() love.update(1/60);drawn={};love.graphics.origin();love.draw() end
local function frames(n) for _=1,n do frame() end end
local function sent(channel)
  local out={}
  for _,line in ipairs(printed) do
    local c,rest=line:match('^COLORLESS:([%a%-]+):?(.*)$')
    if c==channel then out[#out+1]=rest end
  end
  printed={}
  return table.concat(out,'|')
end
local Codec=require('ui.codec')
local W=require('ui.wire_fields').online
local function row(tag,spec,fields)
  local out={}
  for _,column in pairs(spec) do out[column]='' end
  if tag then out[1]=tag end
  for name,value in pairs(fields) do out[assert(spec[name],name)]=Codec.encode(value) end
  return table.concat(out,'\t')
end
local revision=0
local function snapshot(step,opts,rows)
  opts=opts or {};revision=revision+1
  local lines={row(nil,W.header,{revision=revision,step=step,busy=0,message='',code=opts.code or 'ABCD',role='host',
    link='connected',countdown='',notice='',deckPhase=opts.decks or 'idle',name='Ash',account='authenticated',canKick=0,status=''})}
  for _,r in ipairs(rows or {}) do lines[#lines+1]=row(r[1],r[1]=='P' and W.seat or W.deck,r[2]) end
  files['__online.txt']=table.concat(lines,'\n');frames(3)
end
local function seats(deck)
  return {{'P',{seat='you',present=1,name='Ash',connected=1,ready=0,deckId=deck and 'deck2' or '',deckName=deck and 'Deck 2' or '',hasDeck=deck and 1 or 0}},
    {'P',{seat='opponent',present=1,name='Misty',connected=1,ready=0,deckId='',deckName='',hasDeck=0}}}
end
local function decks()
  local rows=seats(true)
  for i=1,12 do rows[#rows+1]={'D',{id='deck'..i,name='Deck '..i,count=60,standard=1,expanded=1,online=1,formatName='Standard'}} end
  return rows
end
local function index(key) for i,item in ipairs(lobby.items) do if (item.field or item.label)==key then return i,item end end end
local function centre(key) local d=assert(drawn[key],key..' is not drawn');return d.x+d.w/2,d.y+d.h/2 end
local function move(x,y) mouseX,mouseY=x,y;love.mousemoved(x,y,1,1);frame() end
local function click(x,y) move(x,y);love.mousepressed(x,y,1);love.mousereleased(x,y,1);frame() end
-- The control is drawn `f` times its laid-out size about the canvas centre, lights under the
-- pointer just inside its drawn corners and not just outside them.
local function grown(key,f,message,vw,vh)
  vw,vh=vw or 1280,vh or 800
  local i,item=index(key)
  local d=drawn[key]
  check(i and d,message..': '..key..' is drawn')
  local cw,ch=vw/f,vh/f
  local x,y=vw/2+(item.x-cw/2)*f,vh/2+(item.y-ch/2)*f
  check(math.abs(d.x-x)<1e-6 and math.abs(d.y-y)<1e-6 and math.abs(d.w-item.w*f)<1e-6 and math.abs(d.h-item.h*f)<1e-6,
    message..': '..key..(' drawn at %.2f,%.2f %.2fx%.2f, wanted %.2f,%.2f'):format(d.x,d.y,d.w,d.h,x,y))
  move(d.x+1,d.y+1);check(lobby.hover==i,message..': '..key..' lights at its drawn top-left')
  move(d.x+d.w-1,d.y+d.h-1);check(lobby.hover==i,message..': '..key..' lights at its drawn bottom-right')
  move(d.x-1,d.y+d.h/2);check(lobby.hover~=i,message..': '..key..' is dark left of it')
  move(d.x+d.w/2,d.y+d.h+1);check(lobby.hover~=i,message..': '..key..' is dark below it')
end
-- The field's proxy box (whole CSS pixels at a device pixel ratio of 1) is the drawn field.
local function proxyOver(key,command,message)
  local d=drawn[key]
  local f={}
  for v in (command..'\t'):gmatch('([^\t]*)\t') do f[#f+1]=v end
  local l,t,w,h=tonumber(f[#f-3]),tonumber(f[#f-2]),tonumber(f[#f-1]),tonumber(f[#f])
  local function near(a,b) return a and math.abs(a-b)<=1 end
  check(near(l,d.x) and near(t,d.y) and near(w,d.w) and near(h,d.h),
    message..': proxy at '..command..(', field drawn at %.1f %.1f %.1f %.1f'):format(d.x,d.y,d.w,d.h))
end

frames(20)
files['__page.txt']='2\tonline\t';frames(10)
snapshot('menu',{code=''})
-- 150%: the menu lays out in 853x533 and draws 1.5 times larger.
check(math.abs(lobby.width-1280/1.5)<1e-9 and math.abs(lobby.height-800/1.5)<1e-9,
  'The 150% menu lays out in 853x533, got '..lobby.width..'x'..lobby.height)
grown('Create lobby',1.5,'150% create')
grown('Join',1.5,'150% join tab')
local jx,jy=centre('Join')
-- Where Join was at 100% is not Join now.
click(646+75,164+24);check(lobby.tab==1,'A click where Join was at 100% does not switch tabs')
click(jx,jy);check(lobby.tab==2,'A click on the drawn Join switches tabs')
printed={}
grown('code',1.5,'150% code field')
grown('Back',1.5,'150% back')
local cx,cy=centre('code')
click(cx,cy)
local command=sent('online')
check(command:find('^input\tcode\t'),'A click on the drawn code field opens it, sent '..command)
proxyOver('code',command,'150% code proxy')
-- Typing the code and a step change: waiting stays at 150%, versus moves to 125% at once.
files['__online_input.txt']='1\tcode\tABCD\t4\t4\tdone';frames(2)
snapshot('waiting',{},{seats()[1]})
check(math.abs(lobby.width-1280/1.5)<1e-9,'Waiting stays at 150%')
grown('Copy code',1.5,'150% waiting')
snapshot('versus',{},seats(true))
check(lobby.width==1024 and lobby.height==640,'Versus moves to 125% at once, got '..lobby.width..'x'..lobby.height)
grown('Change deck',1.25,'125% versus')
grown('Ready',1.25,'125% versus')
check(lobby.piles.you and lobby.piles.you.homeX==lobby.panels.you.x+lobby.panels.you.w/2,'Your deck preview is in your seat in the 125% canvas')
-- The picker: open it by its drawn button, turn its page with the wheel over it, search.
click(centre('Change deck'));check(lobby.picker,'A click on the drawn Change deck opens the picker')
snapshot('versus',{decks='ready'},decks())
check(lobby.width==1024 and #lobby.cards==10,'The picker keeps the 125% canvas')
grown('>',1.25,'125% pager')
move(centre('Back'))
love.wheelmoved(0,-1);frame();check(lobby.page==2,'The wheel turns the picker page')
click(centre('<'));check(lobby.page==1,'A click on the drawn previous arrow turns back')
printed={}
click(centre('search'))
command=sent('online')
check(command:find('^input\tsearch\t'),'A click on the drawn search field opens it, sent '..command)
proxyOver('search',command,'125% search proxy')
-- A box that moves with the layer: back to the menu at 150% while the search is open is no box
-- (the edit ends); the code field opened there prints its 150% box.
files['__online_input.txt']='2\tsearch\t\t0\t0\tdone';frames(2)
local pile=lobby.items[index('Deck 1')]
check(pile and pile.kind=='card','The first pile is a control')
local px,py=640+(pile.x+pile.w/2-512)*1.25,400+(pile.y+pile.h/2-320)*1.25
printed={};click(px,py)
check(sent('online'):find('select\tdeck1'),'A click on the drawn pile chooses it')

-- 125% chosen: every step at 125%.
files['__settings.txt']='1\tgame';frame()
for _=1,6 do love.keypressed('tab');frame() end
love.keypressed('left');frame()
love.keypressed('escape');frame()
-- Back on the menu the lobby makes a fresh lobby; its answer clears the wait.
snapshot('menu',{code=''});snapshot('menu',{code=''})
check(lobby.width==1024 and lobby.height==640,'At 125% the menu lays out in 1024x640, got '..lobby.width..'x'..lobby.height)
grown('Create lobby',1.25,'125% create')

-- 100%: the lobby lays out in the canvas and draws where it always did.
files['__settings.txt']='2\tgame';frame()
for _=1,6 do love.keypressed('tab');frame() end
love.keypressed('left');frame()
love.keypressed('escape');frame()
-- Back on the menu the lobby makes a fresh lobby; its answer clears the wait.
snapshot('menu',{code=''});snapshot('menu',{code=''})
check(lobby.width==1280 and lobby.height==800,'At 100% the lobby lays out in 1280x800')
grown('Create lobby',1,'100% create')
check(drawn['Create lobby'].x==430 and drawn['Create lobby'].y==344,'100% Create lobby where it always was')

-- Portrait at 150%: the lobby fills its canvas and stays at 100%.
files['__settings.txt']='3\tgame';frame()
for _=1,6 do love.keypressed('tab');frame() end
love.keypressed('right');love.keypressed('right');frame()
love.keypressed('escape');frame()
files['__viewport.txt']='480 850 1 480 850';frames(20)
snapshot('menu',{code=''})
check(lobby.width==480 and lobby.height==850,'Portrait keeps the lobby at 100%, got '..lobby.width..'x'..lobby.height)
grown('Create lobby',1,'portrait create',480,850)
print=output
print('PASS: the online lobby grows with Interface Size per step, and draws, answers the pointer and places its text proxies where it is drawn')
