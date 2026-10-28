-- Headless checks for the table in online mode: the open command, the `L`
-- lifecycle row, flag-driven options and game-over buttons (local sets are
-- unchanged), the press-again Leave, Rematch, the away banner's clock, the
-- partial HUD allowances and a draw pass with a no-op graphics stub.
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
local Simulator=require('ui.simulator')
local shader={hasUniform=function() return true end,send=function() end}
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader}
local commands,said,sounds={},{},{}
local sim=Simulator.new({command=function(raw) commands[#commands+1]=raw end,announce=function(t) said[#said+1]=t end,
  feedback=function(name) sounds[#sounds+1]=name end,settings=function() end,jiggle=function() end})
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
local base={
  row('S','you',46,6,2,0,0),row('S','opponent',47,6,7,1,0),
  row('C','card1','sv01-036','Fuecoco','you','hand',0,'false','Pokemon','','Basic','',0,'','','','Fire','true',0),
  row('C','active1','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,20,'Fire,Fire','','','Fire','true',0),
  row('C','opp1','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,0,'','','','Water','false',0),
}
local revision=0
-- opts: phase, outcome, message, seat, match, supporter, L (a row) or noL, actions.
local function snapshot(opts)
  opts=opts or {};revision=revision+1
  local out={row(revision,'ready','Ash','Misty',3,opts.phase or 'turn:action',opts.message or '','Your turn','',0,0,'you','you',opts.seat or 'p1',
    0,opts.supporter and 1 or 0,0,opts.outcome or '',opts.outcome and 'All prize cards taken.' or '','',opts.match or 'ABCD:1')}
  if not opts.noL then out[#out+1]=opts.L or row('L','online','false','','','concede,leave','partial') end
  for _,r in ipairs(base) do out[#out+1]=r end
  for _,r in ipairs(opts.actions or {}) do out[#out+1]=r end
  sim:sync(table.concat(out,'\n'))
end
local time=10
local function tick(n,reduced) for _=1,n or 1 do time=time+1/60;sim:update(1/60,time,-100,-100,reduced) end end
local function labels(overlay) local out={};for i,b in ipairs(overlay.controls) do out[i]=b.label end;return table.concat(out,'|') end
local function find(overlay,action) for i,b in ipairs(overlay.controls) do if b.action==action then return i,b end end end
local function last() return commands[#commands] end
local function draw(n) for _=1,n or 1 do tick();sim:draw(shaders) end end

-- Opening binds the lobby's live match; an internal reopen keeps the mode.
sim:layout(1280,800)
sim:open(false,false,'online','ABCD')
assert(last()=='open\tonline\tABCD','Online open names the lobby, got '..tostring(last()))
assert(sim.mode=='online' and sim.code=='ABCD')
sim:open(false,true)
assert(sim.mode=='online' and #commands==1,'A matchId reopen keeps online mode and sends nothing')
sim:open(false);assert(sim.mode=='local' and last()=='open','A plain open is local')
sim:open(false,false,'online','ABCD')

-- The L row parses into mode, flags and the partial allowance.
snapshot({supporter=true})
assert(sim.mode=='online' and sim.flags.concede and sim.flags.leave and not sim.flags.newgame,'Flags parsed')
assert(sim.allow.partial and sim.allow.supporter and not sim.allow.energy,'Allowances: Supporter only online')
assert(sim.hud.allow.partial,'The HUD drops the Energy cell')
assert(sim.hud.p1Label=='Your hand' and sim.hud.p2Label=='Misty','Hands are named online')
snapshot({seat='p2'})
assert(sim.hud.p1Label=='Misty' and sim.hud.p2Label=='Your hand','The p2 viewer owns the second hand')
snapshot()
draw(3)

-- Online Options: Settings / Concede / Leave match / Back.
sim:openOptions()
assert(labels(sim.overlay)=='Settings|Concede|Leave match|Back','Online options, got '..labels(sim.overlay))
tick(30,true)
local leave=find(sim.overlay,'leave')
local count=#commands
sim.overlay:activate(leave)
assert(#commands==count,'The first Leave press only arms')
assert(sim.overlay.controls[leave].label=='Leave? Forfeits' and sim.overlay.armed,'Armed label')
assert(said[#said]:find('Press again',1,true),'Arming announces the confirm')
tick(6)
local tarot=0;for _,s in ipairs(sounds) do if s=='tarot2' then tarot=tarot+1 end end
assert(tarot==2,'delete_profile plays tarot2 twice, got '..tarot)
draw(2)
sim.overlay:activate(leave)
assert(#commands==count,'A second press inside the 0.35 s lockout is ignored')
tick(30)
sim.overlay:activate(leave)
assert(last()=='leave','The second press leaves, got '..tostring(last()))
-- It reverts after three seconds, on a focus change and on a press elsewhere.
sim:openOptions();tick(30,true)
sim.overlay:activate(leave);assert(sim.overlay.armed)
tick(200);assert(not sim.overlay.armed and sim.overlay.controls[leave].label=='Leave match','Arming times out')
sim.overlay:activate(leave);assert(sim.overlay.armed)
sim.overlay.focus=leave;sim.overlay:keypressed('up')
assert(not sim.overlay.armed,'Moving focus disarms')
sim.overlay:activate(leave);assert(sim.overlay.armed)
local b=sim.overlay.controls[1]
sim:mousepressed(sim.ox+(b.x+b.w/2)*sim.zoom,sim.oy+(b.y+b.h/2)*sim.zoom)
assert(not sim.overlay.armed,'Pressing another control disarms')
sim:mousereleased(-1000,-1000)
-- Concede hands off to the host's confirm menu.
count=#commands
sim.overlay:activate(find(sim.overlay,'concede'))
assert(last()=='concede' and sim.overlay==nil,'Concede asks the host')

-- Game over: Rematch / Leave / Game log / View table; Rematch disables.
snapshot({phase='gameOver',outcome='loss',L=row('L','online','false','','','rematch,leave','partial')})
tick(60)
assert(sim.overlay and sim.overlay.kind=='gameover','Outcome opens game over')
assert(sim.overlay.titleText.string=='MISTY WINS','The loss names the opponent, got '..sim.overlay.titleText.string)
assert(labels(sim.overlay)=='Rematch|Leave|Game log|View table','Online game over, got '..labels(sim.overlay))
assert(not sim.overlay.controls[find(sim.overlay,'concede') or 0],'No concede after the match')
local rematch=find(sim.overlay,'rematch')
sim.overlay:activate(rematch)
assert(last()=='rematch','Rematch asks the lobby')
local r=sim.overlay.controls[rematch]
assert(r.label=='Waiting...' and r.disabled and r.colour==T.panel,'Rematch disables once sent')
count=#commands;sim.overlay:activate(rematch);assert(#commands==count,'A sent rematch cannot repeat')
draw(2)
-- The host's flag keeps it disabled across snapshots; a new match clears it.
snapshot({phase='gameOver',outcome='loss',L=row('L','online','false','','','rematch,rematch-sent,leave','partial')})
assert(sim.overlay.controls[rematch].label=='Waiting...')
sim.rematchSent=nil
snapshot({phase='gameOver',outcome='loss',L=row('L','online','false','','','rematch,rematch-sent,leave','partial')})
assert(sim.overlay.controls[rematch].disabled,'rematch-sent alone disables it')
-- A refused rematch (a signed-out seat) comes back as a message without the flag.
sim.rematchSent=true
snapshot({phase='gameOver',outcome='loss',message="You're signed out. Sign in again to play another game.",L=row('L','online','false','','','rematch,leave','partial')})
assert(not sim:rematchPending(),'A refused rematch can be pressed again')
assert(sim.overlay.controls[rematch].label=='Rematch' and not sim.overlay.controls[rematch].disabled,'Rematch is live after a refusal')
draw(2)
-- Watching after the refusal (the seat refused on reconnect): Rematch is gone, not Waiting...
sim.rematchSent=true
snapshot({phase='gameOver',outcome='loss',L=row('L','online','false','','','leave','partial')})
assert(not sim:rematchPending(),'Losing the seat drops a pending rematch')
assert(sim.overlay.controls[rematch].label=='Rematch' and sim.overlay.controls[rematch].disabled,'A watcher cannot ask for a rematch')
sim.rematchSent=true
snapshot({match='ABCD:2'})
assert(not sim.rematchSent and not sim:rematchPending(),'A new matchId resets the rematch')
snapshot({phase='gameOver',outcome='win',match='ABCD:2',L=row('L','online','false','','','rematch,leave','partial')})
tick(60)
assert(sim.overlay.titleText.string=='YOU WIN!')
sim.overlay:activate(find(sim.overlay,'leave'))
assert(last()=='leave','Game-over Leave needs no confirm')
sim:openOptions()
leave=find(sim.overlay,'leave')
sim.overlay:activate(leave)
assert(last()=='leave' and not sim.overlay.armed,'Leave after the match needs no confirm')
-- Portrait keeps the online game over inside the board.
sim:layout(480,850)
snapshot({phase='gameOver',outcome='loss',match='ABCD:2',L=row('L','online','false','','','rematch,leave','partial')})
sim:openGameOver()
assert(labels(sim.overlay)=='Rematch|Game log|Leave','Portrait online game over, got '..labels(sim.overlay))
for _,c in ipairs(sim.overlay.controls) do assert(c.x>=sim.overlay.x and c.x+c.w<=sim.overlay.x+sim.overlay.w,'Inside the frame: '..c.label) end
draw(2)
sim:layout(1280,800)

-- Away banner: boss_warning_text with a local forfeit countdown.
assert(Simulator.clock(42)=='0:42' and Simulator.clock(61.2)=='1:02' and Simulator.clock(0)=='0:00' and Simulator.clock(600)=='10:00' and Simulator.clock(-3)=='0:00','M:SS clock')
sim:open(false,false,'online','ABCD')
snapshot()
local chips=0;for _,s in ipairs(sounds) do if s=='chips1' then chips=chips+1 end end
snapshot({L=row('L','online','false','Misty',42000,'concede,leave','partial')})
assert(sim.away and sim.away.title.string=='Misty disconnected','Banner appears')
assert(sim.away.detail.string=='Forfeits in 0:42','Clock from awayMs, got '..sim.away.detail.string)
assert(said[#said]=='Misty disconnected. Forfeits in 0:42','Banner announces')
local after=0;for _,s in ipairs(sounds) do if s=='chips1' then after=after+1 end end
assert(after==chips+1,'chips1 on appear')
tick(90)
assert(sim.away.detail.string=='Forfeits in 0:41','Lua counts down locally, got '..sim.away.detail.string)
draw(2)
-- A later re-emit restarts the clock from its own ms without a new banner.
snapshot({L=row('L','online','false','Misty',3000,'concede,leave','partial')})
assert(sim.away.detail.string=='Forfeits in 0:03')
tick(200);assert(sim.away.detail.string=='Forfeiting...','Zero reads Forfeiting')
snapshot({L=row('L','online','false','Misty',-1,'concede,leave','partial')})
assert(sim.away.detail.string=='Waiting for them to reconnect...','No clock while unlimited')
-- Return: pop_out plus a blue "is back" attention text, then gone.
snapshot()
assert(sim.away and sim.away.leaving,'Banner pops out')
local back=false;for _,at in ipairs(sim.fx.texts) do if at.text.string=='Misty is back' and at.backdrop==T.blue then back=true end end
assert(back and said[#said]=='Misty is back','Return announced')
tick(40);assert(sim.away==nil,'Banner removed after pop_out')
-- The banner hides once the match is over, without the return cue.
snapshot({L=row('L','online','false','Misty',10000,'concede,leave','partial')})
local n=#said
snapshot({phase='gameOver',outcome='win',L=row('L','online','false','Misty',10000,'rematch,leave','partial')})
back=0;for i=n+1,#said do if said[i]=='Misty is back' then back=back+1 end end
assert(sim.away.leaving and back==0,'Game over removes the banner quietly')
tick(40,true);assert(sim.away==nil)

-- Online chooseFirst: Go first / Go second side by side in the cluster.
sim:open(false,false,'online','ABCD')
snapshot({phase='setup:chooseFirst',actions={row('A','1','Go first','blue','false','primary'),row('A','2','Go second','blue','false','primary')}})
local first,second
for _,c in ipairs(sim.controls) do if c.label=='Go first' then first=c elseif c.label=='Go second' then second=c end end
assert(first and second and first.y==second.y and first.x+first.w<second.x,'Side by side')
local cl=sim.hud:buttons(sim.L).cluster
assert(second.x+second.w<=cl.x+cl.w+0.01 and first.h==44,'Inside the action panel')
draw(2)

-- Local sets are unchanged, with or without the local L row.
for _,variant in ipairs({{noL=true},{L=row('L','local','false','','','undo,newgame,choosedecks,concede,leave','full')}}) do
  sim:open(false)
  snapshot({noL=variant.noL,L=variant.L,match='1'})
  assert(sim.mode=='local' and not sim.allow.partial)
  assert(sim.hud.p1Label=='P1 Hand' and sim.hud.p2Label=='P2 Hand','Hot-seat hand labels stay')
  sim:openOptions()
  assert(labels(sim.overlay)=='Settings|Choose decks|New game|Main menu|Back','Local options, got '..labels(sim.overlay))
  count=#commands
  sim.overlay:activate(find(sim.overlay,'leave'))
  assert(last()=='leave' and #commands==count+1,'Local Main menu leaves at once')
  snapshot({phase='gameOver',outcome='loss',noL=variant.noL,L=variant.L,match='1'})
  tick(60)
  assert(sim.overlay.titleText.string=='GAME OVER')
  assert(labels(sim.overlay)=='New game|Main menu|Game log|View table','Local game over, got '..labels(sim.overlay))
end
draw(2)
print('PASS: online open, L row, flag-driven options/game over, press-again Leave, Rematch, away banner clock, partial HUD')
