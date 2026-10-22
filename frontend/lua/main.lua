local T = require('ui.theme')
local Button = require('ui.button')
local Room = require('ui.room')
local Screen = require('ui.screen')
local ScreenWipe = require('ui.screen_wipe')
local Preferences = require('ui.preferences')
local Settings = require('ui.settings')
local Account = require('ui.account')
local Library = require('ui.library')
local Builder = require('ui.builder')
local Sandbox = require('ui.sandbox')
local Simulator = require('ui.simulator')
local Online = require('ui.online')
local Modal = require('ui.modal')
local MenuLogo = require('ui.menu_logo')
local g = love.graphics
-- Game:main_menu starts REAL at 12 when skipping the introductory splash.
local state = {time=12,focused=0,hovered=0,muted=false,reduced=false,poll=0,ready=false}
local shaders, sounds, controls = {}, {}, {}
local soundVoices={}
local menuTray,room,screen,popup,library,builder,sandbox,simulator,online,menuLogo
local function collection() return state.page=='sandbox' and sandbox or state.page=='builder' and builder or library end
-- Pages drawn on the game table; moving to or from one runs the screen wipe.
local function isTable(page) return page=='simulator' or page=='match' end
local function title(page)
  return 'Luminous - '..(page=='simulator' and 'Simulator' or page=='match' and 'Online match' or page=='sandbox' and 'Sandbox' or page=='builder' and 'Deck builder' or page=='decks' and 'Decks' or page=='online' and 'Online' or 'Home')
