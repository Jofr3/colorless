local T = require('ui.theme')
local Button = require('ui.button')
local Room = require('ui.room')
local Screen = require('ui.screen')
local Preferences = require('ui.preferences')
local Settings = require('ui.settings')
local Account = require('ui.account')
local Library = require('ui.library')
local Builder = require('ui.builder')
local Modal = require('ui.modal')
local g = love.graphics
-- Game:main_menu starts REAL at 12 when skipping the introductory splash.
local state = {time=12,focused=0,hovered=0,muted=false,reduced=false,poll=0,ready=false}
local shaders, sounds, controls = {}, {}, {}
local menuTray,room,screen,popup,library,builder
local function collection() return state.page=='builder' and builder or library end
local preferences=Preferences.new()
local account=Account.new()
local openSettings,closeSettings,applyPreferences
local scene, width, height, layoutScale, offsetX, offsetY, virtualWidth, virtualHeight
local menu = {
  {label='Sandbox', route='/simulator', colour=T.blue, description='Experiment with your decks'},
  {label='Online', route='/lobby', colour=T.red, description='Challenge another player'},
  {label='Decks', route='/decks', colour=T.paleGreen, description='Build your next winning hand'},
}
local function sound(name,pitch)
  if state.muted then return end
  local s=sounds[name]
  s:stop(); s:setPitch(pitch or 1); s:setVolume((name=='paper1' and 0.35 or 0.6)*preferences.volume/100*preferences.effectsVolume/100); s:play()
end
local function announce(text) print('LUMINOUS:announce:'..text) end
local function layout(w,h)
  width,height=w,h
  state.pressed=nil
  local portrait=w/h<0.9
  virtualWidth,virtualHeight=portrait and 480 or 1280,portrait and 850 or 800
  layoutScale=math.min(w/virtualWidth,h/virtualHeight)
  offsetX,offsetY=(w-virtualWidth*layoutScale)/2,(h-virtualHeight*layoutScale)/2
  room=Room.new(virtualWidth,virtualHeight)
  local buttonWidth,buttonHeight=portrait and 368 or 219,portrait and 68 or 93
  local gap,padding=portrait and 16 or 12,portrait and 14 or 12
  local menuWidth=portrait and buttonWidth or #menu*buttonWidth+(#menu-1)*gap
  local menuHeight=portrait and #menu*buttonHeight+(#menu-1)*gap or buttonHeight
  local menuX=(virtualWidth-menuWidth)/2
  local menuY=portrait and 442-menuHeight/2 or 426
  for i,b in ipairs(menu) do
    b.w,b.h=buttonWidth,buttonHeight
    b.x=menuX+(portrait and 0 or (i-1)*(buttonWidth+gap))
    b.y=menuY+(portrait and (i-1)*(buttonHeight+gap) or 0)
    b.fontSize=portrait and 36 or 38
    b.uppercase=true
  end
  menuTray={x=menuX-padding,y=menuY-padding,w=menuWidth+2*padding,h=menuHeight+2*padding}
  controls={
    {label='Account',action='account',x=virtualWidth/2-144,y=virtualHeight-104,w=120,h=48,fontSize=24,colour=T.profile},
    {label='Settings',action='settings',x=virtualWidth/2+24,y=virtualHeight-104,w=120,h=48,fontSize=24,colour=T.profile},
  }
  if scene then scene:release() end
  scene=g.newCanvas(w,h)
  scene:setFilter('linear','linear') -- love.resize uses linear canvas filtering.
  screen=Screen.new(shaders.CRT,w,h,Screen.unit(w,h))
  if popup then popup:layout(virtualWidth,virtualHeight) end
  if library then library:layout(virtualWidth,virtualHeight) end
  if builder then builder:layout(virtualWidth,virtualHeight) end
  love.window.setTitle('Luminous - '..(state.page=='builder' and 'Deck builder' or state.page=='decks' and 'Decks' or 'Home'))
end
local function pointer(x,y)
  x,y=screen:unproject(x,y)
  return room:unproject((x-offsetX)/layoutScale,(y-offsetY)/layoutScale)
end
-- Leave a visible border of the dimmed home behind the collection on desktop.
local function libraryPoint(x,y)
  local scale=virtualWidth<600 and 1 or 0.9
  return (x-virtualWidth/2)/scale+virtualWidth/2,(y-virtualHeight/2)/scale+virtualHeight/2
end
local function libraryTransform()
  local scale=virtualWidth<600 and 1 or 0.9
  g.translate(virtualWidth/2,virtualHeight/2); g.scale(scale)
  g.translate(-virtualWidth/2,-virtualHeight/2+collection():offset())
