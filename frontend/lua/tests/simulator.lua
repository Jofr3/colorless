-- Headless checks for the table: snapshot parsing, hand drags and drops,
-- targeting from attached actions, menus of every kind, and both layouts.
package.path='frontend/lua/?.lua;'..package.path
local function font()
  return {getWidth=function(_,s) return #tostring(s)*8 end,getHeight=function() return 20 end,
    getWrap=function(_,s,w) local lines={};local line='';for word in tostring(s):gmatch('%S+') do
      if #line+#word+1>w/8 and line~='' then lines[#lines+1]=line;line=word else line=line==('' ) and word or line..' '..word end end
      if line~='' then lines[#lines+1]=line end;return #s*8,lines end}
end
love={math={random=function() return 0.5 end},graphics={},keyboard={isDown=function() return false end},filesystem={getInfo=function() return nil end}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local T=require('ui.theme')
T.font=function() return font() end
local Simulator=require('ui.simulator')
local commands={}
local announced={}
local sim=Simulator.new({command=function(raw) commands[#commands+1]=raw end,announce=function(t) announced[#announced+1]=t end,feedback=function() end,settings=function() end,jiggle=function() end})
local RS,US='\30','\31'
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
local function header(rev,extra)
  return row(rev,'ready','Player 1','Player 2',1,'turn:action','',(extra or {}).title or 'Your turn','Attach Energy, then attack.',0,1,'you','you','p1',0,0,0,'','')
end
local base={
  row('S','you',46,6,2,0,0),row('S','opponent',47,6,7,1,0),
  row('C','card1','sv01-036','Fuecoco','you','hand',0,'false','Pokemon','','Basic','',0,'',0,'','Fire','true'),
  row('C','energy1','sv03-230','Fire Energy','you','hand',1,'false','Energy','','','',0,'',0,'','Fire','true'),
  row('C','active1','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,20,'Fire,Fire',0,'','Fire','true'),
  row('C','bench1','sv01-030','Growlithe','you','bench',0,'false','Pokemon','','Basic',70,0,'',0,'','Fire','true'),
  row('C','opp1','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,0,'',0,'asleep','Water','false'),
  row('C','h1','hidden','Face-down card','opponent','hand',0,'true','','','','',0,'',0,'','','false'),
  row('C','h2','hidden','Face-down card','opponent','hand',1,'true','','','','',0,'',0,'','','false'),
  row('I','sv01-033','Pokemon','','Basic',70,'Fire',1,'Water:×2','','', '','Bite'..US..'Colorless'..US..'10'..US..''..RS..'Flare'..US..'Fire,Colorless'..US..'30'..US..'','','Houndour'),
  row('I','sv03-230','Energy','','','','Fire','','','','','','','Normal','Fire Energy'),
  row('K','1','energy1','Attach to Houndour','blue','false','active1','attach',''),
  row('K','2','energy1','Attach to Growlithe','blue','false','bench1','attach',''),
  row('K','3','card1','Bench','blue','false','','',''),
  row('K','4','active1','Flare · 30','red','false','','','Fire,Colorless'),
  row('A','5','Attack','blue','false','primary'),row('A','6','End turn','red','false','danger'),row('A','7','Retreat','blue','true','minor'),
}
local function snapshot(rev,rowsExtra,extra)
  local out={header(rev,extra)}
  for _,r in ipairs(base) do out[#out+1]=r end
  for _,r in ipairs(rowsExtra or {}) do out[#out+1]=r end
  return table.concat(out,'\n')
end
sim:layout(1280,800);sim:open(false)
sim:sync(snapshot(1))
assert(#sim.cards==5,'All visible cards placed (opponent hand hidden on desktop), got '..#sim.cards)
assert(sim.sides.you.deck==46 and sim.info['sv01-033'].hp=='70','Header, sides and info parsed')
assert(#sim.cardActions.energy1==2 and sim.cardActions.energy1[1].group=='attach','Attached actions parsed')
local function cardOf(uid) return sim.byUid['you:'..uid] end
-- Hand fan: both hand cards sit near the hand zone, inside the board.
for _,uid in ipairs({'card1','energy1'}) do local c=cardOf(uid);assert(c.homeY>600 and c.homeX>300 and c.homeX<1270,'Hand card in the fan') end
assert(sim.byUid['opponent:h1']==nil,'Opponent hand is counted, not drawn, on desktop')
for i=1,120 do sim:update(1/60,i/60,-100,-100,false) end
-- Drag the Basic to the Active well.
local card=cardOf('card1')
local x,y=card.x,card.y
sim:mousepressed(x,y)
sim:update(1/60,3.02,x+50,y-50,false)
assert(card.dragging,'Hand card must drag')
sim:mousereleased(-100,-100)
assert(not card.dragging and sim.drag==nil,'Invalid drop releases the card')
for i=1,180 do sim:update(1/60,3.02+i/60,-100,-100,true) end
assert(math.abs(card.x-card.homeX)<0.01 and math.abs(card.y-card.homeY)<0.01,'Rejected drop returns to hand')
local aw=sim.L.zones.you_active.well
sim:mousepressed(card.x,card.y);sim:update(1/60,7,aw.x+aw.w/2,aw.y+aw.h/2,false);sim:mousereleased(aw.x+aw.w/2,aw.y+aw.h/2)
assert(commands[#commands]=='move\tcard1\thand\t0\tactive\t0','Drop uses the engine zone and UID, got '..tostring(commands[#commands]))
for i=1,120 do sim:update(1/60,7+i/60,-100,-100,true) end
-- Drop onto a bench Pokémon names its index.
local bench=cardOf('bench1')
sim:mousepressed(card.x,card.y);sim:update(1/60,8,bench.x,bench.y,false);sim:mousereleased(bench.x,bench.y)
assert(commands[#commands]=='move\tcard1\thand\t0\tbench\t0','Bench drop targets the hovered slot, got '..tostring(commands[#commands]))
for i=1,120 do sim:update(1/60,8+i/60,-100,-100,true) end
assert(sim:cardHit(bench.x,bench.y)==bench,'The dropped card springs back before the Bench is clickable again')
-- Click to highlight: attached buttons appear, Attach enters targeting mode.
local energy=cardOf('energy1')
sim:mousepressed(energy.x,energy.y);sim:mousereleased(energy.x,energy.y)
assert(sim.highlight==energy,'Click highlights a hand card')
local attach
for i,b in ipairs(sim.controls) do if b.attached and b.action=='target' then attach=i end end
assert(attach,'Grouped attach action becomes one attached button')
sim:activate(attach)
assert(sim.luaTargeting and #sim.luaTargeting.actions==2,'Targeting mode lists both targets')
assert(sim:isCandidate(cardOf('active1')) and sim:isCandidate(cardOf('bench1')),'Both Pokémon are candidates')
sim:update(1/60,9,bench.x,bench.y,false)
sim:mousepressed(bench.x,bench.y);sim:mousereleased(bench.x,bench.y)
assert(commands[#commands]=='invoke\t1\t2','Clicking a candidate invokes its token, got '..tostring(commands[#commands]))
assert(sim.luaTargeting==nil,'Targeting ends after the pick')
-- Clicking the Active shows its attack row; clicking the row invokes the attack.
sim:update(1/60,9.5,-100,-100,false)
local active=cardOf('active1')
sim:mousepressed(active.x,active.y);sim:mousereleased(active.x,active.y)
assert(sim.highlight==active,'Click highlights the Active')
local attackButton
for i,b in ipairs(sim.controls) do if b.attached and b.action=='cardAction' and b.label=='Flare · 30' then attackButton=b end end
assert(attackButton and #attackButton.cost==2 and attackButton.damage=='' ,'Attack row carries its cost pips')
sim:update(1/60,9.6,attackButton.x+10,attackButton.y+10,false)
sim:mousepressed(attackButton.x+10,attackButton.y+10);sim:mousereleased(attackButton.x+10,attackButton.y+10)
assert(commands[#commands]=='invoke\t1\t4','Attack row invokes its token, got '..tostring(commands[#commands]))
assert(sim.highlight==nil,'Invoking clears the highlight')
-- Active drag onto the bench retreats.
local active=cardOf('active1')
sim:mousepressed(active.x,active.y);sim:update(1/60,10,bench.x,bench.y,false);sim:mousereleased(bench.x,bench.y)
assert(commands[#commands]=='retreat\t0','Active dropped on a Benched Pokémon retreats to it, got '..tostring(commands[#commands]))
-- Host board prompt: candidates highlighted on the table, footer in the banner.
sim:sync(snapshot(2,{row('M','board','Choose a Pokémon','Pick one','true','m1'),row('O','8','Houndour','blue','false','false','sv01-033','active1'),row('F','9','Confirm','blue','true','false','','')}))
assert(sim.targeting and sim.overlay==nil,'Board prompts do not open an overlay')
assert(sim:isCandidate(cardOf('active1')) and not sim:isCandidate(cardOf('bench1')),'Only listed uids are candidates')
local hasCancel=false;for _,b in ipairs(sim.controls) do if b.action=='dismiss' then hasCancel=true end end
assert(not hasCancel,'Mandatory prompt offers no cancel')
-- Card prompt: an overlay with real cards; the tray fits inside the frame.
sim:sync(snapshot(3,{row('M','cards','Choose cards (0/1)','Pick','true','m2'),row('O','10','Fuecoco','blue','false','false','sv01-036','x1'),row('O','11','Growlithe','blue','false','true','sv01-030','x2'),row('F','12','Confirm','blue','false','false','','')}))
assert(sim.overlay and sim.overlay.kind=='cards' and #sim.overlay.cards==2,'Card prompt renders cards')
for _,c in ipairs(sim.overlay.cards) do assert(c.homeX>sim.overlay.x and c.homeX<sim.overlay.x+sim.overlay.w,'Prompt card inside the frame') end
assert(sim.overlay.cards[2].item.selected,'Selection flag carried to the card')
assert(sim:cardHit(cardOf('active1').x,cardOf('active1').y)==nil,'Overlay blocks table interactions')
sim:update(1/60,11,-100,-100,false)
local picked
for i,b in ipairs(sim.overlay.controls) do if b.card==sim.overlay.cards[1] then picked=i end end
sim.overlay:activate(picked)
assert(commands[#commands]=='invoke\t3\t10','Clicking a prompt card toggles it, got '..tostring(commands[#commands]))
-- Same menu id refreshes in place; a new id replaces the overlay.
local keep=sim.overlay
sim:sync(snapshot(4,{row('M','cards','Choose cards (1/1)','Pick','true','m2'),row('O','13','Fuecoco','blue','false','true','sv01-036','x1'),row('O','14','Growlithe','blue','false','false','sv01-030','x2'),row('F','15','Confirm','blue','false','false','','')}))
assert(sim.overlay==keep and sim.overlay.cards[1].item.selected,'Refreshed menu keeps its cards')
sim:sync(snapshot(5,{row('M','coin','Coin flip','Player 1: Heads\nPlayer 2: Tails','true','m3'),row('O','16','Continue','blue','false','false','','')}))
assert(sim.overlay~=keep and sim.overlay.kind=='coin' and #sim.overlay.flips==2 and sim.overlay.flips[1].heads and not sim.overlay.flips[2].heads,'Coin overlay parses flips')
-- Menu cleared -> overlay closes; damage delta queues juice; viewer change opens a handoff.
local damaged={}
for _,r in ipairs(base) do damaged[#damaged+1]=(r:gsub('^C\tactive1\t(.-)\t70\t20\t','C\tactive1\t%1\t70\t50\t')) end
local out={row(6,'ready','Player 2','Player 1',2,'turn:action','','Your turn','',1,2,'you','you','p2',0,0,0,'','')}
for _,r in ipairs(damaged) do out[#out+1]=r end
sim:sync(table.concat(out,'\n'))
assert(sim.pendingHandoff and sim.overlay==nil,'The handoff waits for the attack juice')
assert(#sim.fx.queue>0,'Damage change queues an attention text')
for i=1,150 do sim:update(1/60,12+i/60,-100,-100,false) end
assert(sim.overlay and sim.overlay.kind=='handoff','Viewer change opens the handoff overlay once the juice lands')
sim:finishHandoff()
assert(sim.overlay==nil,'Handoff continues to the table')
-- Options overlay and escape handling.
sim:keypressed('escape')
assert(sim.overlay and sim.overlay.kind=='options','Escape opens Options')
sim.overlay:keypressed('escape')
assert(sim.overlay==nil,'Escape closes Options')
-- Game over screen.
local over={row(7,'ready','Player 2','Player 1',9,'gameOver','','Player 2 wins','All prize cards taken.',3,4,'','','p2',0,0,0,'win','All prize cards taken.')}
for _,r in ipairs(base) do over[#over+1]=r end
sim:sync(table.concat(over,'\n'))
for i=1,60 do sim:update(1/60,20+i/60,-100,-100,false) end
assert(sim.overlay and sim.overlay.kind=='gameover','Outcome opens the game over screen')
-- Portrait layout keeps every control inside the board.
sim:layout(480,850)
sim:sync(snapshot(8))
for _,b in ipairs(sim.controls) do assert(b.x>=0 and b.x+b.w<=480 and b.y>=0 and b.y+b.h<=850,'Control inside the portrait board: '..tostring(b.label)) end
for _,c in ipairs(sim.cards) do if c.item.zone~='hand' then assert(c.homeX>0 and c.homeX<480,'Card inside portrait board') end end
assert(sim.zoom>0 and sim.ox>=0 and sim.oy>=0,'Small viewport still fits full page')
-- Discard piles paint their top card; a scan arriving later (a reload) repaints them.
sim:layout(1280,800);sim:open(false)
sim:sync(snapshot(40,{row('C','d1','sv01-033','Houndour','you','discard',0,'false','Pokemon','','Basic',70,0,'',0,'','Fire','false')}))
local discardPile
for _,pl in ipairs(sim.piles) do if pl.item.kind=='discard' then discardPile=pl end end
assert(discardPile,'Discard pile built from the top discard card')
-- A loaded game appears in place: no arrival ghost for the discard, and the
-- Active sits at home instead of sliding in from the deck.
assert(#sim.ghosts==0,'No ghosts on a fresh load, got '..#sim.ghosts)
local loadedActive=cardOf('active1')
assert(math.abs(loadedActive.x-loadedActive.homeX)<1 and math.abs(loadedActive.y-loadedActive.homeY)<1,'In-play cards appear in place on load')
-- A later snapshot that discards a hand card does slide it in.
sim:sync(snapshot(41,{row('C','card1','sv01-036','Fuecoco','you','discard',0,'false','Pokemon','','Basic','',0,'',0,'','Fire','false')}))
assert(#sim.ghosts==1 and sim.ghosts[1].item.id=='card1','Hand card slides into the discard pile, got '..#sim.ghosts)
local rebuilt=0
local baseRebuild=Card.rebuild
Card.rebuild=function(self) rebuilt=rebuilt+1;baseRebuild(self) end
love.filesystem.getInfo=function(path) return path=='__builder_art.txt' and {} or nil end
love.filesystem.read=function() return 'sv01-033\t/art/houndour.png' end
sim:update(1/60,0.1,0,0,false)
assert(rebuilt>=1,'Discard pile repainted when its top card art arrives, got '..rebuilt)
love.filesystem.getInfo=function() return nil end
Card.rebuild=baseRebuild
print('PASS: Lua simulator parsing, fan layout, drags, targeting, prompts, handoff, options, game over and portrait layout')