end
local preferences=Preferences.new()
local account=Account.new()
local openSettings,closeSettings,applyPreferences,startWipe,applyPage,requestPage,cancelInteractions
local wipe,pendingPage
local scene, width, height, layoutScale, offsetX, offsetY, virtualWidth, virtualHeight
local menu = {
  {label='Sandbox', route='/simulator', colour=T.blue},
  {label='Online', route='/lobby', colour=T.red},
  {label='Decks', route='/decks', colour=T.paleGreen},
}
local quiet={paper1=0.35,multhit1=0.7,multhit2=0.7,coin1=0.6,coin3=0.6,glass2=0.5,cardFan2=0.5,whoosh=0.5,win=0.7,tarot2=0.4}
local function sound(name,pitch,volume,sourceVolume)
  if state.muted then return end
  local s=sounds[name]
  if not s then return end
  -- Source-matched cues use PLAY_SOUND's absolute gain and can overlap an
  -- already playing copy. Other callers retain their existing mix.
  if sourceVolume and s:isPlaying() then s=s:clone();soundVoices[#soundVoices+1]=s else s:stop() end
  local gain=sourceVolume and (volume or 1) or (quiet[name] or 0.6)*(volume or 1)
  s:setPitch(pitch or 1);s:setVolume(gain*preferences.volume/100*preferences.effectsVolume/100);s:play()
end
local function announce(text) print('LUMINOUS:announce:'..text) end
local function layout(w,h)
  width,height=w,h
  state.pressed=nil
  local portrait=w/h<0.9
  virtualWidth,virtualHeight=portrait and 480 or 1280,portrait and 850 or 800
  layoutScale=math.min(w/virtualWidth,h/virtualHeight)
  offsetX,offsetY=(w-virtualWidth*layoutScale)/2,(h-virtualHeight*layoutScale)/2
  room=Room.new(virtualWidth,virtualHeight,Screen.unit(w,h)/layoutScale)
  local buttonWidth,buttonHeight=portrait and 368 or 219,portrait and 68 or 93
  local gap,padding=portrait and 16 or 12,portrait and 14 or 12
  local menuWidth=portrait and buttonWidth or #menu*buttonWidth+(#menu-1)*gap
  local menuHeight=portrait and #menu*buttonHeight+(#menu-1)*gap or buttonHeight
  local menuX=(virtualWidth-menuWidth)/2
  local menuY=portrait and 535-menuHeight/2 or 550
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
  if sandbox then sandbox:layout(virtualWidth,virtualHeight) end
  if online then online:layout(virtualWidth,virtualHeight) end
  if simulator then simulator:layout(virtualWidth,virtualHeight,Screen.unit(w,h)/layoutScale) end
  if wipe then wipe:layout(virtualWidth,virtualHeight,Screen.unit(w,h)/layoutScale,w/layoutScale,h/layoutScale) end
  love.window.setTitle(title(state.page))
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
-- Keep the outgoing page alive until the opaque square covers it. New
-- browser-history requests replace a pending destination instead of stacking
-- transitions or leaving a stale callback able to reopen an old game.
applyPage=function(page,deckId)
  -- Create/Join replace the URL with the lobby code; the modal stays put.
  if page=='online' and state.page=='online' then state.deckId=deckId;online:retarget(deckId);return end
  if state.page=='online' then online:close() end
  if state.page=='builder' then builder:command('close') end
  if state.page=='sandbox' then sandbox:command('close') end
  if isTable(state.page) then simulator:command('close') end
  state.deckId=deckId
  if popup then closeSettings() end
  state.page=page;state.leaving=nil;state.pressed=nil;state.focused=0
  love.window.setTitle(title(page))
  if page=='simulator' then
    library:command('close');simulator:open(state.reduced)
  elseif page=='match' then
    library:command('close');simulator:open(state.reduced,false,'online',deckId or '')
  elseif page=='builder' then
    library:command('close');builder:open(state.reduced,deckId);print('LUMINOUS:account:refresh')
  elseif page=='sandbox' then
    library:command('close');sandbox:open(state.reduced);print('LUMINOUS:account:refresh')
  elseif page=='decks' then
    library:open(state.reduced);print('LUMINOUS:account:refresh')
  elseif page=='online' then
    library:command('close');room.jiggle=room.jiggle+1;online:open(state.reduced,deckId or '');print('LUMINOUS:account:refresh')
  else library:closeModal();library:command('close') end
end
startWipe=function(callback)
  if wipe then return false end
  state.pressed=nil;state.hovered=0;state.focused=0
  -- Clear held interactions so an old drag cannot move during the wipe.
  cancelInteractions()
  local colour=isTable(state.page) and simulator:backgroundColours()[2] or T.panel
  wipe=ScreenWipe.new(callback,colour,state.reduced,function(name,pitch,volume) sound(name,pitch,volume,true) end)
  wipe:layout(virtualWidth,virtualHeight,Screen.unit(width,height)/layoutScale,width/layoutScale,height/layoutScale)
  print('LUMINOUS:transition:open')
  return true
end
requestPage=function(page,deckId)
  pendingPage={page=page,deckId=deckId}
  if wipe then return end
  local function commit()
    local destination=pendingPage;pendingPage=nil
    if destination and (destination.page~=state.page or destination.deckId~=state.deckId) then
      applyPage(destination.page,destination.deckId)
    end
  end
  if state.ready and page~=state.page and isTable(page)~=isTable(state.page) then
    startWipe(commit)
  else commit() end
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
      requestPage(page,fields[3])
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
  if popup or wipe then return end
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
  if item.route=='/simulator' then print('LUMINOUS:simulator:resume'); return end
  if item.route=='/decks' then print('LUMINOUS:page:decks'); return end
  if item.route=='/lobby' then print('LUMINOUS:page:online'); return end
  if item.action=='settings' then openSettings(); return end
  if item.action=='account' then openSettings(false,4); return end
  state.leaving={route=item.route,at=state.time,index=index}
  announce('Opening '..item.label)
end
function love.load()
  g.setDefaultFilter('nearest','nearest')
  menuLogo=MenuLogo.new()
  state.handCursor=love.mouse.getSystemCursor('hand')
  state.arrowCursor=love.mouse.getSystemCursor('arrow')
  for _,name in ipairs({'splash','background','CRT','dissolve','played'}) do shaders[name]=g.newShader('assets/shaders/'..name..'.fs') end
  for _,name in ipairs({'button','music1','cardSlide1','highlight1','paper1','card1','cardSlide2','cardFan2','chips1','multhit1','multhit2','cancel','coin1','coin3','tarot2','whoosh','whoosh2','crumple1','crumple2','crumple3','crumple4','crumple5','generic1','win','glass2','gold_seal'}) do
    if love.filesystem.getInfo('assets/sounds/'..name..'.ogg') then sounds[name]=love.audio.newSource('assets/sounds/'..name..'.ogg',name=='music1' and 'stream' or 'static') end
  end
  sounds.music1:setLooping(true); sounds.music1:setVolume(0.16)
  library=Library.new({
    command=function(command) print('LUMINOUS:library:'..command) end,
    feedback=function(name,pitch,volume) sound(name,pitch,volume) end,
    announce=announce,
    refresh=function() print('LUMINOUS:account:refresh') end,
    home=function() print('LUMINOUS:page:home') end,
    settings=function() openSettings() end,
    signin=function() openSettings(false,4); popup:openAuth('login') end,
  })
  builder=Builder.new({
    command=function(command) print('LUMINOUS:builder:'..command) end,
    feedback=function(name,pitch,volume) sound(name,pitch,volume) end,
    announce=announce,
    signin=function() openSettings(false,4); popup:openAuth('login') end,
  })
  sandbox=Sandbox.new({
    command=function(command) print('LUMINOUS:sandbox:'..command) end,
    feedback=function(name,pitch,volume) sound(name,pitch,volume) end,
    announce=announce,
    refresh=function() print('LUMINOUS:account:refresh') end,
    home=function() print('LUMINOUS:page:home') end,
    decks=function() print('LUMINOUS:page:decks') end,
    signin=function() openSettings(false,4); popup:openAuth('login') end,
  })
  online=Online.new({
    command=function(command) print('LUMINOUS:online:'..command) end,
    feedback=function(name,pitch,volume) sound(name,pitch,volume) end,
    announce=announce,
    home=function() print('LUMINOUS:page:home') end,
    signin=function() openSettings(false,4); if popup then popup:openAuth('login') end end,
    jiggle=function(amount) room.jiggle=room.jiggle+(amount or 1) end,
  })
  simulator=Simulator.new({transition=function(callback) return startWipe(callback) end,command=function(command) print('LUMINOUS:simulator:'..command) end,
    feedback=function(name,pitch,volume) sound(name,pitch,volume) end,
    sourceFeedback=function(name,pitch,volume) sound(name,pitch,volume,true) end,
    announce=announce,settings=function() openSettings() end,
    jiggle=function(amount) room.jiggle=room.jiggle+(amount or 1) end})
  layout(g.getDimensions())
  browserState()
  state.ready=true
  print('LUMINOUS:ready')
end
function love.resize(w,h) if scene then layout(w,h) end end
function love.update(dt)
  for i=#soundVoices,1,-1 do
    local s=soundVoices[i]
    if state.muted then s:stop() end
    if not s:isPlaying() then s:release();table.remove(soundVoices,i) end
  end
  account:update(dt)
  state.smoothedDt=math.min(0.8*(state.smoothedDt or 1/100)+0.2*dt,0.1)
  dt=state.smoothedDt
  state.poll=state.poll+dt
  if state.poll>0.25 then browserState(); state.poll=0 end
  local rawX,rawY=love.mouse.getPosition()
  room:update(dt,state.time,(rawX-offsetX)/layoutScale,(rawY-offsetY)/layoutScale,state.reduced,preferences.screenshake)
  -- Game:update applies canvas juice before advancing REAL/REAL_SHADER.
  state.time=state.time+dt
  menuLogo:update(dt,state.reduced)
  screen:update(state.time,offsetX+room.cursorX*layoutScale,offsetY+room.cursorY*layoutScale,state.reduced,preferences)
  if wipe and wipe:update(dt) then
    wipe:release();wipe=nil
    print('LUMINOUS:transition:closed')
    if pendingPage then requestPage(pendingPage.page,pendingPage.deckId) end
  end
  local mx,my=pointer(love.mouse.getPosition())
  if wipe then mx,my=-1000,-1000 end
  if isTable(state.page) then simulator:update(dt,state.time,popup and -1000 or mx,popup and -1000 or my,state.reduced) end
  if state.page=='decks' or state.page=='builder' or state.page=='sandbox' then
    local lx,ly=libraryPoint(mx,my)
    collection():update(dt,state.time,popup and -1000 or lx,popup and -1000 or ly,state.reduced)
  end
  -- The lobby keeps polling under Settings (sign-in) and during a wipe.
  if state.page=='online' then online:update(dt,state.time,popup and -1000 or mx,popup and -1000 or my,state.reduced) end
  if wipe then love.mouse.setCursor(state.arrowCursor);return end
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
  if state.page=='decks' or state.page=='builder' or state.page=='sandbox' then
    love.mouse.setCursor(collection().hover>0 and state.handCursor or state.arrowCursor)
    return
  end
  if state.page=='online' then love.mouse.setCursor(online.hover>0 and state.handCursor or state.arrowCursor);return end
  if isTable(state.page) then love.mouse.setCursor((simulator.hover>0 or simulator.hoverCard or (simulator.overlay and simulator.overlay.hover>0)) and state.handCursor or state.arrowCursor);return end
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
  local bg=isTable(state.page) and shaders.background or shaders.splash
  if isTable(state.page) then
    -- Game:draw's background.fs with ease_background_colour's eased palette.
    local c=simulator:backgroundColours()
    bg:send('time',t);bg:send('spin_time',0);bg:send('spin_amount',0)
    bg:send('colour_1',c[2]);bg:send('colour_2',c[1]);bg:send('colour_3',c[3]);bg:send('contrast',c.contrast or 1)
  else
  bg:send('time',t); bg:send('vort_speed',0.4); bg:send('colour_1',T.red); bg:send('colour_2',T.blue); bg:send('mid_flash',0); bg:send('vort_offset',0)
  end
  g.setShader(bg); g.setColor(1,1,1); g.rectangle('fill',0,0,width,height); g.setShader()
  g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale)
  room:apply()
  if isTable(state.page) then simulator:draw(shaders) else
  local portrait=virtualWidth<600
  -- Like Game:main_menu's SPLASH_LOGO, the lettering is a painted sprite.
  -- Draw inside the room/CRT pass so scanlines and fringing stay live.
  local logoWidth,logoHeight=menuLogo:getDimensions()
  local logoScale=(portrait and 440 or 900)/logoWidth
  g.push(); g.translate(virtualWidth/2,portrait and 235 or 310)
  if not state.reduced then g.rotate(math.sin(state.time*0.6)*0.012) end
  g.setColor(1,1,1)
  menuLogo:draw(logoScale)
  g.pop()
  Button.tray(menuTray.x,menuTray.y,menuTray.w,menuTray.h)
  for i,b in ipairs(menu) do button(b,i) end
  -- Profile-style inset buttons, with 0.2-tile padding and no extra heading.
  for i,b in ipairs(controls) do
    Button.tray(b.x-12,b.y-12,b.w+24,b.h+24)
    button(b,#menu+i)
  end
  T.text('Luminous',19,24,virtualHeight-33,160,T.paper,'left')
  T.text('Home',19,virtualWidth-130,virtualHeight-33,106,T.paper,'right')
  end
  g.pop()
  if state.page=='decks' or state.page=='builder' or state.page=='sandbox' then
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
  if state.page=='online' then
    Modal.backdrop(width,height)
    g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale); room:apply()
    online:draw()
    g.pop()
  end
  if popup then
    Modal.backdrop(width,height)
    g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale); room:apply()
    popup:draw()
    g.pop()
  end
  if wipe then
    g.push();g.translate(offsetX,offsetY);g.scale(layoutScale);room:apply()
    wipe:draw(shaders,isTable(state.page) and simulator:backgroundColours()[2] or T.panel);g.pop()
  end
  g.setCanvas()
  screen:draw(scene)