end
local function hit(x,y)
  for i,b in ipairs(menu) do if Button.hit(b,x,y) then return i end end
  for i,b in ipairs(controls) do if Button.hit(b,x,y) then return #menu+i end end
  return 0
end
local function browserState()
  -- A tiny host-to-Lua mailbox. All rendering and interaction remain in Lua.
  if not love.filesystem.getInfo('__viewport.txt') then return end
  local raw=love.filesystem.read('__viewport.txt')
  local w,h,reduced,_,request,tab=raw:match('^(%d+) (%d+) (%d) (%d)%s*(%d*)%s*(%d*)')
  w,h=tonumber(w),tonumber(h)
  if w and h and (width~=w or height~=h) then love.window.setMode(w,h,{resizable=true,vsync=1}); layout(w,h) end
  state.systemReduced=reduced=='1'
  if not state.preferencesLoaded and love.filesystem.getInfo('__preferences.txt') then
    preferences=Preferences.new(love.filesystem.read('__preferences.txt'))
    state.preferencesLoaded=true
  end
  applyPreferences()
  if love.filesystem.getInfo('__page.txt') then
    local pageRaw=love.filesystem.read('__page.txt')
    if pageRaw~=state.pageRaw then
      state.pageRaw=pageRaw
      local fields=Account.fields(pageRaw)
      local page=fields[2]
      if page~=state.page or (page=='builder' and fields[3]~=state.deckId) then
        if state.page=='builder' then builder:command('close') end
        state.deckId=fields[3]
        if popup then closeSettings() end
        state.page=page; state.leaving=nil; state.pressed=nil; state.focused=0
        love.window.setTitle('Luminous - '..(page=='builder' and 'Deck builder' or page=='decks' and 'Decks' or 'Home'))
        if page=='builder' then
          library:command('close'); builder:open(state.reduced,fields[3]); print('LUMINOUS:account:refresh')
        elseif page=='decks' then
          library:open(state.reduced); print('LUMINOUS:account:refresh')
        else library:closeModal(); library:command('close') end
      end
    end
  end
  request=tonumber(request) or 0
  if request>(state.settingsRequest or 0) then state.settingsRequest=request; openSettings(true,tonumber(tab)) end
end
applyPreferences=function()
  state.reduced=preferences:reduced(state.systemReduced)
  state.muted=preferences.muted==1
  if sounds.music1 then
    sounds.music1:setVolume(0.32*preferences.volume/100*preferences.musicVolume/100)
    if not state.muted and state.audioUnlocked and state.windowFocused~=false then
      if not sounds.music1:isPlaying() then sounds.music1:play() end
    else sounds.music1:pause() end
  end
end
local function savePreferences()
  applyPreferences()
  print('LUMINOUS:preferences:'..preferences:serialize())
end
closeSettings=function()
  print('LUMINOUS:auth:close')
  print('LUMINOUS:account:finish-edit')
  popup=nil; state.pressed=nil; state.focused=#menu+2; state.hovered=0
  savePreferences()
  print('LUMINOUS:settings:closed')
  announce('Settings closed')
end
openSettings=function(keyboard,tab)
  if popup then return end
  keyboard=keyboard or state.focused>0
  state.pressed=nil; state.focused=0; state.hovered=0
  room.jiggle=room.jiggle+1
  popup=Settings.new(preferences,{
    changed=savePreferences,close=closeSettings,announce=announce,
    reduced=function() return state.reduced end,
    feedback=function() sound('button'); room.jiggle=room.jiggle+0.5 end,
    account=function(command) print('LUMINOUS:account:'..command) end,
    auth=function(command) print('LUMINOUS:auth:'..command) end,
  },state.reduced,keyboard,account)
  popup.tab=tab or 1
  if keyboard then popup.focus=popup.tab end
  popup:layout(virtualWidth,virtualHeight)
  print('LUMINOUS:account:refresh')
  print('LUMINOUS:settings:open')
  announce('Settings. '..(popup.tab==4 and 'Account' or 'Game')..' tab. Tab moves between controls. Escape closes.')
end
local function activate(index)
  if index==0 or state.leaving then return end
  sound('button',1)
  room.jiggle=room.jiggle+0.5
  state.lastClicked={index=index,at=state.time}
  local item=index<=#menu and menu[index] or controls[index-#menu]
  if item.route=='/decks' then print('LUMINOUS:page:decks'); return end
  if item.action=='settings' then openSettings(); return end
  if item.action=='account' then openSettings(false,4); return end
  state.leaving={route=item.route,at=state.time,index=index}
  announce('Opening '..item.label)
