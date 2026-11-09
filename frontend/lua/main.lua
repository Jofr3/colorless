local T = require('ui.theme')
local Button = require('ui.button')
local Room = require('ui.room')
local Screen = require('ui.screen')
local ScreenWipe = require('ui.screen_wipe')
local Preferences = require('ui.preferences')
local Settings = require('ui.settings')
local Account = require('ui.account')
local Codec = require('ui.codec')
local Bridge = require('ui.bridge')
local Mailbox = require('ui.mailbox')
local Library = require('ui.library')
local Builder = require('ui.builder')
local Sandbox = require('ui.sandbox')
local Simulator = require('ui.simulator')
local Online = require('ui.online')
local Modal = require('ui.modal')
local MenuLogo = require('ui.menu_logo')
local Controls = require('ui.controls')
local Pacer = require('ui.frame_pacer')
local Viewport = require('ui.viewport')
local Size = require('ui.interface_size')
local Display = require('ui.display')
local LobbySize = require('ui.lobby_size')
local g = love.graphics
-- Game:main_menu starts REAL at 12 when skipping the introductory splash.
local state = {time=12,focused=0,hovered=0,muted=false,reduced=false,poll=0,ready=false,parked=false,lastInput='pointer',focusEdge='none'}
local shaders, sounds, controls = {}, {}, {}
-- Shaders home's first frame does not need (audit LC8): love.load compiles only splash and CRT,
-- and these compile one per update after ready, or at once for a page or wipe that draws with
-- them first. Reading one that has not compiled yet compiles it, so no draw meets a missing one.
local LATER_SHADERS={'background','dissolve','played'}
local function ensureShader(name)
  local shader=rawget(shaders,name)
  if not shader then
    local path='assets/shaders/'..name..'.fs'
    local code=name=='CRT' and love.filesystem.read(path)
    shader=love.graphics.newShader(code and Screen.source(code) or path)
    rawset(shaders,name,shader)
  end
  return shader
end
local later={}
for _,name in ipairs(LATER_SHADERS) do later[name]=true end
setmetatable(shaders,{__index=function(_,name) if later[name] then return ensureShader(name) end end})
local function ensureShaders(...)
  for _,name in ipairs({...}) do ensureShader(name) end
end
-- The next shader the warm-up compiles, or nil once all have.
local function nextShader()
  for _,name in ipairs(LATER_SHADERS) do if not rawget(shaders,name) then return name end end
end
local soundVoices={}
local menuTray,room,screen,popup,library,builder,sandbox,simulator,online,menuLogo
local screens={}
local function collection() return state.page=='sandbox' and sandbox or state.page=='builder' and builder or library end
-- Pages drawn as the collection panel over the dimmed home.
local function isCollection(page) return page=='decks' or page=='builder' or page=='sandbox' end
-- Pages drawn on the game table; moving to or from one runs the screen wipe.
local function isTable(page) return page=='simulator' or page=='match' end
local preferences=Preferences.new()
local account=Account.new()
local openSettings,closeSettings,applyPreferences,startWipe,applyPage,requestPage,cancelInteractions,parkPointer
local wipe,pendingPage
-- Input waits only while the wipe's card covers the screen. Once the destination is on screen it
-- takes input, though the card is still dissolving: a tap in that second used to be dropped, and
-- on slow frames the dissolve stretched it further. A page asked for meanwhile waits in
-- pendingPage until the wipe is gone.
local function covering() return wipe~=nil and not wipe.committed end
local scene, width, height, layoutScale, offsetX, offsetY, virtualWidth, virtualHeight
-- Device pixels per CSS pixel: width and height are the canvas's device pixels (audit BT6).
local density=1
-- Settings' Interface Size (audit LQX2, ui/interface_size.lua). A layer at `scale` lays out in a
-- w x h canvas, the virtual canvas divided by its scale, and draws scaled up about the canvas
-- centre, so it covers the same part of the screen. Home grows in landscape (its compact
-- arrangement still fits 150%), Settings as far as its tallest form fits; the collection panel
-- drops its 0.9 inset; the online lobby grows per step (onlineLayer); the table and the wipe are
-- as large as the canvas.
local homeLayer,popupLayer,tableLayer={scale=1},{scale=1},{scale=1}
-- The smallest canvas each growing layer fits: home's compact arrangement, and Settings' widest
-- popup (780) and tallest form (620) with a margin.
local HOME_MIN,POPUP_MIN={720,520},{812,640}
-- The online lobby is a layer of its own (UI-FU2): each step grows as far as its compact
-- arrangement fits (ui/lobby_size.lua), so a step change can move it to another size.
local onlineLayer={scale=1}
-- The collection panel's scale over the dimmed home: 0.9 in landscape at 100%.
local collectionScale=0.9
-- Home's logo: its centre height and drawn width.
local homeLogo={y=310,width=900}
local menu = {
  {label='Sandbox', action='sandbox', colour=T.blue},
  {label='Online', action='online', colour=T.red},
  {label='Decks', action='decks', colour=T.paleGreen},
}
local effects={'button','cardSlide1','highlight1','paper1','card1','cardSlide2','cardFan2','chips1','multhit1','multhit2','cancel','coin1','coin3','tarot2','whoosh','whoosh2','crumple1','crumple2','crumple3','crumple4','crumple5','generic1','win','glass2','gold_seal'}
local unloadedEffects={}
-- The host writes the menu music after the first frame; the menu starts without it.
local MUSIC='assets/sounds/music1.ogg'
-- The host downloads the music only when Lua asks (audit BT8), so a player who muted it or turned
-- it down to nothing never pays for it: 'start' once the stored preferences are read and say it
-- is heard (the host waits for ready, and skips it under Save-Data), 'change' when the player
-- unmutes or turns a volume up (always downloaded).
local function musicLevel() return preferences.muted==1 and 0 or preferences.volume*preferences.musicVolume end
local function askForMusic(reason)
  if not sounds.music1 and not love.filesystem.getInfo(MUSIC) then Bridge.emit('music','want',reason) end
