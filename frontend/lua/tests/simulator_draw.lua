-- Draw-path smoke test: every table state renders with a no-op LÖVE graphics
-- stub, so nil fields and bad arithmetic in draw code fail here, not in WASM.
package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
local function font()
  return {getWidth=function(_,s) return #tostring(s)*8 end,getHeight=function() return 20 end,
    getWrap=function(_,s,w) local lines={};local line='';for word in tostring(s):gmatch('%S+') do
      if #line+#word+1>w/8 and line~='' then lines[#lines+1]=line;line=word else line=line=='' and word or line..' '..word end end
      if line~='' then lines[#lines+1]=line end;return #s*8,lines end}
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
local sim=Simulator.new({command=function() end,announce=function() end,feedback=function() end,settings=function() end,jiggle=function() end})
local RS,US='\30','\31'
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
local base={
  row('S','you',46,6,2,3,0),row('S','opponent',47,5,7,1,0),
  row('C','card1','sv01-036','Fuecoco','you','hand',0,'false','Pokemon','','Basic','',0,'','','','Fire','true',0),
  row('C','energy1','sv03-230','Fire Energy','you','hand',1,'false','Energy','','','',0,'','','','Fire','true',1),
  row('C','tr1','sv01-189','Professor\'s Research','you','hand',2,'false','Trainer','Supporter','','',0,'','','','','true',2),
  row('C','active1','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,20,'Fire,Fire','','burned,asleep','Fire','true',0),
  row('C','bench1','sv01-030','Growlithe','you','bench',0,'false','Pokemon','','Basic',70,0,'','','','Fire','true',0),
  row('C','opp1','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,0,'Water|opp-energy|sv03-230','opp-tool|sv01-191','','Water','false',0),
  row('C','oppd','sv01-194','Switch','opponent','discard',0,'false','Trainer','Item','','',0,'','','','','false',0),
  row('C','used','sv01-181','Nest Ball','you','played',0,'false','Trainer','Item','','',0,'','','','','false',0),
  row('C','std','sv01-167','Beach Court','global','stadium',0,'false','Trainer','Stadium','','',0,'','','','','false',0),
  row('C','pz','sv01-030','Growlithe','you','prize',2,'false','Pokemon','','Basic','',0,'','','','Fire','false',2),
  row('C','h1','hidden','Face-down card','opponent','hand',0,'true','','','','',0,'','','','','false',0),
  row('I','sv01-033','Pokemon','','Basic',70,'Fire',1,'Water:×2','Grass:-30','','Bouffer'..US..'Take 20 less damage.'..US..'Ability','Bite'..US..'Colorless'..US..'10'..US..''..RS..'Flare'..US..'Fire,Colorless'..US..'30'..US..'Discard an Energy.','','Houndour'),
  row('I','sv03-230','Energy','','','','Fire','','','','','','','Normal','Fire Energy'),
  row('I','sv01-189','Trainer','Supporter','','','','','','','Discard your hand and draw 7 cards.','','','','Professor\'s Research'),
  row('I','sv01-167','Trainer','Stadium','','','','','','','Basic Pokémon retreat for 1 less.','','','','Beach Court'),
  row('K','1','energy1','Attach to Houndour','blue','false','active1','attach',''),
  row('K','2','card1','Bench','blue','false','','',''),
  row('K','3','active1','Flare · 30','red','false','','','Fire,Colorless'),
  row('A','5','Attack','blue','false','primary'),row('A','6','End turn','red','false','danger'),row('A','7','Retreat','blue','true','minor'),row('A','8','Abilities','green','false','minor'),
}
local function snapshot(rev,extraRows,head)
  local out={head or row(rev,'ready','Player 1','Player 2',3,'turn:action','Not now.','Your turn','Attach Energy, then attack.',0,1,'you','you','p1',1,0,0,'','')}
  for _,r in ipairs(base) do out[#out+1]=r end
  for _,r in ipairs(extraRows or {}) do out[#out+1]=r end
  return table.concat(out,'\n')
end
local function frames(n,start)
  for i=1,n do sim:update(1/60,(start or 0)+i/60,sim.mx or -100,sim.my or -100,sim.reduced or false);sim:draw(shaders) end
end
local function at(x,y) sim.mx,sim.my=x,y;sim:update(1/60,sim.time+1/60,x,y,false);sim:draw(shaders) end
for _,size in ipairs({{1280,800},{480,850}}) do
  sim:layout(size[1],size[2]);sim:open(false)
  sim:draw(shaders)                              -- empty table
  sim:sync(snapshot(1));frames(30,1)
  local knocked=snapshot(101,{row('D','opp1')})
    :gsub('C\topp1\tsv01%-052\tQuaxly\topponent\tactive','C\topp1\tsv01-052\tQuaxly\topponent\tdiscard')
    :gsub('S\tyou\t46\t6\t2','S\tyou\t46\t4\t4')
  sim:sync(knocked);frames(12,sim.time)
  local burn=sim.koPresentation and sim.koPresentation.cards[sim.koPresentation.index]
  assert(burn and burn.disintegration and #burn.disintegration.particles>0,'KO shader, shadow and particle draw paths run')
  assert(#burn.koAttachments==2,'Energy and Tool shader, shadow and particle draw paths run')
  for _,a in ipairs(burn.koAttachments) do
    local values=a:shaderValues(sim.time,0,0,false)
    assert(values.dissolve>0 and values.burn_colour_1[4]==1 and values.texture_details[3]==71,'Attachments render the same Balatro burn shader')
  end
  local values=burn:shaderValues(sim.time,0,0,false)
  assert(values.texture_details[3]==71 and values.texture_details[4]==95,'Burn uses the original logical atlas resolution')
  frames(45,sim.time)
  assert(sim.koPresentation and sim.koPresentation.prizes.you.count==2,'Prize flight renders during the handoff pause')
  sim:sync(snapshot(1));frames(30,sim.time)
  local c=sim.byUid['you:active1'];at(c.x,c.y)   -- hover popup over an in-play card with status
  assert(sim.popup==c and sim.popupBox,'Popup built for hovered card')
  local h=sim.byUid['you:tr1'];at(h.x,h.y)       -- trainer popup, hand card drawn on top
  sim:mousepressed(h.x,h.y);sim:mousereleased(h.x,h.y);frames(5,2) -- highlighted with attached buttons
  local e=sim.byUid['you:energy1'];at(e.x,e.y);sim:mousepressed(e.x,e.y);sim:mousereleased(e.x,e.y);frames(2,3)
  for i,b in ipairs(sim.controls) do if b.attached and b.action=='target' then sim:activate(i) end end
  assert(sim.luaTargeting,'targeting');frames(5,4) -- targeting banner + tints + candidate bob
  sim:mousepressed(e.x,e.y);sim:update(1/60,5,c.x,c.y,false);sim:mousereleased(c.x,c.y)
  -- Drag with a drop glow.
  sim.luaTargeting=nil;sim:build()
  sim:mousepressed(e.x,e.y);sim:update(1/60,6,e.x+40,e.y-120,false);sim:draw(shaders);sim:mousereleased(-10,-10)
  frames(10,7)
  -- Every overlay kind.
  sim:sync(snapshot(21,{row('M','cards','','','false','retreat'),row('O','12','Fire Energy','blue','false','false','sv03-230','e1'),row('O','13','Psychic Energy','blue','false','false','sve-005','e2'),row('F','14','Discard','blue','true','false','','')}));frames(5,8)
  local picker=sim.overlay
  assert(picker.cardColumns==2 and picker.viewport.y==picker.y+24,'Untitled Energy picker fits two columns without a heading band')
  assert(math.abs((picker.cards[1].homeX+picker.cards[2].homeX)/2-(picker.x+picker.w/2))<0.01,'Energy cards are centered in the fitted modal')
  assert(picker.controls[3].label=='Discard' and picker.controls[4].label=='Back','Compact picker keeps Discard and Back below the cards')
  sim.reduced=true;picker:build()
  local left,right,top,bottom=math.huge,-math.huge,math.huge,-math.huge
  for _,c in ipairs(picker.cards) do
    local s=c.baseScale*c.motion.VT.scale
    local hw=s*(D.W*math.abs(math.cos(c.angle))+D.H*math.abs(math.sin(c.angle)))/2
    local hh=s*(D.H*math.abs(math.cos(c.angle))+D.W*math.abs(math.sin(c.angle)))/2
    left=math.min(left,c.x-hw);right=math.max(right,c.x+hw)
    top=math.min(top,c.y-hh);bottom=math.max(bottom,c.y+hh)
  end
  local v=picker.viewport
  for _,padding in ipairs({left-v.x,v.x+v.w-right,top-v.y,v.y+v.h-bottom}) do
    assert(math.abs(padding-picker.cardPadding)<1,'Card face padding is equal on all four sides, including tilt and scale')
  end
  sim.reduced=false
  sim:sync(snapshot(2,{row('M','list','Choose an attack','Pick one.','false','m1'),row('O','9','Bite · 10','red','false','false','',''),row('O','10','Flare · 30','red','true','false','',''),row('F','11','Confirm','blue','false','false','','')}));frames(5,8)
  sim:sync(snapshot(3,{row('M','cards','Choose cards (1/2)','Pick.','true','m2'),row('O','12','Fuecoco','blue','false','true','sv01-036','x1'),row('O','13','Growlithe','blue','true','false','sv01-030','x2'),row('F','14','Confirm','blue','false','false','','')}));frames(5,9)
  local oc=sim.overlay.cards[1];at(oc.homeX,oc.homeY)
  assert(sim.overlay.pages==1 and not sim.overlay.paginationY,'Short card lists need no pagination')
  local gridRows={row('M','cards','Choose cards (0/1)','Pick a card.','true','grid'),row('F','99','Confirm','blue','false','false','','')}
  for i=1,41 do gridRows[#gridRows+1]=row('O',100+i,'Fuecoco','blue','false','false','sv01-036','grid'..i) end
  sim:sync(snapshot(31,gridRows));frames(90,9)
  local grid=sim.overlay
  assert(#grid.cards==grid.perPage and grid.pages>1,'Large grids create only the current page of cards')
  assert(grid.cards[1].collection.y==grid.cards[5].collection.y and grid.cards[6].collection.y>grid.cards[5].collection.y,'Five columns wrap into rows')
  assert(grid.cards[1].collection.x==grid.cards[6].collection.x,'Rows share column alignment')
  local confirm=grid.controls[#grid.controls]
  local confirmY=confirm.y
  local nextButton
  for i,b in ipairs(grid.controls) do if b.action=='next' then nextButton=i end end
  assert(nextButton and grid.paginationY,'Existing arrow and page controls appear below the grid')
  grid:activate(nextButton)
  local spawnX=grid.x+grid.w/2+D.HALF_W*grid.cardScale
  assert(math.abs(grid.cards[1].x-spawnX)<0.001 and grid.cards[5].x==grid.cards[1].x,'Each row starts at Balatro collection top-left spawn converted to card centres')
  assert(grid.cards[1].angle==0 and grid.cards[5].angle==0,'New collection cards start upright')
  assert(grid.cards[1].motion.T.r<0 and grid.cards[5].motion.T.r>0,'Collection cards settle into an outward fan')
  frames(90,9)
  assert(math.abs(grid.cards[1].motion.VT.scale-0.95)<0.001,'Collection cards settle to the source scale')
  assert(grid.page==2 and grid.cards[1].option==grid.perPage+1,'Next page maps cards to their original options')
  local first=grid.cards[1]
  assert(grid:hit(first.x,first.y+grid:offset())==1,'Page card hitboxes follow their visible positions')
  assert(grid.controls[1].token==tostring(100+first.option),'Later page selections invoke the correct option token')
  assert(grid:hit(grid.cards[1].x,grid.viewport.y-5+grid:offset())==0,'Clipped cards cannot intercept the title')
  assert(grid.controls[#grid.controls].y==confirmY,'Confirm stays fixed across pages')
  gridRows[first.option+2]=row('O',100+first.option,'Fuecoco','blue','false','true','sv01-036','grid'..first.option)
  sim:sync(snapshot(32,gridRows));frames(5,9)
  assert(sim.overlay==grid and grid.page==2 and grid.cards[1]==first and first.item.selected,'Selection refresh preserves page and card motion')
  grid:keypressed('pageup');assert(grid.page==1,'Page Up navigates backward')
  grid:keypressed('pagedown');assert(grid.page==2 and grid.cards[1].item.selected,'Selection survives changing pages')
  grid:changePage(grid.pages-grid.page);frames(90,9)
  local finalCard=grid.cards[#grid.cards]
  assert(finalCard.option==41,'Last page includes the final card')
  assert(finalCard.collection.count==1 and finalCard.collection.x==grid.x+grid.w/2,'Partial collection rows are centred like Balatro')
  sim.reduced=true;grid:build()
  for _,c in ipairs(grid.cards) do
    assert(math.abs(c.x-c.homeX)<0.001 and math.abs(c.y-c.homeY)<0.001 and c.motion.VT.scale==0.95,'Reduced motion shows the final collection layout without a page entrance')
  end
  sim.reduced=false
  grid:wheelmoved(-1);assert(grid.page==1,'Wheel cycles from the last page to the first')
  sim:sync(snapshot(4,{row('M','coin','Coin flip','Player 1: Heads\nPlayer 2: Tails','true','m3'),row('O','15','Continue','blue','false','false','','')}));frames(80,10)
  sim:sync(snapshot(5,{row('M','log','Game log','Turn 1\n0:01 Player 1 drew 7 cards.\n0:02 Player 1 attached Fire Energy.','false','m4')}));frames(5,12)
  sim:sync(snapshot(6,{row('M','pile','Your discard pile','3 cards.','false','m5'),row('O','16','Switch','blue','true','false','sv01-194','d1'),row('O','17','Potion','blue','true','false','sv01-188','d2')}));frames(5,13)
  sim.overlay:activate(1)
  assert(not sim.overlay.cards[1].item.selected,'Discard pile cards cannot be selected')
  sim:sync(snapshot(7,{row('M','board','Choose a Pokémon','Pick one','false','m6'),row('O','18','Houndour','blue','false','true','sv01-033','active1'),row('F','19','Confirm','blue','false','false','','')}));frames(5,14)
  local Button=require('ui.button')
  local outline=Button.outline
  local outlines=0
  Button.outline=function(...) outlines=outlines+1;return outline(...) end
  sim:drawCard(sim.byUid['you:active1'],shaders,1)
  assert(outlines==0,'Board card effects render targets without an outline')
  assert(sim:isCandidate(sim.byUid['you:active1']),'Board targets remain selectable without an outline')
  sim:sync(snapshot(71,{row('M','board','Place damage counters','Click a Pokémon','true','counters','true'),row('O','18','Quaxly','blue','false','false','sv01-052','opp1')}))
  assert(sim:isCandidate(sim.byUid['opponent:opp1']),'Enemy Pokémon remains clickable for counter placement')
  outlines=0
  sim:drawCard(sim.byUid['opponent:opp1'],shaders,1)
  assert(outlines==0,'Damage-counter targets render without an outline')
  Button.outline=outline
  sim:sync(snapshot(8,{row('M','prizes','Take 1 Prize card','Click a prize.','true','m7'),row('O','20','Prize 1','blue','false','true','','prize:0'),row('O','21','Prize 2','blue','false','false','','prize:1'),row('F','22','Take','blue','false','false','','')}));frames(5,15)
  local Layout=require('ui.sim_layout');local px,py=Layout.prize(sim.L.zones.you_prizes,1)
  sim:mousepressed(px,py);sim:mousereleased(px,py)
  sim:sync(snapshot(9));frames(5,16)
  sim:openOptions();frames(5,17);sim.overlay:keypressed('escape')
  sim:openInspect(sim.byUid['you:active1']);frames(5,18);sim:closeOverlay(true)
  -- Damage, heal, status, KO, prizes, viewer change, game over.
  local changed={}
  for _,r in ipairs(base) do
    r=r:gsub('^C\tactive1\t(.-)\t70\t20\t','C\tactive1\t%1\t70\t60\t')
    r=r:gsub('^C\tbench1\t(.-)\t70\t0\t','C\tbench1\t%1\t70\t30\t')
    if not r:match('^C\topp1\t') then changed[#changed+1]=r end
  end
  local out={row(10,'ready','Player 2','Player 1',4,'turn:action','','Your turn','',1,2,'you','opponent','p2',0,0,0,'','')}
  for _,r in ipairs(changed) do out[#out+1]=r end
  out[#out]=out[#out]:gsub('^S\tyou\t46\t6','S\tyou\t46\t5')
  sim:sync(table.concat(out,'\n'));frames(90,19)
  assert(sim.overlay==nil,'no handoff overlay');frames(120,21)
  local over={row(11,'ready','Player 2','Player 1',9,'gameOver','','Player 2 wins','All prize cards taken.',3,4,'','','p2',0,0,0,'win','All prize cards taken.')}
  for _,r in ipairs(base) do over[#over+1]=r end
  sim:sync(table.concat(over,'\n'));frames(90,24)
  assert(sim.overlay and sim.overlay.kind=='gameover','game over');frames(30,26)
  sim.peek=true;frames(2,27);sim:mousepressed(10,10)
  sim:keypressed('tab');sim:keypressed('return');sim:keypressed('escape')
end
-- History icons share a single row, retain their action labels/tokens, and
-- stay square and within the action area on desktop and portrait.
for _,size in ipairs({{1280,800},{480,850}}) do
  sim:layout(size[1],size[2]);sim:open(false)
  local entries={{'Undo turn','rewind'},{'Undo action','undo'},{'New game','restart'},{'Redo action','redo'},{'Redo turn','fast_forward'}}
  local rows={row(100,'ready','Player 1','Player 2',1,'turn:action','','Your turn','',0,0,'you','you','p1',0,0,0,'','','','first-match'),
    row('A','end','End turn','red',false,'primary')}
  for i,entry in ipairs(entries) do rows[#rows+1]=row('A','history'..i,entry[1],'red',i>3,'minor') end
  sim:sync(table.concat(rows,'\n'));frames(2,30)
  local controls={}
  for _,b in ipairs(sim.controls) do if b.icon then controls[#controls+1]=b end end
  assert(#controls==5)
  for i,b in ipairs(controls) do
    assert(b.label==entries[i][1] and b.icon==entries[i][2] and b.token=='history'..i)
    assert(b.w==b.h and b.y==controls[1].y)
    assert(b.x>=0 and b.x+b.w<=sim.L.w)
    if i>1 then assert(b.x>=controls[i-1].x+controls[i-1].w+5) end
    local enabledColour=entries[i][2]=='restart' and T.gold or T.red
    assert(b.colour==(i>3 and require('ui.sim_hud').insetColour or enabledColour))
  end
  sim:openOptions()
  sim:sync(row(101,'ready','Player 1','Player 2',0,'setup:chooseFirst','','Choose who goes first','',0,0,'you','','p1',0,0,0,'','','','new-match'))
  assert(sim.overlay==nil and sim.gamePhase=='setup:chooseFirst','Restart closes the old overlay and returns to setup')
  assert(sim.matchId=='new-match' and #sim.cards==0,'Restart clears the previous table')
end
-- Hot-seat setup keeps the same history row under Ready or the first-player
-- choice, with the dice beside the two named choices.
for _,size in ipairs({{1280,800},{480,850}}) do
  sim:layout(size[1],size[2]);sim:open(false)
  local labels={'Undo turn','Undo action','New game','Redo action','Redo turn'}
  for _,setup in ipairs({
    {phase='setup:place',top={{'Ready','blue','primary'}}},
    {phase='setup:chooseFirst',top={{'P1 first','blue','primary'},{'P2 first','blue','primary'},{'Random','red','minor'}}},
  }) do
    local rows={row(100,'ready','Player 1','Player 2',0,setup.phase,'','Setup','',0,0,'you','','p1',0,0,0,'','','','setup-match')}
    for i,a in ipairs(setup.top) do rows[#rows+1]=row('A','top'..i,a[1],a[2],false,a[3]) end
    for i,label in ipairs(labels) do rows[#rows+1]=row('A','history'..i,label,'red',i~=2,'minor') end
    sim:sync(table.concat(rows,'\n'));frames(2,31)
    local top,icons={},{}
    for _,b in ipairs(sim.controls) do
      if b.token and b.token:match('^top') then top[#top+1]=b elseif b.token and b.token:match('^history') then icons[#icons+1]=b end
    end
    assert(#top==#setup.top and #icons==5,setup.phase..' draws its choices and the history row')
    for i,b in ipairs(icons) do
      assert(b.label==labels[i] and b.w==b.h and b.y==icons[1].y and b.x+b.w<=sim.L.w)
    end
    for i,b in ipairs(top) do
      assert(b.y==top[1].y and b.x>=0,setup.phase..' choices share one row')
      if i>1 then assert(b.x>=top[i-1].x+top[i-1].w+5,setup.phase..' choices do not overlap') end
    end
    local last=top[#top]
    assert(last.x+last.w<=(sim.L.portrait and icons[1].x or sim.L.w),setup.phase..' choices clear the history row')
    if not sim.L.portrait then assert(icons[1].y>=top[1].y+top[1].h,'History sits under the choices') end
    if setup.phase=='setup:chooseFirst' then
      assert(last.icon=='dice' and last.w==last.h and last.setupChoice,'Random keeps the dice')
      assert(top[1].setupChoice and top[2].setupChoice,'Named choices keep setup feedback')
    end
  end
end
print('PASS: Lua simulator draw paths for every table state and overlay kind in both layouts')

-- Card Quality reaches every card on the table: hand, board, prizes, face-down cards, attached
-- cards, the discard pile's top card and an overlay's cards take the scan raster; only the deck,
-- drawn from Balatro's native back atlas, keeps its own.
sim:sync(snapshot(40));frames(2,40)
Card.setQuality(D.QUALITIES[2],2.25)
local function quality(c,what)
  local w,h,filter=c:raster()
  assert(w==340 and h==468 and filter=='linear',what..' takes Quality: '..w..'x'..h..' '..filter)
end
assert(#sim.cards>0,'The table has cards')
for _,c in ipairs(sim.cards) do quality(c,c.item.id) end
local attached=0
for id,c in pairs(sim.attached or {}) do quality(c,'attached '..id);attached=attached+1 end
assert(attached>0,'The table has attached cards')
local discard=0
for _,p in ipairs(sim.piles) do
  if p.item.kind=='discard' then quality(p,'the discard pile');discard=discard+1
  else assert(p:raster()==142,'The deck keeps the back atlas raster') end
end
assert(discard>0,'The table has a discard pile')
sim:sync(snapshot(41,{row('M','pile','Your discard pile','3 cards.','false','m5'),
  row('H','15a','Group cards','green','false','true','','','false','1'),
  row('H','15b','Order: Card type','blue','false','false','','','false','1'),
  row('O','16','Switch','blue','true','false','sv01-194','d1','false','3')}));frames(5,41)
assert(sim.overlay and #sim.overlay.cards>0,'An overlay shows cards')
for _,c in ipairs(sim.overlay.cards) do quality(c,'overlay '..c.item.id) end
print('PASS: Card Quality reaches every table card but the deck back')

-- The inspector's zoomed card asks host.js for its full scan and is built at 600×825.
local shown
for _,c in ipairs(sim.cards) do if not c.item.hidden and c.item.cardId~='' then shown=c;break end end
local printed={}
local print0=print;print=function(line) printed[#printed+1]=line end
sim.overlay=nil;sim:openInspect(shown)
print=print0
local zoomed=assert(sim.overlay and sim.overlay.kind=='inspect' and sim.overlay.cards[1],'The inspector opens')
local w,h,filter=zoomed:raster()
assert(w==600 and h==825 and filter=='linear','The zoomed card takes the full scan: '..w..'x'..h)
local asked=false
for _,line in ipairs(printed) do asked=asked or line=='COLORLESS:art-full:'..shown.item.cardId end
assert(asked,'It asks for its full scan')
Card.quality=D.QUALITIES[1]
print('PASS: the inspector zooms the full scan under Quality')

-- Grouped card tray: real stacked card layers, no active header outlines, no fake
-- panel backs/pills, and under-card count labels inside the viewport clearing row 2.
do
  local Button=require('ui.button')
  local savedFont=T.font
  local font200={
    getWidth=function(_,s) return #tostring(s)*80 end,
    getHeight=function() return 200 end,
    setFilter=function() end,
    getWrap=function(_,s,w)
      local lines,line={},''
      for word in tostring(s):gmatch('%S+') do
        local next=line=='' and word or line..' '..word
        if #next*80>w and line~='' then lines[#lines+1]=line;line=word else line=next end
      end
      if line~='' then lines[#lines+1]=line end
      return #tostring(s)*80,lines
    end,
  }
  T.font=function(size) return size==200 and font200 or savedFont(size) end

  local function cardHalfExtents(c)
    local s=c.baseScale*c.motion.VT.scale
    local hw=s*(D.W*math.abs(math.cos(c.angle))+D.H*math.abs(math.sin(c.angle)))/2
    local hh=s*(D.H*math.abs(math.cos(c.angle))+D.W*math.abs(math.sin(c.angle)))/2
    return hw,hh
  end

  local groupOptions={
    {label='Fuecoco',cardId='sv01-036',disabled=false,count=1},
    {label='Growlithe',cardId='sv01-030',disabled=false,count=2},
    {label='Houndour',cardId='sv01-033',disabled=false,count=3},
    {label='Fire Energy',cardId='sv03-230',disabled=false,count=4},
    {label='Switch',cardId='sv01-194',disabled=true,count=3},
    {label='Nest Ball',cardId='sv01-181',disabled=false,count=2},
    {label='Beach Court',cardId='sv01-167',disabled=false,count=4},
    {label='Quaxly',cardId='sv01-052',disabled=false,count=1},
    {label='Professor\'s Research',cardId='sv01-189',disabled=false,count=3},
    {label='Psychic Energy',cardId='sve-005',disabled=false,count=4},
  }
  local expectedNormalDraws={[1]=2,[2]=4,[3]=5,[4]=6}
  local wrappedKeys={'push','pop','translate','scale','rotate','draw','print','printf','setColor','setFont'}

  for layoutIdx,size in ipairs({{1280,800},{480,850}}) do
    local tag=size[1]..'x'..size[2]
    sim:layout(size[1],size[2]);sim:open(false)
    sim.mx,sim.my=-100,-100
    local rows={
      row('M','cards','Choose cards (0/2)','Pick cards.','false','grouped-tray-'..tag),
      row('H','gh1','Group cards','green','false','true','','','false','1'),
      row('H','gh2','Order: Card type','blue','false','false','','','false','1'),
      row('F','gf1','Confirm','blue','false','false','','','false','1'),
    }
    for i,opt in ipairs(groupOptions) do
      rows[#rows+1]=row('O','go'..i,opt.label,'blue',opt.disabled and 'true' or 'false','false',opt.cardId,'gu'..i,'false',tostring(opt.count))
    end
    sim:sync(snapshot(50+layoutIdx,rows))
    sim.reduced=true;frames(5,50+layoutIdx)

    local overlay=sim.overlay
    assert(overlay and overlay.kind=='cards',tag..' opens cards overlay')
    assert(overlay.cardColumns==5 and overlay.cardRows==2 and overlay.pages==1 and #overlay.cards==10,
      tag..' lays out a single 5x2 page of 10 cards')
    local header1,header2=overlay.controls[1],overlay.controls[2]
    assert(header1 and header1.headerIndex==1 and header1.selected==true,tag..' active header button is selected')
    assert(header2 and header2.headerIndex==2 and not header2.selected,tag..' inactive header button is unselected')

    local savedG={}
    for _,k in ipairs(wrappedKeys) do savedG[k]=rawget(g,k) end
    local origOutline,origPanel=Button.outline,Button.panel

    local m={a=1,b=0,c=0,d=1,tx=0,ty=0}
    local stack={}
    local currentColor={1,1,1,1}
    local currentFont=nil
    local cardByTexture={}
    for _,c in ipairs(overlay.cards) do cardByTexture[c.texture]=c end
    local draws,prints,printsByCard,printfs={},{},{},{}
    local outlineCalls,panelCalls=0,0
    local lastCard=nil

    local function pt(x,y) return m.a*x+m.c*y+m.tx,m.b*x+m.d*y+m.ty end
    g.push=function(...)
      stack[#stack+1]={a=m.a,b=m.b,c=m.c,d=m.d,tx=m.tx,ty=m.ty}
      if savedG.push then return savedG.push(...) end
    end
    g.pop=function(...)
      m=table.remove(stack) or {a=1,b=0,c=0,d=1,tx=0,ty=0}
      if savedG.pop then return savedG.pop(...) end
    end
    g.translate=function(dx,dy,...)
      m.tx=m.tx+m.a*dx+m.c*dy
      m.ty=m.ty+m.b*dx+m.d*dy
      if savedG.translate then return savedG.translate(dx,dy,...) end
    end
    g.scale=function(sx,sy,...)
      sy=sy or sx
      m.a,m.b=m.a*sx,m.b*sx
      m.c,m.d=m.c*sy,m.d*sy
      if savedG.scale then return savedG.scale(sx,sy,...) end
    end
    g.rotate=function(r,...)
      local cs,sn=math.cos(r),math.sin(r)
      local a,b,c,d=m.a,m.b,m.c,m.d
      m.a,m.b=a*cs+c*sn,b*cs+d*sn
      m.c,m.d=-a*sn+c*cs,-b*sn+d*cs
      if savedG.rotate then return savedG.rotate(r,...) end
    end
    g.setColor=function(r,gr,b,a,...)
      if type(r)=='table' then currentColor={r[1],r[2],r[3],r[4] or 1}
      else currentColor={r,gr,b,a or 1} end
      if savedG.setColor then return savedG.setColor(r,gr,b,a,...) end
    end
    g.setFont=function(f,...)
      currentFont=f
      if savedG.setFont then return savedG.setFont(f,...) end
    end
    g.draw=function(drawable,x,y,r,sx,sy,...)
      local wx,wy=pt(x or 0,y or 0)
      local list=draws[drawable]
      if not list then list={};draws[drawable]=list end
      list[#list+1]={x=wx,y=wy,r=r or 0,sx=sx,sy=sy,color={currentColor[1],currentColor[2],currentColor[3],currentColor[4]}}
      if cardByTexture[drawable] then lastCard=cardByTexture[drawable] end
      if savedG.draw then return savedG.draw(drawable,x,y,r,sx,sy,...) end
    end
    g.print=function(text,x,y,r,sx,sy,...)
      local wx,wy=pt(x or 0,y or 0)
      local ex=(sx or 1)*math.sqrt(m.a*m.a+m.b*m.b)
      local ey=(sy or sx or 1)*math.sqrt(m.c*m.c+m.d*m.d)
      local f=currentFont or T.font(200)
      local rec={text=tostring(text),x=wx,y=wy,w=f:getWidth(text)*ex,h=f:getHeight()*ey,card=lastCard}
      prints[#prints+1]=rec
      if lastCard then
        local list=printsByCard[lastCard]
        if not list then list={};printsByCard[lastCard]=list end
        list[#list+1]=rec
      end
      if savedG.print then return savedG.print(text,x,y,r,sx,sy,...) end
    end
    g.printf=function(text,...)
      printfs[#printfs+1]=tostring(text)
      if savedG.printf then return savedG.printf(text,...) end
    end
    Button.outline=function(...) outlineCalls=outlineCalls+1;return origOutline(...) end
    Button.panel=function(...) panelCalls=panelCalls+1;return origPanel(...) end

    overlay:draw(shaders)

    for _,k in ipairs(wrappedKeys) do g[k]=savedG[k] end
    Button.outline,Button.panel=origOutline,origPanel

    assert(header1.selected==true and outlineCalls==0,tag..' draws no outline on active header buttons')
    assert(panelCalls==5,tag..' draws only 5 panels (modal frame + viewport inset), got '..panelCalls)
    for _,s in ipairs(printfs) do
      assert(s~='x2' and s~='x3' and s~='x4',tag..' never draws stack counts via g.printf: '..s)
    end

    local groupedCards=0
    local v=overlay.viewport
    for idx,c in ipairs(overlay.cards) do
      local count=c.item.count or 1
      local cd=draws[c.texture] or {}
      assert(not c.greyed,tag..' card '..idx..' stays opaque (not translucent greyed)')
      assert(#cd==expectedNormalDraws[count],
        tag..' card '..idx..' (count '..count..') draws '..expectedNormalDraws[count]..' times, got '..#cd)
      if c.tint then
        assert(c.tint[4]==1,tag..' disabled card '..idx..' uses opaque tint')
        for layer=2,3 do
          assert(math.abs(cd[layer].x-c.x)>0.5 and math.abs(cd[layer].y-c.y)>0.5,
            tag..' disabled back layer '..(layer-1)..' is offset from card centre')
        end
        assert(math.abs(cd[#cd].x-c.x)<0.01 and math.abs(cd[#cd].y-c.y)<0.01,
          tag..' disabled face draws at card centre')
      end

      local cp=printsByCard[c] or {}
      if count==1 then
        assert(#cp==0,tag..' count=1 card draws no count label')
      else
        groupedCards=groupedCards+1
        assert(#cp==1 and cp[1].text=='x'..count,
          tag..' card '..idx..' draws single count label x'..count)
        local lbl=cp[1]
        local _,hh=cardHalfExtents(c)
        assert(lbl.w>0 and lbl.h>0,tag..' count label for card '..idx..' has positive 200px metrics')
        assert(lbl.y>=c.y+hh,tag..' count label for card '..idx..' sits below card bottom')
        assert(lbl.x>c.x and lbl.x+lbl.w<=c.x+D.HALF_W*c.baseScale,
          tag..' count label for card '..idx..' is right-aligned under the card')
        assert(lbl.x>=v.x and lbl.x+lbl.w<=v.x+v.w and lbl.y>=v.y and lbl.y+lbl.h<=v.y+v.h,
          tag..' count label for card '..idx..' stays strictly inside overlay viewport')
      end
    end
    assert(#prints==groupedCards,tag..' records exactly one g.print per grouped card')

    for col=1,5 do
      local c1,c2=overlay.cards[col],overlay.cards[col+5]
      if (c1.item.count or 1)>1 then
        local lbl=printsByCard[c1][1]
        local _,hh2=cardHalfExtents(c2)
        assert(lbl.y+lbl.h<=c2.y-hh2,
          tag..' row-1 count label at col '..col..' clears row-2 card below it')
      end
    end
  end

  sim.reduced=false
  T.font=savedFont
  print('PASS: grouped card trays stack real cards, omit header outlines, and clear row 2 in both layouts')
end

-- Floating modal-visibility peek toggle on cards overlays across both layouts.
do
  local Button=require('ui.button')
  local function screen(x,y) return x*sim.zoom+sim.ox,y*sim.zoom+sim.oy end
  local function clickBoard(x,y)
    local sx,sy=screen(x,y)
    sim:update(1/60,sim.time+1/60,sx,sy,sim.reduced)
    sim:mousepressed(sx,sy)
    sim:mousereleased(sx,sy)
  end

  local commands=0
  local origCommand=sim.callbacks.command
  sim.callbacks.command=function(...) commands=commands+1;return origCommand(...) end

  for idx,size in ipairs({{1280,800},{480,850}}) do
    local tag=size[1]..'x'..size[2]
    local portrait=size[1]<size[2]
    local baseRev=60+idx*10
    sim:layout(size[1],size[2]);sim:open(false)
    sim.reduced=true
    sim:sync(snapshot(baseRev,{
      row('M','cards','Choose cards (0/1)','Pick a card.','true','peek-'..tag),
      row('O','201','Fuecoco','blue','false','false','sv01-036','pk1'),
      row('O','202','Growlithe','blue','false','false','sv01-030','pk2'),
      row('F','203','Confirm','blue','false','false','',''),
    }))
    frames(5,baseRev)

    local overlay=sim.overlay
    assert(overlay and overlay.kind=='cards',tag..' opens cards overlay')
    assert(overlay:hasPeek(),tag..' cards overlay has peek toggle')
    local f,b=overlay.peekFrame,overlay.peekControl
    assert(f and f.w==68 and f.h==68,tag..' peekFrame is 68x68')
    assert(b and b.w==50 and b.h==50 and b.x==f.x+9 and b.y==f.y+9,tag..' peekControl is 50x50 centered inside peekFrame')
    if not portrait then
      assert(f.x==overlay.x+overlay.w+10 and f.y==overlay.y and f.x+f.w<=sim.boardW,
        tag..' landscape peekFrame sits beside top-right corner on-board')
    else
      assert(f.x==overlay.x+overlay.w-f.w and f.y==overlay.y-f.h-8 and f.y>=8,
        tag..' portrait peekFrame sits directly above top-right corner on-board')
    end

    assert(not sim.peek,tag..' starts with peek disabled')
    local origPanel=Button.panel
    local panelCalls=0
    Button.panel=function(...) panelCalls=panelCalls+1;return origPanel(...) end
    overlay:drawPeek()
    Button.panel=origPanel
    assert(b.icon=='eye_open' and b.colour==T.profile,tag..' drawPeek shows eye_open in profile colour when not peeking')
    assert(panelCalls==3,tag..' drawPeek draws modalFrameRaised via 3 Button.panel calls, got '..panelCalls)

    local drawCalls,peekDrawCalls=0,0
    local origDraw,origDrawPeek=overlay.draw,overlay.drawPeek
    overlay.draw=function(self,...) drawCalls=drawCalls+1;return origDraw(self,...) end
    overlay.drawPeek=function(self,...) peekDrawCalls=peekDrawCalls+1;return origDrawPeek(self,...) end
    sim:draw(shaders)
    assert(drawCalls==1 and peekDrawCalls==1,tag..' sim:draw draws both overlay and peek toggle when not peeking')

    clickBoard(b.x+b.w/2,b.y+b.h/2+overlay:offset())
    assert(sim.peek==true,tag..' clicking peek button enables peek')
    drawCalls,peekDrawCalls=0,0
    sim:draw(shaders)
    assert(drawCalls==0 and peekDrawCalls==1,tag..' sim:draw skips overlay:draw but still calls drawPeek while peeking')
    assert(b.icon=='eye_closed' and b.colour==T.orange,tag..' drawPeek switches to eye_closed in orange while peeking')

    local boardCard=assert(sim.cards[1],tag..' has a board card')
    local csx,csy=screen(boardCard.x,boardCard.y)
    sim:update(1/60,sim.time+1/60,csx,csy,sim.reduced)
    assert(sim.hoverCard==boardCard and sim.popup==boardCard and sim.popupBox,tag..' hovering a board card while peeking sets hoverCard and popup')

    commands=0
    clickBoard(boardCard.x,boardCard.y)
    assert(sim.highlight==nil and sim.peek==true and commands==0,tag..' clicking a board card while peeking does not highlight or fire commands')
    local sidebarBtn=assert(sim.controls[1],tag..' has a sidebar control')
    clickBoard(sidebarBtn.x+sidebarBtn.w/2,sidebarBtn.y+sidebarBtn.h/2)
    assert(sim.highlight==nil and sim.peek==true and commands==0,tag..' clicking a sidebar control while peeking does not fire commands')

    clickBoard(b.x+b.w/2,b.y+b.h/2+overlay:offset())
    assert(sim.peek==false,tag..' clicking peek button again disables peek')

    clickBoard(b.x+b.w/2,b.y+b.h/2+overlay:offset())
    assert(sim.peek==true,tag..' clicking peek button re-enables peek')
    sim:keypressed('escape')
    assert(sim.peek==false,tag..' pressing escape while peeking restores peek=false')

    clickBoard(b.x+b.w/2,b.y+b.h/2+overlay:offset())
    assert(sim.peek==true,tag..' peek enabled before closing overlay')
    overlay.draw,overlay.drawPeek=origDraw,origDrawPeek
    sim:sync(snapshot(baseRev+1))
    assert(sim.overlay==nil and sim.peek==false,tag..' closing overlay resets sim.peek to false')

    sim:sync(snapshot(baseRev+2,{
      row('M','pile','Your discard pile','2 cards.','false','pile-peek-'..tag),
      row('O','211','Switch','blue','true','false','sv01-194','pd1'),
      row('O','212','Potion','blue','true','false','sv01-188','pd2'),
    }))
    frames(5,baseRev+2)
    assert(sim.overlay and sim.overlay.kind=='pile',tag..' opens pile overlay')
    assert(not sim.overlay:hasPeek() and sim.overlay.peekFrame==nil,tag..' pile overlay has no peek toggle or peekFrame')
  end

  sim.reduced=false
  sim.callbacks.command=origCommand
  print('PASS: floating peek toggle placement, wrapper, icon state, and board inspection in both layouts')
end
