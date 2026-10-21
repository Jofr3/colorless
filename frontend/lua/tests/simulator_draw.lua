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
  row('C','card1','sv01-036','Fuecoco','you','hand',0,'false','Pokemon','','Basic','',0,'',0,'','Fire','true'),
  row('C','energy1','sv03-230','Fire Energy','you','hand',1,'false','Energy','','','',0,'',0,'','Fire','true'),
  row('C','tr1','sv01-189','Professor\'s Research','you','hand',2,'false','Trainer','Supporter','','',0,'',0,'','','true'),
  row('C','active1','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,20,'Fire,Fire',1,'burned,asleep','Fire','true'),
  row('C','bench1','sv01-030','Growlithe','you','bench',0,'false','Pokemon','','Basic',70,0,'',0,'','Fire','true'),
  row('C','opp1','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,0,'Water|opp-energy|sv03-230','opp-tool|sv01-191','','Water','false'),
  row('C','oppd','sv01-194','Switch','opponent','discard',0,'false','Trainer','Item','','',0,'',0,'','','false'),
  row('C','used','sv01-181','Nest Ball','you','played',0,'false','Trainer','Item','','',0,'',0,'','','false'),
  row('C','std','sv01-167','Beach Court','global','stadium',0,'false','Trainer','Stadium','','',0,'',0,'','','false'),
  row('C','pz','sv01-030','Growlithe','you','prize',2,'false','Pokemon','','Basic','',0,'',0,'','Fire','false'),
  row('C','h1','hidden','Face-down card','opponent','hand',0,'true','','','','',0,'',0,'','','false'),
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
  for i=1,n do sim:update(1/60,(start or 0)+i/60,sim.mx or -100,sim.my or -100,false);sim:draw(shaders) end
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
    assert(b.colour==(i>3 and require('ui.sim_hud').insetColour or T.red))
  end
  sim:openOptions()
  sim:sync(row(101,'ready','Player 1','Player 2',0,'setup:chooseFirst','','Choose who goes first','',0,0,'you','','p1',0,0,0,'','','','new-match'))
  assert(sim.overlay==nil and sim.gamePhase=='setup:chooseFirst','Restart closes the old overlay and returns to setup')
  assert(sim.matchId=='new-match' and #sim.cards==0,'Restart clears the previous table')
end
print('PASS: Lua simulator draw paths for every table state and overlay kind in both layouts')