end
local quiet={paper1=0.35,multhit1=0.7,multhit2=0.7,coin1=0.6,coin3=0.6,glass2=0.5,cardFan2=0.5,whoosh=0.5,win=0.7,tarot2=0.4}
-- Effects decode after startup, one per frame, or on first use.
local function loadEffect(name)
  unloadedEffects[name]=nil
  local path='assets/sounds/'..name..'.ogg'
  if love.filesystem.getInfo(path) then sounds[name]=love.audio.newSource(path,'static') end
  return sounds[name]
end
local function loadMusic()
  if sounds.music1 or not love.filesystem.getInfo(MUSIC) then return end
  sounds.music1=love.audio.newSource(MUSIC,'stream')
  sounds.music1:setLooping(true)
  applyPreferences()
end
local function sound(name,pitch,volume,sourceVolume)
  if state.muted then return end
  local s=sounds[name] or unloadedEffects[name] and loadEffect(name)
  if not s then return end
  -- Source-matched cues use PLAY_SOUND's absolute gain and can overlap an
  -- already playing copy. Other callers retain their existing mix.
  if sourceVolume and s:isPlaying() then s=s:clone();soundVoices[#soundVoices+1]=s else s:stop() end
  local gain=sourceVolume and (volume or 1) or (quiet[name] or 0.6)*(volume or 1)
  s:setPitch(pitch or 1);s:setVolume(gain*preferences.volume/100*preferences.effectsVolume/100);s:play()
end
local function announce(text) Bridge.emit('announce',text) end
-- The redraw gate (love.run): anything that can change the picture keeps every update drawing for
-- REDRAW_SECONDS, and a static frame is drawn again every BACKSTOP_SECONDS anyway, so a change
-- nothing reported shows within a second.
local REDRAW_SECONDS,BACKSTOP_SECONDS=0.5,1
local function redraw() state.redrawUntil=state.time+REDRAW_SECONDS end
-- Update and draw run at most this many times a second (Settings' Max Frame Rate).
local function frameCap() return preferences.highFrameRate==1 and 144 or 60 end
-- A point on the virtual canvas in a layer's canvas, and the layer's drawing transform.
local function layerPoint(layer,x,y)
  if layer.scale==1 then return x,y end
  return (x-virtualWidth/2)/layer.scale+layer.w/2,(y-virtualHeight/2)/layer.scale+layer.h/2
end
local function applyLayer(layer)
  if layer.scale==1 then return end
  g.translate(virtualWidth/2,virtualHeight/2); g.scale(layer.scale); g.translate(-layer.w/2,-layer.h/2)
end
-- How much Settings' Interface Size asks for.
local function interfaceStep() return Size.steps[preferences.interfaceSize+1] end
-- Each layer's scale and canvas for the virtual canvas and the chosen Interface Size.
local function arrangeLayers(portrait)
  local function fit(layer,minimum)
    layer.scale=portrait and 1 or Size.factor(preferences.interfaceSize,virtualWidth,virtualHeight,minimum[1],minimum[2])
    layer.w,layer.h=virtualWidth/layer.scale,virtualHeight/layer.scale
  end
  fit(homeLayer,HOME_MIN);fit(popupLayer,POPUP_MIN);tableLayer.w,tableLayer.h=virtualWidth,virtualHeight
  collectionScale=(portrait or preferences.interfaceSize>0) and 1 or 0.9
end
-- The lobby's scale and canvas for its current step; true when the scale changed.
local function fitOnline(portrait)
  local minW,minH=LobbySize.minimum(online.step)
  local scale=portrait and 1 or Size.factor(preferences.interfaceSize,virtualWidth,virtualHeight,minW,minH)
  local changed=scale~=onlineLayer.scale
  onlineLayer.scale,onlineLayer.w,onlineLayer.h=scale,virtualWidth/scale,virtualHeight/scale
  return changed
end
local function layout(w,h,pixelDensity)
  width,height,density=w,h,pixelDensity or 1
  redraw()
  state.pressed=nil
  local portrait=w/h<0.9
  virtualWidth,virtualHeight=portrait and 480 or 1280,portrait and 850 or 800
  layoutScale=math.min(w/virtualWidth,h/virtualHeight)
  offsetX,offsetY=(w-virtualWidth*layoutScale)/2,(h-virtualHeight*layoutScale)/2
  room=Room.new(virtualWidth,virtualHeight,Screen.unit(w,h)/layoutScale)
  arrangeLayers(portrait)
  state.interfaceSize=preferences.interfaceSize
  local css=layoutScale/density
  -- The table stays at 100%; Interface Size grows its text overlays instead (audit FU1).
  Display.set({scale=css,collection=css*collectionScale,popup=css*popupLayer.scale,tableText=interfaceStep(),portrait=portrait,coarse=state.coarse or false})
  -- Home lays out in its layer's canvas: in landscape smaller than 800 tall the menu rises, with
  -- the logo between it and the top edge, shrunk only when it does not fit.
  local homeWidth,homeHeight=homeLayer.w,homeLayer.h
  local buttonWidth,buttonHeight=portrait and 368 or 219,portrait and 68 or 93
  local gap,padding=portrait and 16 or 12,portrait and 14 or 12
  local menuWidth=portrait and buttonWidth or #menu*buttonWidth+(#menu-1)*gap
  local menuHeight=portrait and #menu*buttonHeight+(#menu-1)*gap or buttonHeight
  local menuX=(homeWidth-menuWidth)/2
  local menuY=portrait and 535-menuHeight/2 or math.min(550,homeHeight-250)
  for i,b in ipairs(menu) do
    b.w,b.h=buttonWidth,buttonHeight
    b.x=menuX+(portrait and 0 or (i-1)*(buttonWidth+gap))
    b.y=menuY+(portrait and (i-1)*(buttonHeight+gap) or 0)
    b.fontSize=portrait and 36 or 38
    b.uppercase=true
  end
  menuTray={x=menuX-padding,y=menuY-padding,w=menuWidth+2*padding,h=menuHeight+2*padding}
  controls={
    {label='Account',action='account',x=homeWidth/2-144,y=homeHeight-104,w=120,h=48,fontSize=24,colour=T.profile},
    {label='Settings',action='settings',x=homeWidth/2+24,y=homeHeight-104,w=120,h=48,fontSize=24,colour=T.profile},
  }
  if portrait or homeHeight>=800 then homeLogo.y,homeLogo.width=portrait and 235 or 310,portrait and 440 or 900
  else
    -- Between the tray's top and the canvas top, 16 clear on each side.
    local logoWidth,logoHeight=menuLogo:getDimensions()
    homeLogo.y=menuTray.y/2
    homeLogo.width=math.min(900,(menuTray.y-32)*logoWidth/logoHeight)
  end
  if scene then scene:release() end
  scene=g.newCanvas(w,h)
  scene:setFilter('linear','linear') -- love.resize uses linear canvas filtering.
  screen=Screen.new(shaders.CRT,w,h,Screen.unit(w,h),density,css)
  if popup then popup:layout(popupLayer.w,popupLayer.h) end
  if library then library:layout(virtualWidth,virtualHeight) end
  if builder then builder:layout(virtualWidth,virtualHeight) end
  if sandbox then sandbox:layout(virtualWidth,virtualHeight) end
  if online then fitOnline(portrait);online:layout(onlineLayer.w,onlineLayer.h) end
  if simulator then simulator:layout(virtualWidth,virtualHeight,Screen.unit(w,h)/layoutScale) end
  if wipe then wipe:layout(virtualWidth,virtualHeight,Screen.unit(w,h)/layoutScale,w/layoutScale,h/layoutScale) end
end
local function pointer(x,y)
  x,y=screen:unproject(x,y)
  return room:unproject((x-offsetX)/layoutScale,(y-offsetY)/layoutScale)
end
-- Leave a visible border of the dimmed home behind the collection on desktop, at 100%.
local function libraryPoint(x,y)
  local scale=collectionScale
  return (x-virtualWidth/2)/scale+virtualWidth/2,(y-virtualHeight/2)/scale+virtualHeight/2
end
local function libraryTransform()
  local scale=collectionScale
  g.translate(virtualWidth/2,virtualHeight/2); g.scale(scale)
  g.translate(-virtualWidth/2,-virtualHeight/2+collection():offset())
end
-- Where `screen` draws the field a text proxy edits, for the page to put the proxy over it (audit
-- BR6): the IME window and a phone keyboard's pan then anchor at the field. Whole CSS pixels from
-- the canvas's top-left, through love.draw's own transforms; the room's sway and the CRT's bend
-- are left out, a few pixels that would move the box every frame. Nil while it edits nothing.
local function editBox(screen)
  local x,y,w,h
  if screen then x,y,w,h=screen:editBox() end
  if not x then return nil end
  g.push(); g.origin(); g.translate(offsetX,offsetY); g.scale(layoutScale)
  if screen==popup then applyLayer(popupLayer)
  elseif screen==online then applyLayer(onlineLayer)
  elseif isCollection(state.page) and screen==collection() then libraryTransform() end
  local left,top=g.transformPoint(x,y)
  local right,bottom=g.transformPoint(x+w,y+h)
  g.pop()
  local function css(v) return math.floor(v/density+0.5) end
  left,top,right,bottom=css(left),css(top),css(right),css(bottom)
  return {left,top,math.max(1,right-left),math.max(1,bottom-top)}
end
-- The screen whose fields take the keys: Settings over any page, else the lobby or a collection.
local function editingScreen()
  return popup or state.page=='online' and online or isCollection(state.page) and collection() or nil
end
-- A command that opens an edit (`action` first: input, or Settings' edit) carries its field's box
-- after its own fields (src/host/shell.ts reads them), and syncEditBox remembers it.
local function withEditBox(command,action,screen)
  if command:match('^[^\t]*')~=action then return command end
  local box=editBox(screen)
  state.editBox=box and table.concat(box,' ') or ''
  return box and command..'\t'..table.concat(box,'\t') or command
end
-- Once a frame: the box again when the field moved (a resize, a dialog sliding in), for the page
-- to move the proxy with it.
local function syncEditBox()
  local box=editBox(editingScreen())
  local key=box and table.concat(box,' ') or ''
  if key==state.editBox then return end
  state.editBox=key
  if box then Bridge.emit('field-box',unpack(box)) end
end
local function hit(x,y)
  x,y=layerPoint(homeLayer,x,y)
  for i,b in ipairs(menu) do if Button.hit(b,x,y) then return i end end
  for i,b in ipairs(controls) do if Button.hit(b,x,y) then return #menu+i end end
  return 0
end
-- Keep the outgoing page alive until the opaque square covers it. New
-- browser-history requests replace a pending destination instead of stacking
-- transitions or leaving a stale callback able to reopen an old game.
applyPage=function(page,deckId)
  redraw()
  -- Create/Join replace the URL with the lobby code; the modal stays put.
  if page=='online' and state.page=='online' then state.deckId=deckId;online:retarget(deckId);return end
  if state.page=='online' then online:close() end
  if state.page=='builder' then builder:command('close') end
  if state.page=='sandbox' then sandbox:command('close') end
  -- Cards draw with dissolve and played; the table's background with background.fs.
  if isTable(page) then ensureShaders('background','dissolve','played')
  elseif isCollection(page) then ensureShaders('dissolve','played') end
  if isTable(state.page) then simulator:command('close') end
  state.deckId=deckId
  if popup then closeSettings() end
  state.page=page;state.pressed=nil;state.focused=0
  if page=='simulator' then
    library:command('close');simulator:open(state.reduced)
  elseif page=='match' then
    library:command('close');simulator:open(state.reduced,false,'online',deckId or '')
  elseif page=='builder' then
    library:command('close');builder:open(state.reduced,deckId);Bridge.emit('account','refresh')
  elseif page=='sandbox' then
    library:command('close');sandbox:open(state.reduced);Bridge.emit('account','refresh')
  elseif page=='decks' then
    library:open(state.reduced);Bridge.emit('account','refresh')
  elseif page=='online' then
    library:command('close');room.jiggle=room.jiggle+1;online:open(state.reduced,deckId or '');Bridge.emit('account','refresh')
  else library:closeModal();library:command('close');announce('Home') end
end
startWipe=function(callback)
  if wipe then return false end
  state.pressed=nil;state.hovered=0;state.focused=0
  -- Clear held interactions so an old drag cannot move during the wipe.
  cancelInteractions()
  -- The wipe's card draws with dissolve, and it opens onto or away from the table.
  ensureShaders('background','dissolve','played')
  local colour=isTable(state.page) and simulator:backgroundColours()[2] or T.panel
  wipe=ScreenWipe.new(callback,colour,state.reduced,function(name,pitch,volume) sound(name,pitch,volume,true) end)
  wipe:layout(virtualWidth,virtualHeight,Screen.unit(width,height)/layoutScale,width/layoutScale,height/layoutScale)
  Bridge.emit('transition','open')
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
  local raw=Mailbox.read('viewport')
  if not raw then return end
  local limits=g.getSystemLimits and g.getSystemLimits()
  local view=Viewport.parse(raw,limits and limits.texturesize)
  if view and (width~=view.pixelWidth or height~=view.pixelHeight or density~=view.density) then
    -- At one device pixel per CSS pixel SDL keeps resizing the canvas itself, as before; a denser
    -- one is sized only from here, since SDL sizes a resizable canvas to its CSS size.
    love.window.setMode(view.pixelWidth,view.pixelHeight,{resizable=view.density==1,vsync=1})
    layout(view.pixelWidth,view.pixelHeight,view.density)
  end
  state.systemReduced=view~=nil and view.reduced
  if view and view.coarse~=(state.coarse or false) then state.coarse=view.coarse;Display.set({coarse=view.coarse});redraw() end
  loadMusic()
  local preferencesRaw=not state.preferencesLoaded and Mailbox.read('preferences')
  if preferencesRaw then
    preferences=Preferences.new(preferencesRaw)
    state.preferencesLoaded=true
    state.musicLevel=musicLevel()
    if state.musicLevel>0 then askForMusic('start') end
  end
  applyPreferences()
end
-- The page owns the route and asks for Settings; both are read every frame so a click lands on the
-- next one.
local function followPage()
  local pageRaw=Mailbox.read('page')
  if pageRaw and pageRaw~=state.pageRaw then
    state.pageRaw=pageRaw
    local fields=Codec.fields(pageRaw)
    requestPage(fields[2],fields[3])
  end
  local settingsRaw=Mailbox.read('settings')
  if settingsRaw and settingsRaw~=state.settingsRaw then
    state.settingsRaw=settingsRaw
    openSettings(true,Codec.fields(settingsRaw)[2])
  end
end
-- How long a page notice stays on screen.
local NOTICE_SECONDS=8
-- A line the page asks to show and say on any page, such as a game table whose code could not
-- load while the browser was offline. Each new revision is said again.
local function followNotice()
  local raw=Mailbox.read('notice')
  if not raw or raw==state.noticeRaw then return end
  state.noticeRaw=raw
  local message=Codec.fields(raw)[2] or ''
  state.notice=message~='' and {text=message,shownAt=state.time} or nil
  if state.notice then announce(message) end
end
-- Where home's keyboard focus sits in its ring. On 'last' the page lets the next Tab leave the
-- canvas for its links, on 'first' the next Shift+Tab (src/host/shell.ts tabLeaves); under a
-- popup, during a wipe, off home or with nothing focused Tab stays in the canvas.
local function focusEdge()
  if state.page~='home' or popup or covering() or state.focused==0 then return 'none' end
  if state.focused==#menu+#controls then return 'last' end
  return state.focused==1 and 'first' or 'none'
end
-- The edge's button label rides along, for the page to say when Tab brings focus back to it.
local function syncFocusEdge()
  local edge=focusEdge()
  local label=''
  if edge~='none' then
    local item=state.focused<=#menu and menu[state.focused] or controls[state.focused-#menu]
    label=item.label
  end
  if edge..label~=state.focusEdge then state.focusEdge=edge..label;Bridge.emit('focus-edge',edge,label) end
end
applyPreferences=function()
  -- A new Interface Size lays every layer out again, Settings too while it is open.
  if scene and preferences.interfaceSize~=state.interfaceSize then layout(width,height,density) end
  local reduced=preferences:reduced(state.systemReduced)
  if reduced~=state.reduced then redraw() end
  state.reduced=reduced
  state.muted=preferences.muted==1
  if sounds.music1 then
    sounds.music1:setVolume(0.32*preferences.volume/100*preferences.musicVolume/100)
    if not state.muted and state.audioUnlocked and state.windowFocused~=false then
      if not sounds.music1:isPlaying() then sounds.music1:play() end
    else sounds.music1:pause() end
  end
end
local function savePreferences()
  local level=musicLevel()
  if level>(state.musicLevel or 0) then askForMusic('change') end
  state.musicLevel=level
  applyPreferences()
  Bridge.emit('preferences',preferences:serialize())
end
closeSettings=function()
  Bridge.emit('auth','close')
  Bridge.emit('account','finish-edit')
  -- A keyboard close hands focus back to the home control that opened the popup; a pointer
  -- close leaves none.
  local opener=state.page=='home' and state.lastInput=='key' and state.settingsOpener or 0
  popup=nil; state.pressed=nil; state.focused=opener; state.hovered=0
  redraw()
  savePreferences()
  Bridge.emit('settings','closed')
  announce('Settings closed')
end
-- `opener`: the home control that asked; otherwise the one for the requested tab.
openSettings=function(keyboard,tab,opener)
  if popup or covering() then return end
  keyboard=keyboard or state.focused>0
  state.settingsOpener=opener or (tab=='account' and #menu+1 or #menu+2)
  state.pressed=nil; state.focused=0; state.hovered=0
  room.jiggle=room.jiggle+1
  redraw()
  popup=Settings.new(preferences,{
    changed=savePreferences,close=closeSettings,announce=announce,
    reduced=function() return state.reduced end,
    feedback=function() sound('button'); room.jiggle=room.jiggle+0.5 end,
    account=function(command) Bridge.send('account',withEditBox(command,'edit',popup)) end,
    auth=function(command) Bridge.send('auth',withEditBox(command,'edit',popup)) end,
  },state.reduced,keyboard,account)
  popup.tab=Settings.tabs[tab or 'game'] or Settings.tabs.game
  if keyboard then popup.focus=popup.tab end
  popup:layout(popupLayer.w,popupLayer.h)
  Bridge.emit('account','refresh')
  Bridge.emit('settings','open')
  announce('Settings. '..(popup.tab==Settings.tabs.account and 'Account' or 'Game')..' tab. Tab moves between controls. Escape closes.')
end
-- What every screen gets: its command channel, sound, announcements and the
-- sign-in popup (a no-op while a wipe blocks Settings). `extra` adds or overrides.
local function callbacksFor(channel,extra)
  local callbacks={
    command=function(command)
      local screen=({library=library,builder=builder,sandbox=sandbox,online=online})[channel]
      Bridge.send(channel,withEditBox(command,'input',screen))
    end,
    feedback=function(name,pitch,volume) sound(name,pitch,volume) end,
    announce=announce,
    signin=function() openSettings(false,'account'); if popup then popup:openAuth('login') end end,
  }
  for key,value in pairs(extra or {}) do callbacks[key]=value end
  return callbacks
end
local function activate(index)
  if index==0 then return end
  sound('button',1)
  room.jiggle=room.jiggle+0.5
  state.lastClicked={index=index,at=state.time}
  local item=index<=#menu and menu[index] or controls[index-#menu]
  if item.action=='sandbox' then Bridge.emit('simulator','resume')
  elseif item.action=='decks' then Bridge.emit('page','decks')
  elseif item.action=='online' then Bridge.emit('page','online')
  elseif item.action=='settings' then openSettings(nil,nil,index)
  elseif item.action=='account' then openSettings(false,'account',index) end
end
function love.load()
  g.setDefaultFilter('nearest','nearest')
  menuLogo=MenuLogo.new()
  state.handCursor=love.mouse.getSystemCursor('hand')
  state.arrowCursor=love.mouse.getSystemCursor('arrow')
  ensureShaders('splash','CRT')
  for _,name in ipairs(effects) do unloadedEffects[name]=true end
  local function refresh() Bridge.emit('account','refresh') end
  local function home() Bridge.emit('page','home') end
  local function settings() openSettings() end
  local function jiggle(amount) room.jiggle=room.jiggle+(amount or 1) end
  library=Library.new(callbacksFor('library',{refresh=refresh,home=home,settings=settings}))
  builder=Builder.new(callbacksFor('builder'))
  sandbox=Sandbox.new(callbacksFor('sandbox',{refresh=refresh,home=home,decks=function() Bridge.emit('page','decks') end}))
  online=Online.new(callbacksFor('online',{home=home,jiggle=jiggle}))
  simulator=Simulator.new(callbacksFor('simulator',{transition=function(callback) return startWipe(callback) end,
    sourceFeedback=function(name,pitch,volume) sound(name,pitch,volume,true) end,settings=settings,jiggle=jiggle}))
  screens={library,builder,sandbox,online,simulator}
  layout(g.getDimensions())
  Mailbox.poll()
  browserState()
  followPage()
  state.ready=true
end
function love.resize(w,h) if scene then layout(w,h,density) end end
function love.update(dt)
  -- The host hides its loading overlay on this signal, so it waits until a drawn frame is on the
  -- canvas: sent from love.load, the overlay went before the first draw and one black frame
  -- showed between the bar and the menu.
  if state.readySent then
    -- After ready, one deferred shader per update.
    local shader=nextShader()
    if shader then ensureShader(shader) end
  elseif state.drawn then state.readySent=true; Bridge.emit('ready') end
  if Mailbox.poll() then redraw() end
  local effect=next(unloadedEffects)
  if effect then loadEffect(effect) end
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
  followPage()
  followNotice()
  if state.notice and state.time-state.notice.shownAt>NOTICE_SECONDS then state.notice=nil end
  -- After this frame's key presses and page change, before the next Tab can arrive.
  syncFocusEdge()
  syncEditBox()
  local rawX,rawY=love.mouse.getPosition()
  room:update(dt,state.time,(rawX-offsetX)/layoutScale,(rawY-offsetY)/layoutScale,state.reduced,preferences.screenshake)
  -- Game:update applies canvas juice before advancing REAL/REAL_SHADER.
  state.time=state.time+dt
  menuLogo:update(dt,state.reduced)
  screen:update(state.time,offsetX+room.cursorX*layoutScale,offsetY+room.cursorY*layoutScale,state.reduced,preferences)
  if wipe then
    local covered=wipe.committed
    local done=wipe:update(dt)
    -- The destination is on screen, and takes input, from the frame the wipe commits.
    if wipe.committed and not covered then Bridge.emit('transition','closed') end
    if done then
      wipe:release();wipe=nil
      if pendingPage then requestPage(pendingPage.page,pendingPage.deckId) end
    end
  end
  local mx,my=pointer(love.mouse.getPosition())
  if covering() or (state.parked and not love.mouse.isDown(1)) then mx,my=-1000,-1000 end
  if isTable(state.page) then simulator:update(dt,state.time,popup and -1000 or mx,popup and -1000 or my,state.reduced) end
  if isCollection(state.page) then
    local lx,ly=libraryPoint(mx,my)
    collection():update(dt,state.time,popup and -1000 or lx,popup and -1000 or ly,state.reduced)
  end
  -- The lobby keeps polling under Settings (sign-in) and during a wipe.
  if state.page=='online' then
    local ox,oy=layerPoint(onlineLayer,mx,my)
    online:update(dt,state.time,popup and -1000 or ox,popup and -1000 or oy,state.reduced)
    -- A step that fits another size lays the lobby out again before it draws.
    if fitOnline(virtualWidth<virtualHeight) then online:layout(onlineLayer.w,onlineLayer.h) end
  end
  if covering() then love.mouse.setCursor(state.arrowCursor);return end
  -- An account asked to choose its public name hears it on the home menu or before an online
  -- lobby, where the name is shown to others; Settings reads the account itself while open.
  if not popup and (state.page=='home' or state.page=='online') then
    local accountRaw=Mailbox.read('account')
    if accountRaw then account:sync(accountRaw) end
    if account:shouldPrompt() then
      openSettings(false,'account')
      if popup then popup:openNamePrompt(true) end
    end
  end
  if popup then
    local accountRaw=Mailbox.read('account')
    if accountRaw then
      if account:sync(accountRaw) then
        popup:accountChanged()
        if popup.tab==Settings.tabs.account and account.fresh then announce(account.message) end
      end
    end
    account:input(Mailbox.read('accountInput'))
    -- Tab or Enter in a native sign-in field moves focus as a key press would.
    if popup:authInput(Mailbox.read('authInput')) then parkPointer() end
    local px,py=layerPoint(popupLayer,mx,my)
    popup:update(dt,state.time,px,py,state.reduced)
    love.mouse.setCursor(popup.hover>0 and state.handCursor or state.arrowCursor)
    return
  end
  if isCollection(state.page) then
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
end
local function button(b,index)
  local active=Controls.lit(state.hovered,state.focused,index)
  local clicked=state.lastClicked and state.lastClicked.index==index and state.time-state.lastClicked.at<0.1
  local pressed=(state.pressed==index and state.hovered==index) or clicked
  Button.draw(b,active,pressed,state.focused==index,homeLayer.w)
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
  local layer=isTable(state.page) and tableLayer or homeLayer
  g.push(); applyLayer(layer)
  if isTable(state.page) then simulator:draw(shaders) else
  -- Like Game:main_menu's SPLASH_LOGO, the lettering is a painted sprite.
  -- Draw inside the room/CRT pass so scanlines and fringing stay live.
  local logoWidth=menuLogo:getDimensions()
  local logoScale=homeLogo.width/logoWidth
  g.push(); g.translate(homeLayer.w/2,homeLogo.y)
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
  T.text('Colorless',19,24,homeLayer.h-33,160,T.paper,'left')
  T.text('Home',19,homeLayer.w-130,homeLayer.h-33,106,T.paper,'right')
  end
  -- Text only, in the gap under the home menu or across the table's top edge, never under 12
  -- CSS pixels. Where the gap cannot hold it that large, home shows it above the logo.
  if state.notice then
    local size=math.max(16,math.ceil(12*density/layoutScale))
    -- Interface Size enlarges it where its layer does not.
    size=math.floor(size*interfaceStep()/layer.scale+0.5)
    local y=isTable(state.page) and 16 or menuTray.y+menuTray.h+4
    if not isTable(state.page) and y+size+4>controls[1].y-12 then y=24 end
    Button.errorLine(state.notice.text,size,24,y,layer.w-48)
  end
  g.pop()
  g.pop()
  if isCollection(state.page) then
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
    g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale); room:apply(); applyLayer(onlineLayer)
    online:draw()
    g.pop()
  end
  if popup then
    Modal.backdrop(width,height)
    g.push(); g.translate(offsetX,offsetY); g.scale(layoutScale); room:apply(); applyLayer(popupLayer)
    popup:draw()
    g.pop()
  end
  if wipe then
    g.push();g.translate(offsetX,offsetY);g.scale(layoutScale);room:apply()
    wipe:draw(shaders,isTable(state.page) and simulator:backgroundColours()[2] or T.panel);g.pop()
  end
  g.setCanvas()
  screen:draw(scene)
  state.drawn=true
end
-- True when this frame would repeat the last one exactly, so love.run may skip drawing it. Only
-- home and its Settings under reduced motion qualify: with motion on the vortex and CRT noise
-- move every frame, and the other pages do not report stillness yet, so they always draw. A
-- notice, a click's flash, a wipe or Settings with anything moving (Settings:still) draws.
local function still()
  if not state.drawn or wipe or not state.reduced or state.page~='home' or state.notice then return false end
  if state.time<(state.redrawUntil or 0) then return false end
  if state.lastClicked and state.time-state.lastClicked.at<0.1 then return false end
  return not popup or popup:still()
end
-- LÖVE 11.4's default love.run, changed in three ways (audit LC1). A pacer runs update and draw at
-- most frameCap() times a second however fast the display refreshes, while events are pumped on
-- every animation frame. The redraw gate skips draw and present while still() holds, after
-- drawing the first still frame (its update may have changed the picture) and then once every
-- BACKSTOP_SECONDS; WebGL keeps showing the last presented frame through an animation frame that
-- makes no GL calls. Any event asks for a redraw. And there is no love.timer.sleep(0.001):
-- love.js runs this function once per requestAnimationFrame, and its sleep busy-waits.
function love.run()
  if love.load then love.load(love.arg and love.arg.parseGameArguments(arg),arg) end
  if love.timer then love.timer.step() end
  local pacer=Pacer.new()
  local last=love.timer.getTime()
  local wasStill,drawnAt=false,-math.huge
  return function()
    if love.event then
      love.event.pump()
      for name,a,b,c,d,e,f in love.event.poll() do
        if name=='quit' then
          if not love.quit or not love.quit() then return a or 0 end
        end
        love.handlers[name](a,b,c,d,e,f)
        redraw()
      end
    end
    local now=love.timer.getTime()
    local elapsed=now-last
    last=now
    if not pacer:due(elapsed,frameCap()) then return end
    if love.update then love.update(love.timer.step()) end
    if love.graphics and love.graphics.isActive() then
      local static=still()
      if not static or not wasStill or state.time-drawnAt>=BACKSTOP_SECONDS then
        drawnAt=state.time
        love.graphics.origin()
        love.graphics.clear(love.graphics.getBackgroundColor())
        if love.draw then love.draw() end
        love.graphics.present()
      end
      wasStill=static
    end
  end
end
local function unlockAudio()
  state.audioUnlocked=true
  applyPreferences()
end
-- Hover follows the pointer only while it is over the canvas and has moved since the last key
-- press or lifted finger. Parked, it reads as off-canvas until the next mousemoved, so a key
-- press hands the highlight to keyboard focus and a tap leaves nothing highlighted.
parkPointer=function()
  state.parked=true; state.hovered=0
end
function love.mousemoved(_,_,dx,dy)
  if dx~=0 or dy~=0 then state.parked=false end
end
function love.mousefocus(focused)
  if not focused then parkPointer() end
end
function love.touchreleased() parkPointer() end
function love.mousepressed(x,y,button)
  if button~=1 or covering() then return end
  state.parked=false; state.lastInput='pointer'
  unlockAudio(); state.focused=0
  x,y=pointer(x,y)
  if popup then popup:mousepressed(layerPoint(popupLayer,x,y)); return end
  if isTable(state.page) then simulator:mousepressed(x,y);return end
  if state.page=='online' then online:mousepressed(layerPoint(onlineLayer,x,y));return end
  if isCollection(state.page) then collection():mousepressed(libraryPoint(x,y)); return end
  state.pressed=hit(x,y)
end
function love.mousereleased(x,y,button,istouch)
  if button~=1 or covering() then return end
  if istouch then parkPointer() end
  x,y=pointer(x,y)
  if popup then popup:mousereleased(layerPoint(popupLayer,x,y)); return end
  if isTable(state.page) then simulator:mousereleased(x,y);return end
  if state.page=='online' then online:mousereleased(layerPoint(onlineLayer,x,y));return end
  if isCollection(state.page) then collection():mousereleased(libraryPoint(x,y)); return end
  if state.pressed and state.pressed==hit(x,y) then activate(state.pressed) end
  state.pressed=nil
end
function love.keypressed(key)
  if covering() then return end
  state.lastInput='key'
  if not love.mouse.isDown(1) then parkPointer() end
  unlockAudio()
  if popup then popup:keypressed(key); return end
  if isTable(state.page) then simulator:keypressed(key);return end
  if state.page=='online' then online:keypressed(key);return end
  if isCollection(state.page) then collection():keypressed(key); return end
  if key=='tab' or key=='right' or key=='down' or key=='left' or key=='up' then
    -- Tab keeps the ring's order; arrows move by layout (audit PG14).
    local ring={}
    for _,b in ipairs(menu) do ring[#ring+1]=b end
    for _,b in ipairs(controls) do ring[#ring+1]=b end
    local found
    state.focused,found=Controls.move(state.focused,key,ring,function() return false end)
    if found then announce(ring[state.focused].label) end
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
  if popup then popup:cancelInteractions() end
  for _,screen in ipairs(screens) do screen:cancelInteractions() end
end
function love.focus(focused)
  state.windowFocused=focused
  if not focused then
    cancelInteractions()
  end
  applyPreferences()
end

function love.wheelmoved(x,y)
  if covering() then return end
  if isTable(state.page) and not popup then simulator:wheelmoved(y);return end
  if state.page=='online' and not popup then online:wheelmoved(y);return end
  if isCollection(state.page) and not popup then collection():wheelmoved(y) end
end