end
local function unlockAudio()
  state.audioUnlocked=true
  if not state.muted and not sounds.music1:isPlaying() then sounds.music1:play() end
end
function love.mousepressed(x,y,button)
  if button~=1 or wipe then return end
  unlockAudio(); state.focused=0
  x,y=pointer(x,y)
  if popup then popup:mousepressed(x,y); return end
  if isTable(state.page) then simulator:mousepressed(x,y);return end
  if state.page=='online' then online:mousepressed(x,y);return end
  if state.page=='decks' or state.page=='builder' or state.page=='sandbox' then collection():mousepressed(libraryPoint(x,y)); return end
  state.pressed=hit(x,y)
end
function love.mousereleased(x,y,button)
  if button~=1 or wipe then return end
  x,y=pointer(x,y)
  if popup then popup:mousereleased(x,y); return end
  if isTable(state.page) then simulator:mousereleased(x,y);return end
  if state.page=='online' then online:mousereleased(x,y);return end
  if state.page=='decks' or state.page=='builder' or state.page=='sandbox' then collection():mousereleased(libraryPoint(x,y)); return end
  if state.pressed and state.pressed==hit(x,y) then activate(state.pressed) end
  state.pressed=nil
end
function love.keypressed(key)
  if wipe then return end
  unlockAudio()
  if popup then popup:keypressed(key); return end
  if isTable(state.page) then simulator:keypressed(key);return end
  if state.page=='online' then online:keypressed(key);return end
  if state.page=='decks' or state.page=='builder' or state.page=='sandbox' then collection():keypressed(key); return end
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
cancelInteractions=function()
    state.pressed=nil
    if popup then popup.drag=nil; popup.pressed=nil end
    if builder then
      builder.drag=nil;builder.hpDrag=nil;builder.pressed=nil
      if builder.dragCard then builder.dragCard.texture:release();builder.dragCard=nil end
      for _,card in ipairs(builder.cards) do card.dragging=false end
    end
    if simulator then
      if simulator.drag then simulator.drag.card.dragging=false end
      simulator.drag=nil;simulator.clicked=nil;simulator.pressed=nil;simulator.pressedOverlay=nil;simulator.clickedPrize=nil
    end
    if sandbox then sandbox.pressed=nil end
    if online then online.pressed=nil end
    if library then
      library.drag=nil; library.pressed=nil
      for _,card in ipairs(library.cards) do card.dragging=false end
    end
end
function love.focus(focused)
  state.windowFocused=focused
  if not focused then
    sounds.music1:pause()
    cancelInteractions()
  elseif state.audioUnlocked and not state.muted then
    sounds.music1:play()
  end
end

function love.wheelmoved(x,y)
  if wipe then return end
  if isTable(state.page) and not popup then simulator:wheelmoved(y);return end
  if state.page=='online' and not popup then online:wheelmoved(y);return end
  if (state.page=='decks' or state.page=='builder' or state.page=='sandbox') and not popup then collection():wheelmoved(y) end
end
