-- Keyboard focus draws with each control's own hover look, and one control looks
-- active at a time: the pointer's control wins, focus shows while it is over none.
-- A keyboard-focused card keeps its ambient tilt, and page errors use the ink
-- error line.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local T=require('ui.theme')
local Button=require('ui.button')
local Input=require('ui.text_input')
local DeckRow=require('ui.deck_row')
local Popup=require('ui.popup')
local Codec=require('ui.codec')
local function check(ok,message) if not ok then error(message,2) end end
local function noop() end

-- Every call that carries a hover look, with the arguments that decide it.
local trace
local function serialise(v)
  if type(v)=='table' then
    if type(v[1])=='number' then return ('rgba(%.4f,%.4f,%.4f,%.4f)'):format(v[1],v[2],v[3],v[4] or 1) end
    return tostring(v.label)..'@'..tostring(v.x)..','..tostring(v.y)
  end
  return tostring(v)
end
local function wrap(module,name,keep)
  local original=module[name]
  module[name]=function(...)
    if trace then
      local args,parts={...},{name}
      for _,i in ipairs(keep) do parts[#parts+1]=serialise(args[i]) end
      trace[#trace+1]=table.concat(parts,' ')
    end
    return original(...)
  end
end
wrap(Button,'panel',{1,2,3,4,5})
wrap(Button,'draw',{1,2,3})
wrap(Button,'slider',{1,2,6})
wrap(Button,'cycleFace',{1,2,5})
wrap(Input,'background',{1,2,3,4})
wrap(DeckRow,'draw',{1,2})
wrap(DeckRow,'action',{1,2,3})
wrap(Popup,'action',{1,2,3})
local function drawn(screen,hover,focus,draw)
  screen.hover,screen.focus=hover,focus
  trace={};draw();local out=table.concat(trace,'\n');trace=nil
  return out
end
-- For each control i: focus alone draws exactly as hover alone, and differs
-- from neither; with the pointer on another control, focus adds nothing.
local function focusLooksLikeHover(label,screen,count,draw,skip)
  local rest=drawn(screen,0,0,draw)
  local seen=0
  for i=1,count do
    if not (skip and skip(i)) then
      local hovered,focused=drawn(screen,i,0,draw),drawn(screen,0,i,draw)
      check(focused==hovered,label..' control '..i..': keyboard focus must draw its hover look')
      check(focused~=rest,label..' control '..i..': keyboard focus must be visible')
      local other=i==1 and 2 or 1
      check(drawn(screen,other,i,draw)==drawn(screen,other,0,draw),label..' control '..i..': stale hover and focus must not both look active')
      seen=seen+1
    end
  end
  check(seen>0,label..': no control checked')
  return seen
end

-- Settings: every tab, the account tab signed in, and the sign-in form.
local Settings=require('ui.settings')
local Preferences=require('ui.preferences')
local Account=require('ui.account')
local function fixture(name)
  local f=assert(io.open('frontend/lua/tests/fixtures/'..name,'rb'))
  local raw=f:read('*a');f:close()
  return (raw:gsub('\n$',''))
end
local account=Account.new();check(account:sync(fixture('account_snapshot.txt')),'Account snapshot accepted')
local prefs=Preferences.new()
local settings=Settings.new(prefs,{changed=noop,close=noop,announce=noop,feedback=noop,account=noop,auth=noop,
  reduced=function() return false end},true,false,account)
settings:layout(1280,800)
local function settingsDraw() settings:draw() end
local function settingsSkip(i)
  local item=settings.items[i]
  -- A cycle's focus lights both arrows; its hover lights one part.
  return item.kind=='cycle' or settings:disabled(item)
end
local kinds={}
for tab=1,4 do
  settings.tab=tab;settings:build()
  for _,item in ipairs(settings.items) do kinds[item.kind]=true end
  focusLooksLikeHover('Settings tab '..tab,settings,#settings.items,settingsDraw,settingsSkip)
end
check(kinds.slider and kinds.toggle and kinds.name and kinds.action and kinds.back,'Settings covers sliders, toggles, the name field and buttons')
settings.tab=2;settings:build()
for i,item in ipairs(settings.items) do
  if item.kind=='cycle' then
    local trail=drawn(settings,0,i,settingsDraw)
    check(select(2,trail:gsub('draw [<>]@[%d.]+,[%d.]+ true',''))==2,'A focused cycle lights both arrows')
  end
end
settings:openAuth('login')
local fields=0
for _,item in ipairs(settings.items) do if item.kind=='auth-field' then fields=fields+1 end end
check(fields==2,'Sign-in form has its two fields')
focusLooksLikeHover('Sign-in form',settings,#settings.items,settingsDraw)
-- The native field's Tab and Enter move focus, so main parks the pointer for them.
check(settings:authInput('1\temail\ta\t\t\t1\t1\tinput\temail')==false,'Typing in a sign-in field is not focus movement')
check(settings:authInput('2\temail\ta\t\t\t1\t1\tnext\temail')==true,'Tab in a sign-in field moves keyboard focus')
print('PASS: Settings sliders, toggles, fields and buttons show keyboard focus with their hover look, one at a time')

-- Library: the search field and every button.
local Card=require('ui.card')
local Library=require('ui.library')
local library=Library.new({command=noop,announce=noop,feedback=noop})
library:layout(1280,800);library:sync(fixture('library_snapshot.txt'));library:layout(1280,800)
local libraryCount=0
for _,b in ipairs(library.controls) do if b.action~='card' then libraryCount=libraryCount+1 end end
focusLooksLikeHover('Library',library,#library.controls,function() library:draw({}) end,function(i)
  local b=library.controls[i];return b.action=='card' or b.disabled
end)
local search
for _,b in ipairs(library.controls) do if b.input then search=b end end
check(search,'Library has its search field')
print('PASS: library search and buttons show keyboard focus with their hover look')

-- Builder: catalog page controls, then the filters' HP sliders and text field.
local Builder=require('ui.builder')
local builder=Builder.new({command=noop,announce=noop,feedback=noop})
builder:layout(1280,800);builder:sync(fixture('builder_snapshot.txt'));builder:layout(1280,800)
local function builderSkip(i)
  local b=builder.controls[i];return b.disabled or b.inert or b.action=='card' or b.action=='deck-card'
end
local function builderDraw() builder:drawControlFaces(builder.controls,true) end
focusLooksLikeHover('Builder',builder,#builder.controls,builderDraw,builderSkip)
builder.filterPage=3;builder:openModal('filters')
local hp=0
for _,b in ipairs(builder.controls) do if b.action=='hp-slider' then hp=hp+1 end end
check(hp==2,'Builder filters show both HP sliders')
focusLooksLikeHover('Builder filters',builder,#builder.controls,builderDraw,builderSkip)
builder:closeModal()
print('PASS: builder buttons, rows, fields and HP sliders show keyboard focus with their hover look')

-- Online: the join tab's code field and buttons.
local Online=require('ui.online')
local W=require('ui.wire_fields').online
local online=Online.new({command=noop,announce=noop,feedback=noop,jiggle=noop,home=noop,signin=noop})
online:open(true,'')
online:layout(1280,800)
local header={}
for _,column in pairs(W.header) do header[column]='' end
for name,value in pairs({revision=1,step='menu',busy=0,code='',role='',link='connected',deckPhase='idle',name='Ash',account='authenticated',canKick=0}) do
  header[W.header[name]]=Codec.encode(value)
end
online:sync(table.concat(header,'\t'))
for i,item in ipairs(online.items) do if item.kind=='tab' and item.tab==2 then online:activate(i) end end
local code
for _,item in ipairs(online.items) do if item.field=='code' then code=item end end
check(code,'Online join tab has the code field')
online:update(0,20,-1000,-1000,true)
focusLooksLikeHover('Online',online,#online.items,function() online:draw() end,function(i)
  local item=online.items[i];return item.disabled or item.kind=='card'
end)
print('PASS: online code field and buttons show keyboard focus with their hover look')

-- Sandbox: buttons and the search field.
local Sandbox=require('ui.sandbox')
local sandbox=Sandbox.new({command=noop,announce=noop,feedback=noop,home=noop})
sandbox:layout(1280,800);sandbox:sync(fixture('sandbox_snapshot.txt'));sandbox:layout(1280,800)
focusLooksLikeHover('Sandbox',sandbox,#sandbox.controls,function() sandbox:draw() end,function(i)
  local b=sandbox.controls[i];return b.disabled or b.card
end)
print('PASS: sandbox buttons and search show keyboard focus with their hover look')

-- A card active through keyboard focus keeps its ambient tilt: its shader
-- values do not depend on where the pointer is.
local function shaderKey(card,mx,my)
  local v,edition=card:shaderValues(20,mx,my,false)
  return ('%.6f %.6f %.6f'):format(v.mouse_screen_pos[1],v.mouse_screen_pos[2],edition[1])
end
local card=Card.new({colour=T.red,label='Test',edition='dissolve'},1)
card:place(400,300,1,false)
card:update(0,20,false,false)
local idle=shaderKey(card,400,300)
card:update(0,20,true,false,true)
check(shaderKey(card,400,300)==shaderKey(card,-1000,-1000) and shaderKey(card,900,700)==idle,'A focused card must not tilt toward the pointer')
card:update(0,20,true,false,false)
check(shaderKey(card,400,300)~=shaderKey(card,900,700),'A hovered card still tilts toward the pointer')
check(shaderKey(card,900,700)~=idle,'Hover tilt differs from the ambient tilt')

-- The pages pass that flag: builder catalog and deck cards, and the table.
local function cardControl(screen,field)
  for i,b in ipairs(screen.controls) do if b[field] then return i,b[field] end end
end
local function settle(screen,mx,my) for _=1,3 do screen:update(1/60,20,mx,my,false) end end
local index,which=cardControl(builder,'card')
check(index,'Builder catalog shows a card')
builder.focus=index;settle(builder,-1000,-1000)
check(builder.cards[which].hovered and builder.cards[which].focused,'A focused catalog card is active through focus')
local c=builder.cards[which]
settle(builder,c.x,c.y)
check(builder.cards[which].hovered and not builder.cards[which].focused,'A pointed catalog card tilts toward the pointer')
builder.deckView='cards';builder:build()
index,which=cardControl(builder,'deckCard')
check(index,'Builder deck view shows a card')
builder.focus=index;settle(builder,-1000,-1000)
check(builder.deckCards[which].hovered and builder.deckCards[which].focused,'A focused deck card is active through focus')

local Snapshots=require('support.snapshots')
local Simulator=require('ui.simulator')
local sim=Simulator.new({command=noop,announce=noop,feedback=noop,settings=noop,jiggle=noop})
sim:layout(1280,800);sim:open(true)
Stub.files[require('ui.host_constants').mailboxes.simulator]=Snapshots.snapshot({revision=1})
settle(sim,-1000,-1000)
local target
for _,x in ipairs(sim.cards) do if x.item.zone=='hand' then target=x;break end end
check(target,'The table deals a hand')
sim.focusCard=target;settle(sim,-1000,-1000)
check(target.hovered and target.focused,'The focused table card is active through focus')
print('PASS: keyboard-focused cards keep the ambient tilt in the builder grid, deck view and table')

sim.focusCard=nil
local shader=Stub.shader()
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader}
local tableButtons=focusLooksLikeHover('Table',sim,#sim.controls,function() sim:draw(shaders) end,function(i)
  local b=sim.controls[i];return b.disabled or b.invisible
end)
check(tableButtons>=3,'The table shows its buttons')
sim.focus=1;sim.hover=0;sim.hoverCard=sim.cards[1]
trace={};sim:draw(shaders);local pointedCard=table.concat(trace,'\n')
sim.focus=0;trace={};sim:draw(shaders);check(table.concat(trace,'\n')==pointedCard,'A pointed table card hides keyboard focus on a button')
trace=nil;sim.hoverCard=nil
print('PASS: table buttons show keyboard focus with their hover look, one at a time')

-- Page errors go through the ink error line.
local lines={}
local errorLine=Button.errorLine
Button.errorLine=function(text,...) lines[#lines+1]=text;return errorLine(text,...) end
library.message='Could not save';library:draw({})
check(lines[#lines]=='Could not save','Library error uses the error line')
library.modal={mode='rename',item=library.items[1],motion=require('ui.modal').motion(true)};library:build()
library.message='Name taken';library.busy=false;library:drawModal()
check(lines[#lines]=='Name taken','Library dialog error uses the error line')
library.modal=nil;library:build()
online.message='Lobby not found';online:draw()
check(lines[#lines]=='Lobby not found','Online error uses the error line')
sandbox.message='Choose two decks';sandbox:draw()
check(lines[#lines]=='Choose two decks','Sandbox hint uses the error line')
Button.errorLine=errorLine
trace={};Button.errorLine('Oops',20,100,200,300)
check(trace[1] and trace[1]:match('^panel ') and trace[1]:find(serialise(T.ink),1,true),'The error line sits on an ink pill')
trace=nil
print('PASS: library, online and sandbox errors use the ink error line')