end
function love.load()
  g.setDefaultFilter('nearest','nearest')
  state.handCursor=love.mouse.getSystemCursor('hand')
  state.arrowCursor=love.mouse.getSystemCursor('arrow')
  for _,name in ipairs({'splash','CRT','dissolve'}) do shaders[name]=g.newShader('assets/shaders/'..name..'.fs') end
  for _,name in ipairs({'button','music1','cardSlide1','highlight1','paper1'}) do sounds[name]=love.audio.newSource('assets/sounds/'..name..'.ogg',name=='music1' and 'stream' or 'static') end
  sounds.music1:setLooping(true); sounds.music1:setVolume(0.16)
  library=Library.new({
    command=function(command) print('LUMINOUS:library:'..command) end,
    feedback=function(name,pitch) sound(name,pitch) end,
    announce=announce,
    refresh=function() print('LUMINOUS:account:refresh') end,
    home=function() print('LUMINOUS:page:home') end,
    settings=function() openSettings() end,
    signin=function() openSettings(false,4); popup:openAuth('login') end,
  })
  builder=Builder.new({
    command=function(command) print('LUMINOUS:builder:'..command) end,
    feedback=function(name,pitch) sound(name,pitch) end,
    announce=announce,
    signin=function() openSettings(false,4); popup:openAuth('login') end,
  })
  layout(g.getDimensions())
  browserState()
  state.ready=true
  print('LUMINOUS:ready')
end
function love.resize(w,h) if scene then layout(w,h) end end
function love.update(dt)
  account:update(dt)
  state.smoothedDt=math.min(0.8*(state.smoothedDt or 1/100)+0.2*dt,0.1)
  dt=state.smoothedDt
  state.poll=state.poll+dt
  if state.poll>0.25 then browserState(); state.poll=0 end
  local rawX,rawY=love.mouse.getPosition()
  room:update(dt,state.time,(rawX-offsetX)/layoutScale,(rawY-offsetY)/layoutScale,state.reduced,preferences.screenshake)
  -- Game:update applies canvas juice before advancing REAL/REAL_SHADER.
  state.time=state.time+dt
  screen:update(state.time,offsetX+room.cursorX*layoutScale,offsetY+room.cursorY*layoutScale,state.reduced,preferences)
  local mx,my=pointer(love.mouse.getPosition())
  if state.page=='decks' or state.page=='builder' then
    local lx,ly=libraryPoint(mx,my)
    collection():update(dt,state.time,popup and -1000 or lx,popup and -1000 or ly,state.reduced)
  end
  if popup then
    if love.filesystem.getInfo('__account.txt') then
      local previousMessage=account.message
      if account:sync(love.filesystem.read('__account.txt')) then
        popup:accountChanged()
        if popup.tab==4 and account.message~='' and account.message~=previousMessage then announce(account.message) end
      end
    end
    if love.filesystem.getInfo('__account_input.txt') then account:input(love.filesystem.read('__account_input.txt')) end
    if love.filesystem.getInfo('__auth_input.txt') then popup:authInput(love.filesystem.read('__auth_input.txt')) end
    popup:update(dt,state.time,mx,my,state.reduced)
    love.mouse.setCursor(popup.hover>0 and state.handCursor or state.arrowCursor)
    return
  end
  if state.page=='decks' or state.page=='builder' then
    love.mouse.setCursor(collection().hover>0 and state.handCursor or state.arrowCursor)
    return
  end
  local hovered=hit(mx,my)
  if hovered~=state.hovered then
    state.hovered=hovered
    love.mouse.setCursor(hovered>0 and state.handCursor or state.arrowCursor)
  end
  if state.leaving and state.time-state.leaving.at>0.17 then
    print('LUMINOUS:navigate:'..state.leaving.route)
    state.leaving=nil
  end
end
local function button(b,index)
  local active=state.hovered==index or state.focused==index
  local clicked=state.lastClicked and state.lastClicked.index==index and state.time-state.lastClicked.at<0.1
  local pressed=(state.pressed==index and state.hovered==index) or clicked
  Button.draw(b,active,pressed,state.focused==index,virtualWidth)
