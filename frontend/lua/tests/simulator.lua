-- Headless checks for the table: snapshot parsing, hand drags and drops,
-- targeting from attached actions, menus of every kind, and both layouts.
package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
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
  return row(rev,'ready','Player 1','Player 2',1,'turn:action','',(extra or {}).title or 'Your turn','Attach Energy, then attack.',0,1,'you','you','p1',0,0,0,'','',(extra or {}).shuffled or '')
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
local menu=sim.attachedPopup
assert(menu.motion.VT.y==1 and menu.motion.T.y==0,'Action menu starts below its selected position')
sim:update(1/60,9.6,-100,-100,false)
assert(menu.motion.VT.y>0 and menu.motion.VT.y<1,'Action menu eases upward')
local buttonY=attackButton.y+menu.motion.VT.y*menu.travel+10
assert(sim:cardHit(attackButton.x+10,buttonY)==nil,'Moving menu blocks underlying cards')
sim:mousepressed(attackButton.x+10,buttonY);sim:mousereleased(attackButton.x+10,buttonY)
assert(commands[#commands]=='invoke\t1\t4','Attack row invokes its token, got '..tostring(commands[#commands]))
assert(sim.highlight==nil,'Invoking clears the highlight')
assert(sim.closingPopup==menu and not sim.attachedPopup,'Closing menu remains visible without active buttons')
local closingY=menu.motion.VT.y
for i=1,6 do sim:update(1/60,9.6+i/60,-100,-100,false) end
assert(menu.motion.VT.y>closingY,'Closing menu slides downward')
for i=1,60 do sim:update(1/60,9.62+i/60,-100,-100,false) end
assert(not sim.closingPopup,'Closing menu is removed after its slide')
sim.reduced=true;sim.highlight=active;sim:build()
assert(sim.attachedPopup.motion.VT.y==0,'Reduced motion shows the menu immediately')
sim.highlight=nil;sim:build()
assert(not sim.closingPopup,'Reduced motion hides the menu immediately')
-- Active drag onto the bench retreats.
local active=cardOf('active1')
sim:mousepressed(active.x,active.y);sim:update(1/60,10,bench.x,bench.y,false);sim:mousereleased(bench.x,bench.y)
assert(commands[#commands]=='retreat\t0','Active dropped on a Benched Pokémon retreats to it, got '..tostring(commands[#commands]))
-- And the other way round: a Benched Pokémon dropped on the Active spot.
for _=1,40 do sim:update(1/60,10+_/60,0,0,false) end
local benchCard=cardOf('bench1');local activeZone=sim.L.zones.you_active
sim:mousepressed(benchCard.x,benchCard.y);sim:update(1/60,11,activeZone.x,activeZone.y,false);sim:mousereleased(activeZone.x,activeZone.y)
assert(commands[#commands]=='retreat\t0','Benched Pokémon dropped on the Active spot retreats to it, got '..tostring(commands[#commands]))
-- Host board prompt: candidates on the table, footer in the HUD action area.
sim:sync(snapshot(2,{row('M','board','Choose a Pokémon','Pick one','true','m1','true','','true'),row('O','8','Houndour','blue','false','false','sv01-033','active1'),row('F','9','Confirm','blue','true','false','','')}))
assert(sim.targeting and sim.overlay==nil,'Board prompts do not open an overlay')
assert(sim.targeting.panel==nil,'Target prompts do not cover the board with a banner')
for _,b in ipairs(sim.controls) do
  if b.token=='9' then assert(b.x<sim.L.table.x,'Prompt footer belongs in the sidebar') end
end
assert(sim:isCandidate(cardOf('active1')) and not sim:isCandidate(cardOf('bench1')),'Only listed uids are candidates')
-- Adrena-Brain's source and destination menus must shake only enabled targets.
for _,c in ipairs(sim.cards) do c.motion.juice=nil;c.candidateClock=0 end
sim:update(0.02,10,-100,-100,false)
assert(cardOf('active1').motion.juice,'A valid source shakes on the first frame, including the ability user')
assert(not cardOf('bench1').motion.juice and not sim.byUid['opponent:opp1'].motion.juice,'Unlisted Pokémon do not shake')
local firstPulse=cardOf('active1').motion.juice
sim:update(0.02,10.02,-100,-100,false)
assert(cardOf('active1').motion.juice==firstPulse,'The immediate source pulse does not restart every frame')
sim:sync(snapshot(2,{row('M','board','Move damage counters','Pick one','true','m1-dest','true','active1','true'),
  row('O','8','Quaxly','blue','false','false','sv01-052','opp1'),
  row('O','9','Growlithe','blue','true','false','sv01-030','bench1')}))
for _,c in ipairs(sim.cards) do c.motion.juice=nil;c.candidateClock=0 end
sim:update(0.02,10.04,-100,-100,false)
assert(sim.byUid['opponent:opp1'].motion.juice,'Destination choice shakes the eligible opponent on the first frame')
assert(not cardOf('active1').motion.juice and not cardOf('bench1').motion.juice,'Former sources and disabled targets stop shaking')
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
local keptCards={keep.cards[1],keep.cards[2]}
local keptX,keptY=keptCards[2].motion.VT.x,keptCards[2].motion.VT.y
sim:sync(snapshot(4,{row('M','cards','Choose cards (1/1)','Pick','true','m2'),row('O','13','Fuecoco','blue','false','true','sv01-036','x1'),row('O','14','Growlithe','blue','false','false','sv01-030','x2','true'),row('F','15','Confirm','blue','false','false','','')}))
assert(sim.overlay==keep and sim.overlay.cards[1].item.selected,'Refreshed menu keeps its cards')
assert(keep.cards[1]==keptCards[1] and keep.cards[2]==keptCards[2],'Selection refresh preserves the card objects')
assert(keep.cards[2].motion.VT.x==keptX and keep.cards[2].motion.VT.y==keptY,'Selection refresh does not restart the card entrance animation')
assert(keep.controls[1].token=='13' and not keep.cards[2].item.selected,'Refreshed controls and selections stay current')
assert(keep.cards[2].greyed and not keep.controls[2].disabled,'Dimmed replacement candidates stay clickable')
keep:activate(2)
assert(commands[#commands]=='invoke\t4\t14','Dimmed cards can replace the current selection')
sim:sync(snapshot(5,{row('M','coin','Coin flip','Player 1: Heads\nPlayer 2: Tails','true','m3'),row('O','16','Continue','blue','false','false','','')}))
assert(sim.overlay~=keep and sim.overlay.kind=='coin' and #sim.overlay.flips==2 and sim.overlay.flips[1].heads and not sim.overlay.flips[2].heads,'Coin overlay parses flips')
-- Menu cleared -> overlay closes; damage delta queues juice; a viewer change
-- passes the table straight on (no handoff card), announced by the TURN banner.
local damaged={}
for _,r in ipairs(base) do damaged[#damaged+1]=(r:gsub('^C\tactive1\t(.-)\t70\t20\t','C\tactive1\t%1\t70\t50\t')) end
local out={row(6,'ready','Player 2','Player 1',2,'turn:action','','Your turn','',1,2,'you','you','p2',0,0,0,'','')}
for _,r in ipairs(damaged) do out[#out+1]=r end
sim:sync(table.concat(out,'\n'))
assert(sim.overlay==nil,'No handoff overlay on a viewer change')
assert(#sim.fx.queue>0,'Damage change queues an attention text')
local sawTurn=false
for i=1,150 do
  sim:update(1/60,12+i/60,-100,-100,false)
  for _,at in ipairs(sim.fx.texts) do if at.text.string=='TURN 2' then sawTurn=true end end
end
assert(sim.overlay==nil,'Still no overlay once the juice lands')
assert(sawTurn,'The TURN banner announces the new player')
-- Options overlay and escape handling.
sim:keypressed('escape')
assert(sim.overlay and sim.overlay.kind=='options','Escape opens Options')
local function labels(o) local out={};for i,c in ipairs(o.controls) do out[i]=c.label..'/'..c.action end;return table.concat(out,'|') end
assert(sim.mode=='local' and labels(sim.overlay)=='Settings/settings|Choose decks/choosedecks|New game/newgame|Main menu/leave|Back/back','Local options unchanged')
sim.overlay:keypressed('escape')
assert(sim.overlay==nil,'Escape closes Options')
-- Game over screen.
local over={row(7,'ready','Player 2','Player 1',9,'gameOver','','Player 2 wins','All prize cards taken.',3,4,'','','p2',0,0,0,'win','All prize cards taken.')}
for _,r in ipairs(base) do over[#over+1]=r end
sim:sync(table.concat(over,'\n'))
for i=1,60 do sim:update(1/60,20+i/60,-100,-100,false) end
assert(sim.overlay and sim.overlay.kind=='gameover','Outcome opens the game over screen')
assert(labels(sim.overlay)=='New game/newgame|Main menu/leave|Game log/log|View table/peek','Local game over unchanged')
-- Portrait layout keeps every control inside the board.
sim:layout(480,850)
sim:sync(snapshot(8))
for _,b in ipairs(sim.controls) do assert(b.x>=0 and b.x+b.w<=480 and b.y>=0 and b.y+b.h<=850,'Control inside the portrait board: '..tostring(b.label)) end
for _,c in ipairs(sim.cards) do if c.item.zone~='hand' then assert(c.homeX>0 and c.homeX<480,'Card inside portrait board') end end
assert(sim.zoom>0 and sim.ox>=0 and sim.oy>=0,'Small viewport still fits full page')
-- Evolving: the stack reports the new top card's uid. The Basic's card is
-- taken over in place (no ghost to the discard, no slide in from the deck).
sim:layout(1280,800);sim:open(false)
sim:sync(snapshot(30))
for _=1,30 do sim:update(1/60,_/60,0,0,false) end
local basic=cardOf('active1');local bx,by=basic.x,basic.y
local evolved={}
for _,r in ipairs(base) do if not r:match('^C\tactive1\t') then evolved[#evolved+1]=r end end
evolved[#evolved+1]=row('C','stage1','sv01-034','Houndoom','you','active',0,'false','Pokemon','','Stage1',130,20,'Fire,Fire',0,'','Fire','true')
sim:sync(table.concat({header(31)},'\n')..'\n'..table.concat(evolved,'\n'))
assert(#sim.ghosts==0,'Evolving leaves no ghost, got '..#sim.ghosts)
local stage=cardOf('stage1')
assert(stage and math.abs(stage.x-bx)<1 and math.abs(stage.y-by)<1,'Evolved card takes over the Basic in place')
assert(stage.item.evolvedFrom and stage.item.evolvedFrom.id=='active1','Evolution remembers the Basic')
assert(cardOf('active1')==nil,'The Basic is gone from the table')
-- The usual case: the Stage card keeps its hand uid and slides onto the spot.
sim:sync(snapshot(32))
for _=1,30 do sim:update(1/60,2+_/60,0,0,false) end
local fromHand={}
for _,r in ipairs(base) do if not r:match('^C\tactive1\t') and not r:match('^C\tcard1\t') then fromHand[#fromHand+1]=r end end
fromHand[#fromHand+1]=row('C','card1','sv01-036','Fuecoco','you','active',0,'false','Pokemon','','Basic',80,0,'',0,'','Fire','true')
sim:sync(table.concat({header(33)},'\n')..'\n'..table.concat(fromHand,'\n'))
assert(#sim.ghosts==0,'Evolving from hand leaves no ghost, got '..#sim.ghosts)
assert(cardOf('card1') and cardOf('card1').item.zone=='active' and cardOf('card1').item.evolvedFrom,'Hand card now sits on the Active spot as the evolution')
assert(cardOf('active1')==nil,'The Basic is retired')
-- Undoing that evolution: the Basic returns to the spot in place while the
-- Stage card goes back to the hand; nothing slides in from the deck.
sim:sync(snapshot(34))
local back=cardOf('active1')
assert(back and math.abs(back.x-back.homeX)<1 and math.abs(back.y-back.homeY)<1,'Undone evolution puts the Basic back in place')
assert(#sim.ghosts==0,'No ghosts on undo, got '..#sim.ghosts)

-- Retreat paid with an attached Energy: the Energy's discard slide starts
-- under the Pokémon that carried it, not at the hand.
sim:sync(snapshot(35))
for _=1,30 do sim:update(1/60,sim.time+1/60,0,0,false) end
local carrier=cardOf('active1');local cx0,cy0=carrier.x,carrier.y
local paid={}
for _,r in ipairs(base) do if not r:match('^C\tactive1\t') then paid[#paid+1]=r end end
paid[#paid+1]=row('C','active1','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,20,'Fire|en1|sv03-230',0,'','Fire','true')
sim:sync(table.concat({header(36)},'\n')..'\n'..table.concat(paid,'\n'))
for _=1,30 do sim:update(1/60,sim.time+1/60,0,0,false) end
local afterPay={}
for _,r in ipairs(base) do if not r:match('^C\tactive1\t') and not r:match('^C\tbench1\t') then afterPay[#afterPay+1]=r end end
afterPay[#afterPay+1]=row('C','bench1','sv01-030','Growlithe','you','active',0,'false','Pokemon','','Basic',70,0,'',0,'','Fire','true')
afterPay[#afterPay+1]=row('C','active1','sv01-033','Houndour','you','bench',0,'false','Pokemon','','Basic',70,20,'',0,'','Fire','true')
afterPay[#afterPay+1]=row('C','en1','sv03-230','Fire Energy','you','discard',0,'false','Energy','','','',0,'',0,'','Fire','false')
sim:sync(table.concat({header(37)},'\n')..'\n'..table.concat(afterPay,'\n'))
local slide
for _,g in ipairs(sim.ghosts) do if g.item.id=='en1' then slide=g end end
assert(slide,'Discarded Energy slides to the pile')
assert(math.abs(slide.x-cx0)<2 and math.abs(slide.y-cy0)<2,'The slide starts under the Pokémon that carried it, got '..math.floor(slide.x)..','..math.floor(slide.y)..' vs '..math.floor(cx0)..','..math.floor(cy0))
-- The discard pile only shows the Energy once the slide has landed.
local function discardPile() for _,p in ipairs(sim.piles) do if p.owner=='you' and p.item.kind=='discard' then return p end end end
assert(discardPile()==nil,'Discard pile waits for the sliding card')
for _=1,50 do sim:update(1/60,sim.time+1/60,0,0,false) end
assert(discardPile() and discardPile().topItem.id=='en1','Discard pile shows the Energy after it lands')

-- A shuffle in the header riffles your deck pile: odd ranks slide sideways
-- and turn while the amount is up, then settle; the opponent's pile stays.
sim:sync(snapshot(36,nil,{shuffled='you'}))
local function pileOf(owner) for _,p in ipairs(sim.piles) do if p.owner==owner and p.item.kind=='deck' then return p end end end
assert(pileOf('you').shuffleStart,'Your deck pile is shuffling')
assert(not pileOf('opponent').shuffleStart,'The opponent pile is still')
for _=1,12 do sim:update(1/60,sim.time+1/60,0,0,false) end
local moved=false
for _,layer in ipairs(pileOf('you').layers) do if layer.rank%2==1 and math.abs(layer.motion.T.r)>0.05 then moved=true end end
assert(moved,'Odd ranks turn during the riffle')
for _=1,60 do sim:update(1/60,sim.time+1/60,0,0,false) end
for _,layer in ipairs(pileOf('you').layers) do assert(math.abs(layer.motion.T.r)<1e-6,'Riffle settles back') end

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
love.filesystem.getInfo=function(path) return path=='__art.txt' and {} or nil end
love.filesystem.read=function() return 'sv01-033\t/art/houndour.png' end
sim:update(1/60,0.1,0,0,false)
assert(rebuilt>=1,'Discard pile repainted when its top card art arrives, got '..rebuilt)
love.filesystem.getInfo=function() return nil end
Card.rebuild=baseRebuild
-- Played Trainers wait on the table. Cost discards arrive immediately; turn
-- cleanup keeps the authoritative top card even across a hot-seat flip.
for _,size in ipairs({{1280,800},{390,844}}) do
  sim:layout(size[1],size[2]);sim:open(false)
  local function playedScene(rev,mode)
    local flipped=mode=='ended'
    local owner=flipped and 'opponent' or 'you'
    local other=flipped and 'you' or 'opponent'
    local zone=mode=='hand' and 'hand' or mode=='ended' and 'discard' or 'played'
    local costZone=mode=='hand' and 'hand' or 'discard'
    return table.concat({
      row(rev,'ready','Player 1','Player 2',flipped and 2 or 1,'turn:action','','Your turn','',0,1,'you','you',flipped and 'p2' or 'p1',0,0,0,'',''),
      row('S',owner,40,6,mode=='hand' and 4 or 0,mode=='hand' and 1 or flipped and 5 or 3,0),row('S',other,40,6,0,0,0),
      row('C','old','sv01-194','Switch',owner,'discard',0,'false','Trainer','Item','','',0,'',0,'','','false'),
      row('C','used1','sv01-196','Ultra Ball',owner,zone,mode=='ended' and 1 or 0,'false','Trainer','Item','','',0,'',0,'','','false'),
      row('C','cost1','sv03-230','Fire Energy',owner,costZone,2,'false','Energy','','','',0,'',0,'','','false'),
      row('C','used2','sv01-181','Nest Ball',owner,zone,mode=='ended' and 3 or 1,'false','Trainer','Item','','',0,'',0,'','','false'),
      row('C','cost2','sv01-188','Potion',owner,costZone,mode=='hand' and 3 or 4,'false','Trainer','Item','','',0,'',0,'','','false'),
    },'\n')
  end
  local function settle() for _=1,90 do sim:update(1/60,sim.time+1/60,-100,-100,false) end end
  sim:sync(playedScene(80,'hand'));settle()
  local used=sim.byUid['you:used1']
  local startX,startY=used.x,used.y
  sim:sync(playedScene(81,'played'))
  assert(sim.byUid['you:used1']==used,'Played card keeps its motion from the hand')
  assert(math.abs(used.x-startX)<1 and math.abs(used.y-startY)<1,'Played card starts at the hand')
  assert(#sim.ghosts==2,'Both cost cards go directly to discard')
  for _,c in ipairs(sim.ghosts) do assert(c.item.id=='cost1' or c.item.id=='cost2','Played cards stay out of discard') end
  settle()
  local z=sim.L.zones.played
  assert(used.x>=z.well.x and used.x<=z.well.x+z.well.w,'Played card fits its section')
  assert(sim:dropZoneAt(z.x,z.y,{item={zone='hand',draggable=true}}).zone=='playmat','New section accepts Trainer plays')
  local p
  for _,pile in ipairs(sim.piles) do if pile.item.kind=='discard' then p=pile end end
  assert(p.count==3 and p.topItem.id=='cost2','Costs set discard count and top immediately')
  sim:sync(playedScene(82,'ended'))
  assert(#sim.cards==0 and #sim.ghosts==0,'End turn clears staged Trainers immediately without discard flights')
  for _,pile in ipairs(sim.piles) do if pile.item.kind=='discard' then p=pile end end
  assert(p.owner=='opponent' and p.count==5 and p.topItem.id=='cost2','Instant cleanup preserves discard order across the seat flip')
  sim:sync(playedScene(83,'played'))
  assert(#sim.ghosts==0 and sim.byUid['you:used1'],'Undo cleanup restores staged cards')
  sim:sync(playedScene(84,'ended'))
  settle()
  for _,pile in ipairs(sim.piles) do if pile.item.kind=='discard' then p=pile end end
  assert(p.count==5 and p.topItem.id=='cost2','Landing order does not overwrite the true discard top')
  sim:sync(playedScene(85,'played'));settle()
  assert(sim.byUid['you:used1'] and sim.byUid['you:used2'],'Undo turn restores staged cards')
  sim:sync(playedScene(86,'hand'));settle()
  assert(sim.byUid['you:used1'].item.zone=='hand','Undo play returns the Trainer to hand')
  sim.reduced=true
  sim:sync(playedScene(87,'played'))
  sim:sync(playedScene(88,'ended'))
  assert(#sim.ghosts==0,'Reduced motion completes cleanup immediately')
  for _,pile in ipairs(sim.piles) do if pile.item.kind=='discard' then p=pile end end
  assert(p.count==5 and p.topItem.id=='cost2','Reduced motion preserves discard order')
end
-- Promotion lands before the turn's new card leaves the deck.
for _,size in ipairs({{1280,800},{390,844}}) do
  sim:layout(size[1],size[2]);sim:open(false)
  local function promotionScene(rev,after)
    local rows={
      row(rev,'ready','Player 1','Player 2',after and 7 or 6,after and 'turn:action' or 'ko:promote','','','',0,1,'you','you','p1',0,0,0,'',''),
      row('S','you',after and 39 or 40,6,after and 1 or 0,0,0),row('S','opponent',40,6,0,0,0),
      row('C','replacement','sv01-030','Growlithe','you',after and 'active' or 'bench',0,'false','Pokemon','','Basic',70,0,'',0,'','Fire','true'),
    }
    if after then rows[#rows+1]=row('C','turn-draw','sv03-230','Fire Energy','you','hand',0,'false','Energy','','','',0,'',0,'','Fire','true') end
    return table.concat(rows,'\n')
  end
  local function tick(n,reduced) for _=1,n do sim:update(1/60,sim.time+1/60,-100,-100,reduced or false) end end
  sim:sync(promotionScene(201,false));tick(90)
  local replacement=sim.byUid['you:replacement']
  local benchY=replacement.y
  sim:sync(promotionScene(202,true))
  local drawn=sim.byUid['you:turn-draw']
  assert(drawn.drawAfterPromotion and drawn.x==sim.L.zones.you_deck.x,'Turn draw waits at the deck after a promotion')
  tick(6)
  assert(replacement.y~=benchY and drawn.drawAfterPromotion,'Replacement moves first while turn draw waits')
  assert(drawn.x==sim.L.zones.you_deck.x and drawn.y==sim.L.zones.you_deck.y,'Waiting draw does not begin moving')
  assert(sim:cardHit(drawn.x,drawn.y)~=drawn,'Waiting draw cannot be clicked')
  tick(120)
  assert(not drawn.drawAfterPromotion and math.abs(drawn.x-drawn.homeX)<1 and math.abs(drawn.y-drawn.homeY)<1,'Delayed turn draw reaches the hand')
  sim:sync(promotionScene(203,false));tick(90)
  sim:sync(promotionScene(204,true));tick(1,true)
  assert(not sim.byUid['you:turn-draw'].drawAfterPromotion,'Reduced motion bypasses the promotion draw delay')
  sim.reduced=false
  sim:sync(promotionScene(205,false));tick(90)
  sim:sync(promotionScene(206,true))
  sim:sync(promotionScene(207,false));tick(90)
  assert(not sim.byUid['you:turn-draw'] and sim.byUid['you:replacement'].item.zone=='bench','Undo cancels a queued turn draw')
end
-- Items use the normal play command anywhere on either bench, occupied or empty.
for _,size in ipairs({{1280,800},{390,844}}) do
  for _,zone in ipairs({'you_bench','opp_bench'}) do
    for _,fraction in ipairs({0.05,0.5,0.95}) do
      sim:layout(size[1],size[2]);sim:open(false)
      sim:sync(snapshot(95,{
        row('C','item','sv01-191','Rare Candy','you','hand',2,'false','Trainer','Item','','',0,'',0,'','','true'),
      }))
      for _=1,90 do sim:update(1/60,sim.time+1/60,-100,-100,true) end
      local c=cardOf('item')
      local well=sim.L.zones[zone].well
      local sx,sy=c.x*sim.zoom+sim.ox,c.y*sim.zoom+sim.oy
      local tx,ty=(well.x+well.w*fraction)*sim.zoom+sim.ox,(well.y+well.h/2)*sim.zoom+sim.oy
      sim:mousepressed(sx,sy);sim:update(1/60,sim.time+1/60,tx,ty,false)
      assert(c.dragging,'Item can be dragged onto the bench')
      sim:mousereleased(tx,ty)
      assert(commands[#commands]=='move\titem\thand\t2\tplaymat\t0','Bench Item drop uses the normal Trainer play flow')
    end
  end
end
-- Rare Candy waits on the table while the matching Stage 2 remains draggable.
for _,size in ipairs({{1280,800},{390,844}}) do
  for _,target in ipairs({'active','bench'}) do
    sim:layout(size[1],size[2]);sim:open(false)
    sim:sync(snapshot(100,{
      row('R','candy'),
      row('C','candy','sv01-191','Rare Candy','you','played',0,'false','Trainer','Item','','',0,'',0,'','','false'),
      row('C','stage2','stage2','Stage 2','you','hand',2,'false','Pokemon','','Stage2',180,0,'',0,'','Fire','true'),
    }))
    assert(sim.rareCandy=='candy' and sim.byUid['you:candy'].item.zone=='played','Pending Candy is on the table')
    for _=1,90 do sim:update(1/60,sim.time+1/60,-100,-100,true) end
    local c=cardOf('stage2')
    local destination=target=='active' and cardOf('active1') or cardOf('bench1')
    local sx,sy=c.x*sim.zoom+sim.ox,c.y*sim.zoom+sim.oy
    local tx,ty=destination.x*sim.zoom+sim.ox,destination.y*sim.zoom+sim.oy
    sim:mousepressed(sx,sy);sim:update(1/60,sim.time+1/60,tx,ty,false)
    assert(c.dragging,'Stage 2 can be dragged while Candy waits')
    sim:mousereleased(tx,ty)
    assert(commands[#commands]=='move\tstage2\thand\t2\t'..target..'\t0','Stage 2 drop identifies its Basic slot')
    sim.luaTargeting={actions={}}
    sim:keypressed('escape')
    assert(commands[#commands]=='cancelRareCandy','Escape cancels the pending Candy')
    sim:sync(snapshot(101))
    assert(not sim.rareCandy and not sim.luaTargeting,'Cancellation clears Rare Candy and its target selection')
  end
end
-- Rare Candy starts the actual motion immediately, before picking up a Stage 2.
for _,size in ipairs({{1280,800},{390,844}}) do
  sim:layout(size[1],size[2]);sim:open(false)
  sim:sync(snapshot(110,{
    row('R','candy'),
    row('C','stage2','stage2','Stage 2','you','hand',2,'false','Pokemon','','Stage2',180,0,'',0,'','Fire','true'),
    row('K','c1','stage2','Evolve Houndour','green','false','active1','evolve',''),
    row('K','c2','otherStage2','Evolve Growlithe','green','false','bench1','evolve',''),
    row('K','c3','stage2','Evolve Growlithe','green','true','bench1','evolve',''),
  }))
  for _=1,90 do sim:update(1/60,sim.time+1/60,-100,-100,true) end
  local active,bench=cardOf('active1'),cardOf('bench1')
  assert(not active.motion.juice and not bench.motion.juice,'Reduced motion suppresses Candy shakes')
  sim:update(1/60,sim.time+1/60,-100,-100,false)
  assert(active.motion.juice and bench.motion.juice,'All eligible Basics shake immediately while Candy waits')
  sim:update(1/60,sim.time+1/60,-100,-100,false)
  assert(math.abs(active.angle)>0.01 and math.abs(bench.angle)>0.01,'Candy shake visibly rotates both Basics')
  local c=cardOf('stage2')
  local sx,sy=c.x*sim.zoom+sim.ox,c.y*sim.zoom+sim.oy
  sim:mousepressed(sx,sy)
  sim:update(1/60,sim.time+1/60,sx,sy-25,false)
  assert(c.dragging and active.candyTarget and not bench.candyTarget,'Dragging narrows the shake to valid matches')
  assert(not sim:isCandidate(active),'Shake does not add a targeting outline')
  for _=1,60 do sim:update(1/60,sim.time+1/60,sx,sy-25,false) end
  assert(active.motion.juice and not bench.motion.juice,'Only matching Basics keep shaking')
  sim:mousereleased(sx,sy-25)
  sim:sync(snapshot(111))
  for _=1,60 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
  assert(not active.motion.juice and not bench.motion.juice,'Shake ends when Candy is no longer pending')
end
-- KO events arrive with the final discard snapshot, never an intermediate
-- lethal-damage card. Multiple victims burn in place even across a seat flip.
local function koScene(rev,removed,flipped,ko)
  local owner=flipped and 'opponent' or 'you'
  local out={row(rev,'ready','One','Two',4,'turn:action','','Your turn','',0,1,'you','you',flipped and 'p2' or 'p1',0,0,0,'',''),
    row('S',owner,40,6,0,removed and 6 or 0,0),
    row('S',flipped and 'you' or 'opponent',40,6,0,0,0)}
  for i,id in ipairs({'victim','benched'}) do
    local energies=removed and '' or i==1 and 'Fire|attached|sv03-230,Fire|attached2|sv03-230' or 'Fire|bench-energy|sv03-230'
    local tool=not removed and i==1 and 'tool|sv01-191' or ''
    out[#out+1]=row('C',id,'sv01-033','Houndour',owner,removed and 'discard' or (i==1 and 'active' or 'bench'),removed and i-1 or 0,'false','Pokemon','','Basic',70,removed and 0 or 20,energies,tool,'','Fire','false')
    if removed and ko then out[#out+1]=row('D',id) end
  end
  if removed then
    for i,id in ipairs({'attached','attached2','bench-energy','tool'}) do
      out[#out+1]=row('C',id,id=='tool' and 'sv01-191' or 'sv03-230','Attachment',owner,'discard',i+1,'false',id=='tool' and 'Trainer' or 'Energy',id=='tool' and 'Tool' or '','','',0,'',0,'','','false')
    end
  end
  return table.concat(out,'\n')
end
for _,size in ipairs({{1280,800},{390,844}}) do
  for _,flip in ipairs({false,true}) do
    sim:layout(size[1],size[2]);sim:open(false)
    sim:sync(koScene(120,false,false,true))
    for _=1,90 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
    local victim,benched=cardOf('victim'),cardOf('benched');local x,y=victim.x,victim.y
    local koRaw=koScene(121,true,flip,true)
    sim:sync(koRaw,#koRaw) -- love.filesystem.read returns text AND byte count.
    local presentation=sim.koPresentation
    assert(presentation and #presentation.cards==2 and presentation.cards[1]==victim,'KO queue follows engine event order')
    assert(victim.disintegration and victim.motion.juice and not benched.disintegration,'Only the first KO starts burning')
    assert(#victim.koAttachments==3 and not sim.attached['bench-energy'].disintegration,'All Energy and Tools burn with their own Pokémon only')
    for _,a in ipairs(victim.koAttachments) do
      assert(a.disintegration.start==victim.disintegration.start,'Attachments start at the same time as their Pokémon')
      assert(a.angle==(a.item.id=='tool' and -math.pi/2 or math.pi/2),'Attachments burn in their sideways table position')
    end
    assert(sim.viewerSeat=='p1' and sim.revision==120,'Keep the old table until every KO finishes')
    assert(victim.x==x and victim.y==y,'KO begins at the last visible position')
    sim:sync(koScene(122,true,flip,true))
    assert(sim.koPresentation==presentation and presentation.index==1,'Repeated snapshots update the destination without restarting burns')
    for _=1,21 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
    assert(math.abs(victim.dissolve-0.5)<0.001,'Balatro dissolve reaches halfway after 0.35 seconds')
    for _,a in ipairs(victim.koAttachments) do
      assert(math.abs(a.dissolve-victim.dissolve)<0.001 and #a.disintegration.particles>0,'Attachments share burn progress and emit their own particles')
    end
    assert(math.abs(victim.x-x)<0.01 and math.abs(victim.y-y)<0.01,'Burn stays in place instead of sliding to discard')
    assert(#victim.disintegration.particles>0 and victim.disintegration.alpha==1,'Colored embers persist before their fade')
    assert(victim.burn1[1]==55/255 and victim.burn2[1]==253/255,'Uses Balatro BLACK and ORANGE burn edges')
    assert(not benched.disintegration and sim.sides.you.discard==0,'Second KO and discard update wait their turn')
    local beforeCommands=#commands
    sim:mousepressed(x*sim.zoom+sim.ox,y*sim.zoom+sim.oy);sim:keypressed('return');sim:activate(1)
    assert(not sim.drag and #commands==beforeCommands,'Game actions cannot skip the KO queue')
    -- Undo during disintegration must reclaim the same full, unburned card.
    sim:sync(koScene(123,false,false,false))
    assert(cardOf('victim')==victim and not victim.dissolve and not victim.disintegration,'Undo cancels burn and reuses the visible card')
    assert(not sim.koPresentation and not benched.disintegration,'Undo clears the whole KO queue')
    assert(not sim.attached.attached.disintegration and not sim.attached.tool.dissolve,'Undo restores unburned Energy and Tools')
    sim:sync(koScene(124,true,flip,true))
    for _=1,36 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
    assert(victim.disintegration.alpha>0 and victim.disintegration.alpha<0.5,'Particles fade during the final 0.21 seconds')
    for _=1,9 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
    assert(victim.koHidden and benched.disintegration and not benched.koHidden,'First burn finishes before the second begins')
    assert(#benched.koAttachments==1 and sim.attached['bench-energy'].disintegration,'Next Pokémon starts its own attached Energy burn')
    assert(sim.viewerSeat=='p1' and sim.revision==123,'No handoff between KO animations')
    for _=1,45 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
    assert(benched.koHidden and sim.koPresentation.waitUntil,'Last KO starts the handoff pause')
    local deadline=sim.koPresentation.waitUntil
    sim:update(0.49,deadline-0.01,-100,-100,false)
    assert(sim.koPresentation and sim.viewerSeat=='p1' and sim.revision==123,'Handoff remains blocked for the full half second')
    sim:update(0.01,deadline,-100,-100,false)
    assert(not sim.koPresentation and sim.viewerSeat==(flip and 'p2' or 'p1') and sim.revision==124,'Apply the new table after the half-second pause')
    assert(#sim.ghosts==0,'Neither KO Pokémon nor burned attachments slide to discard a second time')
    assert(not next(sim.attached),'Completed KO attachment textures are released')
    for _=1,45 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
    sim:sync(koScene(125,false,false,false));sim.reduced=true
    sim:sync(koScene(126,true,false,true))
    assert(not sim.koPresentation and #sim.ghosts==0 and not next(sim.pendingPiles),'Reduced motion applies the KO immediately')
    sim:sync(koScene(127,false,false,false));sim.reduced=false
    sim:sync(koScene(128,true,false,false))
    assert(not sim.koPresentation,'Ordinary discards never start a KO queue')
  end
end
-- Prize awards fly on the old table during the pause, even when the incoming
-- snapshot swaps seats. Both players can take Prizes from simultaneous KOs.
local Layout=require('ui.sim_layout')
local function prizeScene(rev,removed,flipped)
  local raw=koScene(rev,removed,flipped,true)
  if removed then
    raw=raw:gsub('S\tyou\t40\t6\t0',flipped and 'S\tyou\t40\t5\t1' or 'S\tyou\t40\t4\t2')
    raw=raw:gsub('S\topponent\t40\t6\t0',flipped and 'S\topponent\t40\t4\t2' or 'S\topponent\t40\t5\t1')
    for i=1,flipped and 1 or 2 do
      raw=raw..'\n'..row('C','prize'..i,'sv03-230','Fire Energy','you','hand',i-1,'false','Energy','','','',0,'',0,'','Fire','true')
    end
  end
  return raw
end
for _,size in ipairs({{1280,800},{390,844}}) do
  for _,flip in ipairs({false,true}) do
    sim:layout(size[1],size[2]);sim:open(false)
    sim:sync(prizeScene(140,false,false));sim:sync(prizeScene(141,true,flip))
    for _=1,90 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
    local p=sim.koPresentation
    assert(p and p.prizes.you.count==2 and p.prizes.opponent.count==1,'Prize awards retain their original owners across seat flips')
    assert(sim:koPrizeTaken('you',5) and sim:koPrizeTaken('you',4) and not sim:koPrizeTaken('you',3),'Only the awarded Prize slots are hidden')
    local sx,sy=Layout.prize(sim.L.zones.you_prizes,5)
    local x,y=sim:koPrizePosition('you',0)
    assert(math.abs(x-sx)<0.01 and math.abs(y-sy)<0.01,'Prize flight begins at its actual slot')
    sim:update(0.25,p.prizeStart+0.25,-100,-100,false)
    x,y=sim:koPrizePosition('you',0)
    assert(math.abs(y-sy)>10 and sim.viewerSeat=='p1','Prizes move during the pause before the table flips')
    sim:update(0.24,p.waitUntil-0.01,-100,-100,false)
    for _,owner in ipairs({'you','opponent'}) do
      local hand=sim.L.zones[owner=='you' and 'you_hand' or 'opp_hand']
      for i=0,p.prizes[owner].count-1 do
        local tx,ty=Layout.hand(hand,p.prizes[owner].handCount,i)
        if owner=='opponent' then ty=hand.y-(ty-hand.y) end
        local px,py,scale=sim:koPrizePosition(owner,i)
        assert(math.abs(px-tx)<1 and math.abs(py-ty)<1 and math.abs(scale-hand.scale)<0.01,'Every Prize reaches its hand before the half-second deadline')
      end
    end
    sim:update(0.01,p.waitUntil,-100,-100,false)
    assert(not sim.koPresentation and sim.viewerSeat==(flip and 'p2' or 'p1'),'Prize flight adds no extra delay')
    local card=cardOf('prize1')
    assert(math.abs(card.y-card.homeY)<0.01,'Received Prize does not fly into the hand a second time')
    sim:sync(prizeScene(142,false,false));sim:sync(prizeScene(143,true,flip))
    for _=1,90 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
    assert(sim:koPrizeTaken('you',5),'Prize flight restarted for undo check')
    sim:sync(prizeScene(144,false,false))
    assert(not sim.koPresentation and not sim:koPrizeTaken('you',5) and sim.sides.you.prizes==6,'Undo during flight restores the Prize grid')
  end
end
-- A single KO has the same half-second handoff delay. Enabling reduced
-- motion mid-queue completes presentation immediately without a stale timer.
sim:open(false);sim:sync(koScene(130,false,false,false))
local single=koScene(131,true,true,true):gsub('\nD\tbenched','')
sim:sync(single)
assert(#sim.koPresentation.cards==1,'Single KO queues just one card')
for _=1,45 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
assert(sim.koPresentation.waitUntil and sim.viewerSeat=='p1','Single KO also waits before handoff')
sim:update(0.01,sim.time+0.01,-100,-100,true)
assert(not sim.koPresentation and sim.viewerSeat=='p2','Reduced motion flushes an active KO presentation')
-- Balatro-style row sorting changes visible order live, while gameplay targets
-- continue to use the engine's original indices.
for _,size in ipairs({{1280,800},{390,844}}) do
  sim:layout(size[1],size[2]);sim:open(false)
  sim:sync(snapshot(150,{
    row('C','trainer','sv01-189','Supporter','you','hand',2,'false','Trainer','Supporter','','',0,'',0,'','','false'),
    row('C','bench2','sv01-030','Growlithe','you','bench',1,'false','Pokemon','','Basic',70,0,'Fire|attached|sv03-230',0,'','Fire','true'),
    row('C','bench3','sv01-030','Growlithe','you','bench',2,'false','Pokemon','','Basic',70,0,'',0,'','Fire','true'),
  }))
  local function settle() for _=1,60 do sim:update(1/60,sim.time+1/60,-100,-100,false) end end
  local function press(c) sim.hoverCard=nil;sim:mousepressed(c.x*sim.zoom+sim.ox,c.y*sim.zoom+sim.oy) end
  local function drag(x,y) sim:update(1/60,sim.time+1/60,x*sim.zoom+sim.ox,y*sim.zoom+sim.oy,false) end
  local function release(x,y) sim:mousereleased(x*sim.zoom+sim.ox,y*sim.zoom+sim.oy) end
  settle()
  local energy,trainer=cardOf('energy1'),cardOf('trainer')
  local x,y=trainer.homeX+50,sim.L.zones.you_hand.y
  local oldX=trainer.homeX
  press(energy);drag(x,y)
  assert(energy.item.displayIndex==2 and trainer.item.displayIndex==1,'Hand reorders before release')
  assert(trainer.homeX<oldX and math.abs(trainer.x-trainer.homeX)>1,'Neighbor slides into the open slot using its existing motion')
  assert(sim.dropZone.zone=='reorder' and not sim.dropZone.well,'Reordering has no drop outline')
  release(x,y)
  assert(commands[#commands]=='reorder\thand\tenergy1\t2','Hand release saves cosmetic order')
  assert(energy.item.index==1,'Hand keeps its engine index')
  settle()
  local first,last=cardOf('bench1'),cardOf('bench3')
  x,y=last.homeX+45,sim.L.zones.you_bench.y
  press(first);drag(x,y)
  assert(first.item.displayIndex==2 and cardOf('bench2').item.displayIndex==0,'Bench neighbors move aside while dragging')
  release(x,y)
  assert(commands[#commands]=='reorder\tbench\tbench1\t2','Bench release saves cosmetic order')
  assert(cardOf('bench2').item.energyCards[1].id=='attached','Attachments stay with their Pokémon')
  settle()
  press(energy);drag(first.x,first.y);release(first.x,first.y)
  assert(commands[#commands]=='move\tenergy1\thand\t1\tbench\t0','Attaching to a reordered Pokémon sends its engine index')
  settle()
  press(first);drag(sim.L.zones.you_active.x,sim.L.zones.you_active.y);release(sim.L.zones.you_active.x,sim.L.zones.you_active.y)
  assert(commands[#commands]=='retreat\t0','Reordered Bench Pokémon retreats by its engine index')
  settle()
  -- Unplayable cards can still be arranged; Escape restores their row.
  press(trainer);drag(energy.homeX+50,sim.L.zones.you_hand.y)
  assert(sim.drag and trainer.item.displayIndex==2,'An unplayable Supporter can be reordered')
  sim:keypressed('escape')
  assert(not sim.drag and trainer.item.displayIndex==1 and energy.item.displayIndex==2,'Escape cancels the live reorder')
  settle()
  local count=#commands
  press(trainer);drag(sim.L.zones.you_active.x,sim.L.zones.you_active.y);release(sim.L.zones.you_active.x,sim.L.zones.you_active.y)
  assert(#commands==count,'Reordering permission does not allow playing an unavailable card')
  -- The host permits dragging first-turn Supporters even though Play is
  -- disabled. A selected card's top edge can sit above the hand hit area.
  trainer.item.draggable=true
  sim.highlight=trainer;settle()
  local top=trainer.y-85*trainer.baseScale
  sim.hoverCard=nil
  sim:mousepressed(trainer.x*sim.zoom+sim.ox,top*sim.zoom+sim.oy)
  assert(sim.drag and sim.drag.card==trainer,'Grab the selected Supporter by its top edge')
  x=energy.homeX+50
  drag(x,top);release(x,top)
  assert(commands[#commands]=='reorder\thand\ttrainer\t2','Dragging a lifted Supporter sideways only reorders, even from its top edge')
end
-- Stadium ownership changes to global, but the moving card stays the same.
for _,size in ipairs({{1280,800},{390,844}}) do
  sim:layout(size[1],size[2]);sim:open(false)
  local function stadiumScene(rev,played)
    return table.concat({header(rev),
      row('S','you',40,6,played and 0 or 1,0,0),row('S','opponent',40,6,0,played and 1 or 0,0),
      row('C','new-stadium','sv01-167','Beach Court',played and 'global' or 'you',played and 'stadium' or 'hand',0,'false','Trainer','Stadium','','',0,'',0,'','','true'),
      row('C','old-stadium','sv02-171','Artazon',played and 'opponent' or 'global',played and 'discard' or 'stadium',0,'false','Trainer','Stadium','','',0,'',0,'','','false'),
    },'\n')
  end
  sim:sync(stadiumScene(301,false))
  for _=1,90 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
  local card=sim.byUid['you:new-stadium']
  local oldStadium=sim.byUid['global:old-stadium']
  local z=sim.L.zones.stadium
  sim:mousepressed(card.x*sim.zoom+sim.ox,card.y*sim.zoom+sim.oy)
  sim:update(1/60,sim.time+1/60,z.x*sim.zoom+sim.ox,z.y*sim.zoom+sim.oy,false)
  sim:mousereleased(z.x*sim.zoom+sim.ox,z.y*sim.zoom+sim.oy)
  local x,y=card.x,card.y
  local oldX,oldY=oldStadium.x,oldStadium.y
  sim:sync(stadiumScene(302,true))
  assert(sim.byUid['global:new-stadium']==card,'Played Stadium reuses the card dragged from hand')
  assert(math.abs(card.x-x)<0.001 and math.abs(card.y-y)<0.001,'Stadium continues from its visible drag position')
  assert(card.homeX==z.x and card.homeY==z.y,'Stadium moves toward its shared board slot')
  assert(#sim.ghosts==1 and sim.ghosts[1]==oldStadium,'Replaced Stadium makes only one discard animation')
  assert(oldStadium.x==oldX and oldStadium.y==oldY and oldStadium.ghost.target==sim.L.zones.opp_discard,'Replaced Stadium leaves its actual position for its owner discard')
  sim:sync(stadiumScene(303,false))
  assert(sim.byUid['you:new-stadium']==card and #sim.ghosts==0,'Undo returns the played Stadium to hand without a duplicate flight')
  assert(sim.byUid['global:old-stadium']==oldStadium,'Undo restores the replaced Stadium from its discard flight')
end
-- Adrena-Brain keeps the source raised, lifts the destination and finishes
-- with exactly one shared pulse before dispatching (including keyboard use).
for _,size in ipairs({{1280,800},{480,900}}) do
  sim:layout(size[1],size[2]);sim:open(false)
  local function brainScene(rev)
    return snapshot(rev,{
      row('M','board','Move damage counters','Choose an opponent','true','brain','true','active1','true'),
      row('O','brain-target','Quaxly','blue','false','false','','opp1'),
    })
  end
  sim:sync(brainScene(401))
  for i=1,60 do sim:update(1/60,i/60,-100,-100,false) end
  local source,target,other=cardOf('active1'),sim.byUid['opponent:opp1'],cardOf('bench1')
  assert(source.lift==0.2*D.H*source.baseScale and source.tint==nil,'Chosen source is raised normally and stays undimmed')
  assert(target.lift==0 and other.lift==0,'Unselected Pokémon remain down')
  sim.focusCard=target
  local before=#commands
  sim:keypressed('return')
  assert(sim.counterMotion and #commands==before,'Target selection starts presentation before resolving')
  for i=1,10 do sim:update(1/60,1+i/60,-100,-100,false) end
  assert(source.lift>0 and target.lift>0 and other.lift==0,'Both selected Pokémon rise')
  sim:update(1/60,1.49,-100,-100,false)
  assert(not source.motion.juice and not target.motion.juice and #commands==before,'Hold the selection before shaking')
  sim:update(1/60,1.51,-100,-100,false)
  local sourcePulse,targetPulse=source.motion.juice,target.motion.juice
  assert(sourcePulse and targetPulse and sourcePulse.start_time==targetPulse.start_time,'Both final shakes start in the same frame')
  assert(sourcePulse.scale_amt==targetPulse.scale_amt,'Both final shakes have the same strength')
  assert(not other.motion.juice,'Unselected Pokémon do not get the final shake')
  sim:keypressed('return');sim:activate(1)
  assert(#commands==before,'Repeated input cannot resolve twice during the shake')
  sim:update(1/60,1.7,-100,-100,false)
  assert(source.motion.juice==sourcePulse and target.motion.juice==targetPulse,'Candidate pulses cannot restart the final shake')
  sim:update(1/60,2,-100,-100,false)
  assert(not source.motion.juice and not target.motion.juice and #commands==before,'Pause after the shake before resolving')
  assert(source.lift==0 and target.lift==0,'Both Pokémon lower after the final shake')
  assert(sim.counterMotion.loweringAt and #commands==before,'Lowering starts before the move resolves')
  for _=1,120 do
    sim:update(1/60,sim.time+1/60,-100,-100,false)
    if #commands>before then break end
  end
  assert(math.abs(source.y-source.homeY)<1.5 and math.abs(target.y-target.homeY)<1.5,'Both Pokémon visibly settle before resolving')
  assert(#commands==before+1 and commands[#commands]=='invoke\t401\tbrain-target','Resolve once after both Pokémon return')
  sim:update(1/60,sim.time+0.1,-100,-100,false)
  assert(#commands==before+1,'Waiting for host response never repeats the action')
  local resolved={header(402)}
  for _,r in ipairs(base) do
    if not r:match('^C\tactive1\t') and not r:match('^C\topp1\t') then resolved[#resolved+1]=r end
  end
  resolved[#resolved+1]=row('C','active1','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,0,'Fire,Fire',0,'','Fire','true')
  resolved[#resolved+1]=row('C','opp1','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,20,'',0,'asleep','Water','false')
  sim:sync(table.concat(resolved,'\n'))
  sim:update(1/60,sim.time+1/60,-100,-100,false)
  assert(not sim.counterMotion and source.lift==0 and target.lift==0,'Resolution clears both selections')
  for i=1,60 do
    sim:update(1/60,sim.time+1/60,-100,-100,false)
    assert(not source.motion.juice and not target.motion.juice,'Counter updates do not add separate delayed shakes after the shared pulse')
  end
  -- History/reload cancels a queued answer rather than sending a stale token.
  sim:sync(brainScene(403));sim.focusCard=target;sim:keypressed('return')
  sim:sync(snapshot(404))
  before=#commands
  sim:update(1/60,sim.time+1,-100,-100,false)
  assert(not sim.counterMotion and #commands==before,'A changed snapshot cancels the pending transfer')
  sim:sync(brainScene(405));sim:update(1/60,sim.time+1,-100,-100,true)
  sim.focusCard=target;sim:keypressed('return')
  assert(not sim.counterMotion and commands[#commands]=='invoke\t405\tbrain-target','Reduced motion resolves immediately')
end
-- All three first-player controls use UIElement:click's gain, jiggle and
-- 0.1s debounce, including keyboard activation and reduced-motion behavior.
do
  Moveable={extend=function() return {} end}
  dofile((os.getenv('BALATRO_SOURCE') or '../balatro-source')..'/engine/ui.lua')
  local sourceSounds={}
  G={TIMERS={REAL=10},ROOM={jiggle=0},FUNCS={choose=function() end}}
  play_sound=function(...) sourceSounds[#sourceSounds+1]={...} end
  local sourceButton={config={button='choose'},states={visible=true}}
  UIElement.click(sourceButton)
  local clicks={}
  local setup=Simulator.new({command=function(raw) clicks[#clicks+1]=raw end,
    announce=function() end,feedback=function() error('Setup must use source gain') end,
    sourceFeedback=function(...) clicks[#clicks+1]={...} end,
    jiggle=function(amount) clicks[#clicks+1]=amount end})
  setup:layout(1280,800);setup:open(false)
  setup:sync(table.concat({
    row(1,'ready','Player 1','Player 2',0,'setup:chooseFirst','','Choose who goes first','',0,0,'you','','p1',0,0,0,'',''),
    row('A','1','P1 first','blue',false,'primary'),
    row('A','2','P2 first','blue',false,'primary'),
    row('A','3','Random','red',false,'minor'),
  },'\n'))
  local checked=0
  for i,b in ipairs(setup.controls) do
    if b.setupChoice then
      checked=checked+1;clicks={};setup.time=10
      setup:activate(i)
      assert(clicks[1][1]==sourceSounds[1][1] and clicks[1][2]==sourceSounds[1][2] and clicks[1][3]==sourceSounds[1][3])
      assert(clicks[2]==G.ROOM.jiggle and #clicks==3)
      setup.time=10.05;setup:activate(i)
      assert(#clicks==3,'Repeat activation inside 0.1s must be ignored')
      setup.time=10.11;setup.reduced=true;setup:activate(i)
      assert(#clicks==5,'Reduced motion plays the click and invokes without shaking')
      setup.reduced=false
    end
  end
  assert(checked==3,'Both named players and Random get identical feedback')
end
-- Same-page restarts retain the old table until the shared screen wipe
-- commits, coalesce incoming snapshots, and discard the queued state on close.
do
  local commit,transitions
  transitions=0
  sim.callbacks.transition=function(fn) transitions=transitions+1;commit=fn;return true end
  local function match(rev,id)
    local raw=snapshot(rev)
    return raw:gsub('\n','\t'..id..'\n',1)
  end
  sim:open(false);sim:sync(match(900,'first'))
  local old=sim.raw
  sim:sync(match(901,'second'));sim:sync(match(902,'second'))
  assert(transitions==1 and sim.raw==old and sim.matchId=='first','Restart must not expose the new table before coverage')
  commit()
  assert(sim.matchId=='second' and sim.revision==902 and not sim.wipeRaw,'Commit must consume the latest snapshot exactly once')
  sim:sync(match(903,'third'));sim:open(false);commit()
  assert(sim.matchId==nil and not sim.wipeRaw,'A canceled restart must not resurrect a closed table')
end
print('PASS: Lua simulator interactions, setup feedback, hand/Bench reordering, KO animations and delayed handoffs in both layouts')
