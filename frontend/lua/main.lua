local T = require('ui.theme')
local Card = require('ui.card')
local g = love.graphics
local state = {time=0,focused=0,hovered=0,muted=false,reduced=false,poll=0,ready=false}
local cards, shaders, sounds, controls = {}, {}, {}, {}
local scene, width, height, layoutScale, offsetX, offsetY, virtualWidth, virtualHeight
local menu = {
  {label='Play', route='/play', colour=T.red, edition='dissolve', description='Start a local match'},
  {label='Sandbox', route='/simulator', colour=T.blue, edition='foil', description='Experiment with your decks'},
  {label='Online', route='/lobby', colour=T.green, edition='holo', description='Challenge another player'},
  {label='Decks', route='/decks', colour=T.gold, edition='polychrome', description='Build your next winning hand'},
}
local function sound(name,pitch)
  if state.muted then return end
  local s=sounds[name]
  s:stop(); s:setPitch(pitch or 1); s:setVolume(0.35); s:play()
end
local function announce(text) print('LUMINOUS:announce:'..text) end
local function layout(w,h)
  width,height=w,h
  state.drag=nil; state.pressed=nil
  local portrait=w/h<0.9
  virtualWidth,virtualHeight=portrait and 480 or 1280,portrait and 850 or 800
  layoutScale=math.min(w/virtualWidth,h/virtualHeight)
  offsetX,offsetY=(w-virtualWidth*layoutScale)/2,(h-virtualHeight*layoutScale)/2
  for i,c in ipairs(cards) do
    c.dragging=false
    c:rebuild() -- love.js recreates the WebGL backbuffer on a viewport change.
    local x=portrait and (i%2==1 and 145 or 335) or 640+(i-2.5)*220
    local y=portrait and (i<=2 and 320 or 570) or 437
    c:place(x,y,portrait and 1.12 or 1.36,not state.ready)
  end
  controls={
    {label='Account',route='/settings',x=virtualWidth/2-220,y=virtualHeight-109,w=140,h=47,colour=T.panel},
    {label='Settings',route='/settings',x=virtualWidth/2-70,y=virtualHeight-109,w=140,h=47,colour=T.panel},
    {label=state.muted and 'Sound: off' or 'Sound: on',action='sound',x=virtualWidth/2+80,y=virtualHeight-109,w=140,h=47,colour=T.panel},
  }
  if scene then scene:release() end
  scene=g.newCanvas(w,h)
end
local function pointer(x,y)
  return (x-offsetX)/layoutScale,(y-offsetY)/layoutScale
end
local function hit(x,y)
  for i=#cards,1,-1 do if cards[i]:hit(x,y) then return i end end
  for i,b in ipairs(controls) do
    if x>=b.x and x<=b.x+b.w and y>=b.y and y<=b.y+b.h then return #cards+i end
  end
  return 0
end
local function browserState()
  -- A tiny host-to-Lua mailbox. All rendering and interaction remain in Lua.
  if not love.filesystem.getInfo('__viewport.txt') then return end
  local raw=love.filesystem.read('__viewport.txt')
  local w,h,reduced,muted=raw:match('^(%d+) (%d+) (%d) (%d)')
  w,h=tonumber(w),tonumber(h)
  if w and h and (width~=w or height~=h) then love.window.setMode(w,h,{resizable=true,vsync=1}); layout(w,h) end
  state.reduced=reduced=='1'
  if not state.ready then state.muted=muted=='1' end
end
local function activate(index)
  if index==0 or state.leaving then return end
  sound('button',0.98)
  if index<=#cards then cards[index]:juiceUp(state.time,nil,nil,state.reduced) end
  local item=index<=#cards and menu[index] or controls[index-#cards]
  if item.action=='sound' then
    state.muted=not state.muted
    controls[3].label=state.muted and 'Sound: off' or 'Sound: on'
    if state.muted then sounds.music1:pause() else sounds.music1:play() end
    print('LUMINOUS:mute:'..(state.muted and '1' or '0'))
    announce(controls[3].label)
  else
    state.leaving={route=item.route,at=state.time}
    announce('Opening '..item.label)
  end