end
function love.draw()
  if not scene then return end
  local t=state.reduced and 300 or state.time
  g.setCanvas(scene); g.clear(T.ink)
  local bg=shaders.splash
  bg:send('time',t); bg:send('vort_speed',0.4); bg:send('colour_1',T.red); bg:send('colour_2',T.blue); bg:send('mid_flash',0); bg:send('vort_offset',0)
  g.setShader(bg); g.setColor(1,1,1); g.rectangle('fill',0,0,width,height); g.setShader()
  g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale)
  room:apply()
  local portrait=virtualWidth<600
  local titleY=portrait and 55 or 145
  local titleSize=portrait and 78 or 136
  g.push(); g.translate(virtualWidth/2,titleY+titleSize/2)
  if not state.reduced then g.rotate(math.sin(state.time*0.6)*0.012) end
  T.text('LUMINOUS',titleSize,-virtualWidth/2,-titleSize/2+5,virtualWidth,T.ink)
  T.text('LUMINOUS',titleSize,-virtualWidth/2,-titleSize/2,virtualWidth,T.white)
  g.pop()
  T.text('Pick your next move',portrait and 23 or 28,0,portrait and 146 or 300,virtualWidth,T.paper)
  Button.tray(menuTray.x,menuTray.y,menuTray.w,menuTray.h)
  for i,b in ipairs(menu) do button(b,i) end
  local selected=state.hovered>0 and state.hovered or state.focused
  local description=selected>0 and selected<=#menu and menu[selected].description or ''
  T.text(description,portrait and 23 or 25,0,portrait and 650 or 572,virtualWidth,T.paper)
  -- Profile-style inset buttons, with 0.2-tile padding and no extra heading.
  for i,b in ipairs(controls) do
    Button.tray(b.x-12,b.y-12,b.w+24,b.h+24)
    button(b,#menu+i)
  end
  T.text('Luminous',19,24,virtualHeight-33,160,T.paper,'left')
  T.text('Home',19,virtualWidth-130,virtualHeight-33,106,T.paper,'right')
  g.pop()
  if state.page=='decks' or state.page=='builder' then
    Modal.backdrop(width,height)
    g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale); room:apply()
    libraryTransform(); collection():draw(shaders)
    g.pop()
    if collection().modal then
      Modal.backdrop(width,height)
      g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale); room:apply()
      libraryTransform(); collection():drawModal(shaders)
      g.pop()
    end
  end
  if popup then
    Modal.backdrop(width,height)
    g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale); room:apply()
    popup:draw()
    g.pop()
  end
  g.setCanvas()
  screen:draw(scene)
end
local function unlockAudio()
  state.audioUnlocked=true
  if not state.muted and not sounds.music1:isPlaying() then sounds.music1:play() end
end
function love.mousepressed(x,y,button)
  if button~=1 then return end
  unlockAudio(); state.focused=0
  x,y=pointer(x,y)
  if popup then popup:mousepressed(x,y); return end
  if state.page=='decks' or state.page=='builder' then collection():mousepressed(libraryPoint(x,y)); return end
  state.pressed=hit(x,y)
end
function love.mousereleased(x,y,button)
  if button~=1 then return end
  x,y=pointer(x,y)
  if popup then popup:mousereleased(x,y); return end
  if state.page=='decks' or state.page=='builder' then collection():mousereleased(libraryPoint(x,y)); return end
  if state.pressed and state.pressed==hit(x,y) then activate(state.pressed) end
  state.pressed=nil
end
function love.keypressed(key)
  unlockAudio()
  if popup then popup:keypressed(key); return end
  if state.page=='decks' or state.page=='builder' then collection():keypressed(key); return end
  if key=='tab' or key=='right' or key=='down' or key=='left' or key=='up' then
    local backward=key=='left' or key=='up' or (key=='tab' and love.keyboard.isDown('lshift','rshift'))
    local count=#menu+#controls
    state.focused=state.focused==0 and (backward and count or 1)
      or ((state.focused-1+(backward and -1 or 1))%count)+1
    local item=state.focused<=#menu and menu[state.focused] or controls[state.focused-#menu]
    announce(item.label)
  elseif key=='return' or key=='space' then activate(state.focused)
  elseif key=='m' then
    preferences:set('muted',1-preferences.muted)
    savePreferences()
    announce(state.muted and 'Sound: off' or 'Sound: on')
  elseif key=='escape' then
    state.focused=0; state.pressed=nil
  end
end
function love.focus(focused)
  state.windowFocused=focused
  if not focused then
    sounds.music1:pause()
    state.pressed=nil
    if popup then popup.drag=nil; popup.pressed=nil end
    if builder then
      builder.drag=nil;builder.hpDrag=nil;builder.pressed=nil
      if builder.dragCard then builder.dragCard.texture:release();builder.dragCard=nil end
      for _,card in ipairs(builder.cards) do card.dragging=false end
    end
    if library then
      library.drag=nil; library.pressed=nil
      for _,card in ipairs(library.cards) do card.dragging=false end
    end
  elseif state.audioUnlocked and not state.muted then
    sounds.music1:play()
  end
end

function love.wheelmoved(x,y)
  if (state.page=='decks' or state.page=='builder') and not popup then collection():wheelmoved(y) end
end
