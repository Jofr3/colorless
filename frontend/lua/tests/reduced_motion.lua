-- Reduced motion lives in the primitives: Button.chosen's marker, DynaText's
-- pop-in and pop-out, and the attention text's backdrop stop moving when
-- asked, and every page's frame under reduced motion repeats at any time. With
-- motion on, each primitive draws exactly what its formula gives.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local g=Stub.graphics
local T=require('ui.theme')
local Button=require('ui.button')
local Dyna=require('ui.dynatext')
local Fx=require('ui.fx')
local function check(ok,message) if not ok then error(message,2) end end
local function noop() end

-- Every geometry, colour and text call, with its arguments, while `log` is set.
local log
local function num(v) return type(v)=='number' and ('%.17g'):format(v) or tostring(v) end
for _,name in ipairs({'polygon','rectangle','print','translate','rotate','scale','setColor','push','pop','line','circle'}) do
  rawset(g,name,function(...)
    if log then
      local parts={name}
      for i=1,select('#',...) do
        local v=select(i,...)
        if type(v)=='table' then
          local inner={}
          for k=1,#v do inner[k]=num(v[k]) end
          parts[#parts+1]='{'..table.concat(inner,',')..'}'
        else parts[#parts+1]=num(v) end
      end
      log[#log+1]=table.concat(parts,' ')
    end
  end)
end
local function trace(draw) log={};draw();local out=table.concat(log,'\n');log=nil;return out end

-- Button.chosen: the marker drawn by today's formula, which bobs with sin(time*9).
local function marker(b,time,pressed,roomWidth)
  local sx=((b.x+b.w/2-roomWidth/2)/(roomWidth/2))*1.5
  local sy=-1.5
  local distance=pressed and 0 or 1.5
  local layer=0.4-(pressed and 1.5 or 0)
  local lx,ly=layer*sx/20,layer*sy/20
  local bob=math.min(1.2*math.sin(time*9)+0.2,0)*3
  local function triangle(scale,shadow)
    g.push()
    g.translate(b.x+b.w/2+lx*60,b.y+b.h/2+ly*60)
    g.scale(scale)
    local x=lx*3-(shadow and sx*distance*0.5*3 or 0)
    local y=-b.h/2+ly*3+bob-(shadow and sy*distance*0.5*3 or 0)
    g.polygon('fill',x-9,y-24,x,y-6.6,x+9,y-24)
    g.pop()
  end
  g.setColor(0,0,0,0.3); triangle(0.98,true)
  g.setColor(T.red); triangle(1,false)
end
local REST=12 -- sin(108) > -1/6: the bob is 0, the pose the marker rests at
check(math.min(1.2*math.sin(REST*9)+0.2,0)==0,'The rest time has no bob')
local tab={x=300,y=120,w=160,h=48}
local rest=trace(function() marker(tab,REST,false,1280) end)
local moved=0
for step=0,400 do
  local time=step*0.0137
  for _,pressed in ipairs({false,true}) do
    local expected=trace(function() marker(tab,time,pressed,1280) end)
    check(trace(function() Button.chosen(tab,time,pressed,1280) end)==expected,'Motion on: the marker draws as before at '..time)
    check(trace(function() Button.chosen(tab,time,pressed,1280,false) end)==expected,'reduced=false is motion on')
    local still=trace(function() Button.chosen(tab,time,pressed,1280,true) end)
    check(still==trace(function() marker(tab,REST,pressed,1280) end),'Reduced motion: the marker rests at its offset at '..time)
    if not pressed and expected~=rest then moved=moved+1 end
  end
end
check(moved>50,'With motion on the marker bobs')
print('PASS: Button.chosen bobs as before with motion on and rests at its offset under reduced motion')

-- DynaText: pop-in and pop-out are skipped under reduced motion; letters stay whole.
local function pops(d) local out={} for k,l in ipairs(d.letters) do out[k]=l.pop end return out end
local function whole(d) for _,l in ipairs(d.letters) do if l.pop~=1 then return false end end return true end
local d=Dyna.new({string='HELLO',pop_in=0,pop_in_rate=6,float=true,time=5})
d:update(5,true)
check(whole(d) and d.popIn==nil,'Reduced motion: a pop-in text shows whole at once and its pop-in is done')
d:update(5.01,false)
check(whole(d),'A pop-in skipped under reduced motion does not restart when motion returns')
d:set('WORLD',6);d:update(6,true)
check(whole(d),'Reduced motion: a changed string shows whole at once')
d:pop_out(3,7);d:update(7.2,true)
check(whole(d),'Reduced motion: pop-out does not shrink the letters')
local on=Dyna.new({string='HELLO',pop_in=0,pop_in_rate=6,float=true,time=5})
for step=0,30 do
  local time=5+step*0.01
  on:update(time,false)
  for k,pop in ipairs(pops(on)) do
    local p=math.min(1,math.max((time-5)*5*6-k+1,0))
    if on.popIn or p*p==1 then check(pop==p*p,'Motion on: letter '..k..' pops in as before at '..time) end
  end
end
on:pop_out(3,8);on:update(8.2,false)
for _,pop in ipairs(pops(on)) do local p=math.min(1,math.max(1-(8.2-8)*3,0));check(pop==p*p,'Motion on: pop-out shrinks as before') end
print('PASS: DynaText pops in and out as before with motion on and shows whole under reduced motion')

-- Attention text: the backdrop square grows from the centre and spins with motion on;
-- under reduced motion it holds one pose, and the frame repeats while the text holds.
local function attention(reduced,start)
  local fx=Fx.new({feedback=noop,jiggle=noop})
  fx:update(0,start,reduced,false)
  local at=fx:attention({text='KNOCKED OUT',scale=0.75,colour=T.white,backdrop=T.red,x=300,y=200,hold=2})
  return fx,at
end
local function backdrop(fx,time,reduced)
  fx:update(1/60,time,reduced,false)
  local out=trace(function() fx:draw(1280) end)
  local angle=tonumber(out:match('rotate ([^\n]+)'))
  local size=tonumber(out:match('rectangle fill %S+ %S+ ([^ \n]+)'))
  return out,angle,size
end
local fx,at=attention(false,3)
for step=1,40 do
  local time=3+step*0.05
  local _,angle,size=backdrop(fx,time,false)
  local age=time-at.start
  check(angle==at.rotation+age*0.1,'Motion on: the backdrop spins as before')
  check(size==math.min(2*(age/5)*2.4,2.4)*60*(at.text.scale or 1)*0.7,'Motion on: the backdrop grows as before')
end
-- Under reduced motion the backdrop holds the pose motion on reaches when the text's hold
-- ends (age at.hold): the largest pose a motion-on player sees, smaller than the full square.
local function held(at)
  return at.rotation+at.hold*0.1,math.min(2*(at.hold/5)*2.4,2.4)*60*(at.text.scale or 1)*0.7
end
fx,at=attention(true,3)
local heldAngle,heldSize=held(at)
check(heldSize<2.4*60*(at.text.scale or 1)*0.7,'The hold-end pose is smaller than the full square')
local first
for step=1,40 do
  local time=3+step*0.05
  local out,angle,size=backdrop(fx,time,true)
  check(angle==heldAngle,'Reduced motion: the backdrop holds the tilt motion on reaches as the hold ends')
  check(size==heldSize,'Reduced motion: the backdrop holds the size motion on reaches as the hold ends')
  first=first or out
  check(out==first,'Reduced motion: the held attention text draws the same frame at '..time)
end
local fading=0
for step=1,5 do
  local _,angle,size=backdrop(fx,3+at.hold+step*0.05,true)
  if size then
    fading=fading+1
    check(angle==heldAngle and size==heldSize,'Reduced motion: the fading backdrop keeps the hold-end pose')
  end
end
check(fading>0,'The backdrop is drawn while it fades')
print('PASS: the attention backdrop grows and spins as before with motion on and holds its hold-end pose under reduced motion')

-- Pages: under reduced motion a frame repeats at any time (main.lua's redraw gate relies on it
-- for Settings); with motion on the tab markers still bob, so callers pass the real time.
local function fixture(name)
  local f=assert(io.open('frontend/lua/tests/fixtures/'..name,'rb'))
  local raw=f:read('*a');f:close()
  return (raw:gsub('\n$',''))
end
local function markers(draw)
  local chosen=Button.chosen
  local out={}
  Button.chosen=function(...)
    local args={...}
    out[#out+1]=trace(function() chosen(unpack(args)) end)
  end
  draw()
  Button.chosen=chosen
  check(#out>0,'The page draws a chosen marker')
  return table.concat(out,'\n')
end
local function pageCheck(label,update,draw)
  update(REST,true);local restFrame=trace(draw)
  update(20,true);local later=trace(draw)
  check(later==restFrame,label..': reduced motion draws the same frame at any time')
  update(REST,true);local restMarker=markers(draw)
  update(20,true);check(markers(draw)==restMarker,label..': reduced motion keeps the marker at rest')
  update(REST,false);local onRest=markers(draw)
  check(onRest==restMarker,label..': the reduced marker is the motion-on rest pose')
  update(20,false);check(markers(draw)~=onRest,label..': with motion on the marker bobs')
end

local Settings=require('ui.settings')
local Preferences=require('ui.preferences')
local Account=require('ui.account')
local account=Account.new();check(account:sync(fixture('account_snapshot.txt')),'Account snapshot accepted')
local settings=Settings.new(Preferences.new(),{changed=noop,close=noop,announce=noop,feedback=noop,account=noop,auth=noop,
  reduced=function() return true end},true,false,account)
settings:layout(1280,800)
local function settingsUpdate(time,reduced) settings:update(0,time,-1000,-1000,reduced) end
for tab=1,4 do
  settings.tab=tab;settings:build()
  pageCheck('Settings tab '..tab,settingsUpdate,function() settings:draw() end)
end
-- The name field's caret holds steady under reduced motion, as the redraw gate skips frames.
settings.tab=4;settings:build();account.editing=true
settingsUpdate(20,true);local caret=trace(function() settings:draw() end)
settingsUpdate(20.5,true);check(trace(function() settings:draw() end)==caret,'Settings: the caret holds under reduced motion')
settingsUpdate(20,false);local blinkOn=trace(function() settings:draw() end)
settingsUpdate(20.5,false);check(trace(function() settings:draw() end)~=blinkOn,'Settings: the caret blinks with motion on')
account.editing=false
settings:openAuth('login')
pageCheck('Sign-in form',settingsUpdate,function() settings:draw() end)
print('PASS: Settings repeats its frame under reduced motion, its markers rest and bob as before with motion on')

local Sandbox=require('ui.sandbox')
local sandbox=Sandbox.new({command=noop,announce=noop,feedback=noop,home=noop})
sandbox:layout(1280,800);sandbox:sync(fixture('sandbox_snapshot.txt'));sandbox:layout(1280,800);sandbox:open(true)
pageCheck('Sandbox',function(time,reduced) sandbox:update(0,time,-1000,-1000,reduced) end,function() sandbox:draw() end)
print('PASS: the sandbox tab marker rests under reduced motion and bobs as before with motion on')

local Online=require('ui.online')
local Codec=require('ui.codec')
local W=require('ui.wire_fields').online
local online=Online.new({command=noop,announce=noop,feedback=noop,jiggle=noop,home=noop,signin=noop})
online:open(true,'');online:layout(1280,800)
local header={}
for _,column in pairs(W.header) do header[column]='' end
for name,value in pairs({revision=1,step='menu',busy=0,code='',role='',link='connected',deckPhase='idle',name='Ash',account='authenticated'}) do
  header[W.header[name]]=Codec.encode(value)
end
online:sync(table.concat(header,'\t'))
pageCheck('Online',function(time,reduced) online:update(0,time,-1000,-1000,reduced) end,function() online:draw() end)
print('PASS: the online tab marker rests under reduced motion and bobs as before with motion on')

local Builder=require('ui.builder')
local builder=Builder.new({command=noop,announce=noop,feedback=noop})
builder:layout(1280,800);builder:sync(fixture('builder_snapshot.txt'));builder:layout(1280,800)
local function builderDraw() builder:drawControlFaces(builder.controls,true) end
local function builderUpdate(time,reduced) builder:update(0,time,-1000,-1000,reduced) end
pageCheck('Builder deck types',builderUpdate,builderDraw)
builder:openModal('filters')
pageCheck('Builder filters',builderUpdate,builderDraw)
print('PASS: the builder deck-type and filter-tab markers rest under reduced motion and bob as before with motion on')