end
function love.load()
  g.setDefaultFilter('nearest','nearest')
  state.handCursor=love.mouse.getSystemCursor('hand')
  state.arrowCursor=love.mouse.getSystemCursor('arrow')
  for _,name in ipairs({'splash','CRT','dissolve','foil','holo','polychrome'}) do shaders[name]=g.newShader('assets/shaders/'..name..'.fs') end
  for _,name in ipairs({'button','card1','cardSlide1','highlight1','paper1','music1'}) do sounds[name]=love.audio.newSource('assets/sounds/'..name..'.ogg',name=='music1' and 'stream' or 'static') end
  sounds.music1:setLooping(true); sounds.music1:setVolume(0.16)
  for i,item in ipairs(menu) do cards[i]=Card.new(item,i) end
  layout(g.getDimensions())
  browserState()
  controls[3].label=state.muted and 'Sound: off' or 'Sound: on'
  state.ready=true
  print('LUMINOUS:ready')
end
function love.resize(w,h) if #cards>0 then layout(w,h) end end
function love.update(dt)
  state.smoothedDt=math.min(0.8*(state.smoothedDt or 1/100)+0.2*dt,0.1)
  dt=state.smoothedDt
  state.time=state.time+dt
  state.poll=state.poll+dt
  if state.poll>0.25 then browserState(); state.poll=0 end
  local mx,my=pointer(love.mouse.getPosition())
  -- Desktop dragging suppresses hover, as Controller:set_cursor_hover does.
  local hovered=(state.drag and not state.drag.touch) and 0 or hit(mx,my)
  if hovered~=state.hovered then
    if hovered>0 and not state.drag then
      if hovered<=#cards then
        sound('paper1',love.math.random()*0.2+0.9)
        cards[hovered]:juiceUp(state.time,0.05,0.03,state.reduced)
      else sound('highlight1',0.95+hovered*0.03) end
    end
    state.hovered=hovered
    love.mouse.setCursor(hovered>0 and state.handCursor or state.arrowCursor)
  end
  if state.drag then
    local c=cards[state.drag.index]
    c.targetX,c.targetY=mx-state.drag.dx,my-state.drag.dy
    if math.abs(mx-state.drag.startX)+math.abs(my-state.drag.startY)>8 then state.drag.moved=true end
  end
  for i,c in ipairs(cards) do c:update(dt,state.time,i==state.hovered or i==state.focused,state.reduced) end
  if state.leaving and state.time-state.leaving.at>0.17 then
    print('LUMINOUS:navigate:'..state.leaving.route)
    state.leaving=nil
  end
end
local function button(b,index)
  local active=state.hovered==index or state.focused==index
  local y=b.y+(state.pressed==index and 3 or active and -2 or 0)
  T.box(b.x,b.y+6,b.w,b.h,T.ink)
  T.box(b.x,y,b.w,b.h,active and T.blue or b.colour)
  T.text(b.label,27,b.x,y+5,b.w)
  if state.focused==index then g.setColor(T.gold); g.setLineWidth(2); g.rectangle('line',b.x-4,y-4,b.w+8,b.h+8,5) end
