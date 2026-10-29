-- Headless checks for what the table says and pops per snapshot: the host's
-- announcement once, never the static title again; a refusal's banner, sound
-- and speech once per serial; a standing warning drawn without the pop; the
-- online waiting title and hint; and an online action in flight disabling the
-- buttons and saying "Sending..." after a second.
package.path='frontend/lua/?.lua;'..package.path
local function font()
  return {getWidth=function(_,s) return #tostring(s)*8 end,getHeight=function() return 20 end,
    getWrap=function(_,s) return #s*8,{s} end}
end
local image={setFilter=function() end,getWidth=function() return 284 end,getHeight=function() return 380 end,getDimensions=function() return 284,380 end,release=function() end}
local g=setmetatable({
  transformPoint=function(x,y) return x,y end,
  newImage=function() return image end,newQuad=function() return {} end,
  newCanvas=function() return {release=function() end,setFilter=function() end} end,
  newFont=function() return font() end,
},{__index=function() return function() end end})
love={math={random=function() return 0.5 end},graphics=g,keyboard={isDown=function() return false end},filesystem={getInfo=function() return nil end,read=function() return '' end}}
local T=require('ui.theme');T.font=function() return font() end
local Card=require('ui.card');Card.rebuild=function(self) self.texture={release=function() end} end
local Dyna=require('ui.dynatext')
local W=require('ui.wire_fields').sim
local Simulator=require('ui.simulator')
local shader={hasUniform=function() return true end,send=function() end}
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader}
local said,sounds={},{}
local sim=Simulator.new({command=function() end,announce=function(t) said[#said+1]=t end,
  feedback=function(name) sounds[#sounds+1]=name end,settings=function() end,jiggle=function() end})
local function check(ok,message) if not ok then error(message,2) end end
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
local function tagged(kind,tag,values)
  local f={tag}
  for name,column in pairs(kind) do f[column]=values[name] or '' end
  for i=1,#f do f[i]=enc(f[i] or '') end
  return table.concat(f,'\t')
end
local revision=0
-- opts: header fields by name, plus flags (the L row's) and mode.
local function snapshot(opts)
  opts=opts or {};revision=revision+1
  local h={revision=revision,phase='ready',you='Ash',opponent='Misty',turn=3,gamePhase='turn:action',title='Your turn',
    hint='Attach Energy, then attack.',waitingOn='you',activePlayer='you',seat='p1',matchId='ABCD:1',messageSerial='0'}
  for k,v in pairs(opts) do if W.header[k] then h[k]=v end end
  local f={}
  for name,column in pairs(W.header) do f[column]=enc(h[name] or '') end
  local out={table.concat(f,'\t'),
    tagged(W.lifecycle,'L',{mode=opts.mode or 'online',spectating='false',flags=opts.flags or 'concede,leave',allow='full'}),
    row('S','you',46,6,2,0,0),row('S','opponent',47,6,7,1,0),
    row('C','active1','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,20,'','','','Fire','true',0),
    row('C','opp1','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,0,'','','','Water','false',0),
    tagged(W.cardAction,'K',{token='7',uid='active1',label='Bite',colour='red',disabled='false',hasCost='true',cost='',damage='30'}),
    tagged(W.sidebar,'A',{token='9',label='End turn',colour='red',disabled='false',slot='primary'}),
  }
  sim:sync(table.concat(out,'\n'))
end
local time=10
local function tick(n) for _=1,n or 1 do time=time+1/60;sim:update(1/60,time,-100,-100,true) end end
local function count(list,value) local n=0;for _,x in ipairs(list) do if x==value then n=n+1 end end;return n end
local drawn={}
local static=Dyna.static
Dyna.static=function(text,...) drawn[#drawn+1]=text;return static(text,...) end
local function drawnText(f) drawn={};f();local out={};for _,t in ipairs(drawn) do out[t]=true end;return out end

sim:layout(1280,800)
sim:open(false,false,'online','ABCD')

-- The announcement is said once; the static title is never re-read.
snapshot({announce='Your turn.'})
check(said[#said]=='Your turn.','The opening announcement is said')
local before=#said
snapshot({announce=''})
snapshot({announce=''})
check(#said==before,'An unchanged snapshot says nothing, not the title')
snapshot({announce='Misty: Quaxly used Splash. +1 Prize, 5 left.'})
check(#said==before+1 and said[#said]=='Misty: Quaxly used Splash. +1 Prize, 5 left.','A new announcement is said')
snapshot({announce='Misty: Quaxly used Splash. +1 Prize, 5 left.'})
check(#said==before+1,'The same snapshot read again is not said twice')
tick(60)

-- A refusal pops once per serial: banner, cancel sound, speech.
local cancels=count(sounds,'cancel')
snapshot({message='That card cannot go there right now.',messageSerial='1'})
tick(2)
check(count(sounds,'cancel')==cancels+1,'A refusal pops with the cancel sound')
check(said[#said]=='That card cannot go there right now.','A refusal is said')
before=#said
snapshot({message='That card cannot go there right now.',messageSerial='1'})
snapshot({message='That card cannot go there right now.',messageSerial='1',announce='Game log.'})
tick(120)
check(count(sounds,'cancel')==cancels+1,'Later snapshots of the same refusal do not pop it again')
check(#said==before+1 and said[#said]=='Game log.','Only the new announcement is said')
snapshot({message='That card cannot go there right now.',messageSerial='2'})
tick(2)
check(count(sounds,'cancel')==cancels+2 and said[#said]=='That card cannot go there right now.','The same refusal made again pops again')
tick(120)

-- A standing warning is drawn on the turn panel without the pop.
cancels=count(sounds,'cancel')
before=#said
local warning='Could not save this game. Browser storage may be full.'
snapshot({messageSerial='2',warning=warning})
snapshot({messageSerial='2',warning=warning})
tick(2)
check(count(sounds,'cancel')==cancels and #said==before,'A warning field alone neither pops nor speaks')
local seen=drawnText(function() sim:draw(shaders) end)
check(seen[warning] and seen['Attach Energy, then attack.'],'The hint and the warning are drawn on the turn panel')

-- Online, waiting on the opponent's choice in your turn.
snapshot({gamePhase='effect:choose',waitingOn='opponent',title='Waiting for Misty',hint='Waiting for Misty...'})
tick(2)
check(sim.hud.turnText.string=='Waiting','The turn panel says Waiting while the opponent chooses')
seen=drawnText(function() sim:draw(shaders) end)
check(seen['Waiting for Misty...'],'The waiting hint is drawn on the desktop turn panel')
snapshot({gamePhase='effect:choose',waitingOn='you',title='Choose your next move'})
check(sim.hud.turnText.string=='Ash','The viewer\'s own choice names the viewer')

-- An action in flight: buttons disabled at once, "Sending..." after a second.
snapshot({flags='concede,leave,pending'})
check(sim.actions[1].disabled and sim.cardActions.active1[1].disabled,'Pending disables the panel and the attached buttons')
local live=0
for _,b in ipairs(sim.controls) do if b.action=='invoke' and not b.disabled then live=live+1 end end
check(live==0,'No invoke control is live while pending')
tick(30)
seen=drawnText(function() sim:draw(shaders) end)
check(not seen['Sending...'] and seen['Attach Energy, then attack.'],'Half a second in, the hint still shows')
tick(40)
seen=drawnText(function() sim:draw(shaders) end)
check(seen['Sending...'],'After a second the hint slot says Sending...')
snapshot({flags='concede,leave'})
-- A snapshot that arrives while still pending (a presence change) does not restart the second.
snapshot({flags='concede,leave,pending'})
tick(40)
snapshot({flags='concede,leave,pending',announce='Misty is back.'})
tick(40)
seen=drawnText(function() sim:draw(shaders) end)
check(seen['Sending...'],'The second counts from the send, not the latest snapshot')
snapshot({flags='concede,leave'})
check(not sim.actions[1].disabled and not sim.cardActions.active1[1].disabled,'The answer brings the buttons back')
seen=drawnText(function() sim:draw(shaders) end)
check(not seen['Sending...'],'Sending... goes with the answer')
-- The phone layout says it in its hint line too.
sim:layout(480,850)
snapshot({flags='concede,leave,pending'})
tick(70)
seen=drawnText(function() sim:draw(shaders) end)
check(seen['Sending...'],'The portrait hint line says Sending...')
print('PASS: the table announces changes once, pops refusals per serial, draws warnings and waiting text, and holds buttons while sending')