end
function love.draw()
  if not scene then return end
  local t=state.reduced and 12 or state.time+12
  g.setCanvas(scene); g.clear(T.ink)
  local bg=shaders.splash
  bg:send('time',t); bg:send('vort_speed',0.4); bg:send('colour_1',T.red); bg:send('colour_2',T.blue); bg:send('mid_flash',0); bg:send('vort_offset',0)
  g.setShader(bg); g.setColor(1,1,1); g.rectangle('fill',0,0,width,height); g.setShader()
  g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale)
  local portrait=virtualWidth<600
  local titleY=portrait and 55 or 110
  local titleSize=portrait and 78 or 136
  g.push(); g.translate(virtualWidth/2,titleY+titleSize/2)
  if not state.reduced then g.rotate(math.sin(state.time*0.6)*0.012) end
  T.text('LUMINOUS',titleSize,-virtualWidth/2,-titleSize/2+5,virtualWidth,T.ink)
  T.text('LUMINOUS',titleSize,-virtualWidth/2,-titleSize/2,virtualWidth,T.white)
  g.pop()
  T.text('Pick your next move',portrait and 23 or 28,0,portrait and 146 or 255,virtualWidth,T.paper)
  local mx,my=pointer(love.mouse.getPosition())
  local active=state.drag and state.drag.index or state.hovered<=#cards and state.hovered or 0
  for i,c in ipairs(cards) do if i~=active then c:draw(shaders,state.reduced and 0 or state.time,mx,my,state.reduced,virtualWidth) end end
  if active>0 then cards[active]:draw(shaders,state.reduced and 0 or state.time,mx,my,state.reduced,virtualWidth) end
  if state.focused>0 and state.focused<=#cards then
    local c=cards[state.focused]
    T.box(c.homeX-40,c.homeY+145,80,4,T.gold,1)
  end
  local selected=state.drag and state.drag.index or (state.hovered>0 and state.hovered or state.focused)
  local description=selected>0 and selected<=#menu and menu[selected].description or 'A good hand starts here.'
  if not portrait then T.text(description,25,0,608,virtualWidth,T.paper) end
  T.box(virtualWidth/2-233,virtualHeight-123,466,78,{0.12,0.17,0.18,0.85},9)
  for i,b in ipairs(controls) do button(b,#cards+i) end
  T.text('Luminous',19,24,virtualHeight-33,160,T.paper,'left')
  T.text('Home',19,virtualWidth-130,virtualHeight-33,106,T.paper,'right')
  g.pop(); g.setCanvas()
  local crt=shaders.CRT
  local values={time=t,distortion_fac={1,1},scale_fac={1,1},feather_fac=0.025,noise_fac=state.reduced and 0 or 0.001,bloom_fac=0.4,crt_intensity=0.025,glitch_intensity=0,scanlines=height*1.5,hovering=0,mouse_screen_pos={0,0},screen_scale=1}
  for key,value in pairs(values) do if crt:hasUniform(key) then crt:send(key,value) end end
  g.setShader(crt); g.setColor(1,1,1); g.draw(scene); g.setShader()
end
local function unlockAudio()
  state.audioUnlocked=true
  if not state.muted and not sounds.music1:isPlaying() then sounds.music1:play() end
end
function love.mousepressed(x,y,button,istouch)
  if button~=1 then return end
  unlockAudio(); state.focused=0
  x,y=pointer(x,y)
  local index=hit(x,y); state.pressed=index
  if index>0 and index<=#cards then
    local c=cards[index]
    state.drag={index=index,dx=x-c.x,dy=y-c.y,startX=x,startY=y,moved=false,touch=istouch}
    c.dragging=true; c.targetX,c.targetY=c.x,c.y; sound('card1',1.05)
  end
end
function love.mousereleased(x,y,button)
  if button~=1 then return end
  x,y=pointer(x,y)
  if state.drag then
    local drag=state.drag
    cards[drag.index].dragging=false
    state.drag=nil
    if drag.moved then sound('cardSlide1') else activate(drag.index) end
  elseif state.pressed and state.pressed==hit(x,y) then activate(state.pressed) end
  state.pressed=nil
end
function love.keypressed(key)
  unlockAudio()
  if key=='tab' or key=='right' or key=='down' or key=='left' or key=='up' then
    local backward=key=='left' or key=='up' or (key=='tab' and love.keyboard.isDown('lshift','rshift'))
    state.focused=((state.focused-1+(backward and -1 or 1))%7)+1
    local item=state.focused<=4 and menu[state.focused] or controls[state.focused-4]
    announce(item.label); sound('highlight1')
  elseif key=='return' or key=='space' then activate(state.focused)
  elseif key=='m' then activate(7)
  elseif key=='escape' then
    if state.drag then cards[state.drag.index].dragging=false; state.drag=nil end
    state.focused=0; state.pressed=nil
  end
end
function love.focus(focused)
  if not focused then
    sounds.music1:pause()
    if state.drag then cards[state.drag.index].dragging=false; state.drag=nil end
    state.pressed=nil
  elseif state.audioUnlocked and not state.muted then
    sounds.music1:play()
  end
end
