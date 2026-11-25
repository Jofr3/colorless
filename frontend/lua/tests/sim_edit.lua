-- Headless checks for the table's edit mode: the Edit mode button, the widened column and its
-- gallery, drags from the gallery, the table and a pile tray, and Prize flips.
package.path='frontend/lua/?.lua;'..package.path
local function font()
  return {getWidth=function(_,s) return #tostring(s)*8 end,getHeight=function() return 20 end,
    getWrap=function(_,s) return #s*8,{s} end}
end
love={math={random=function() return 0.5 end},graphics={},keyboard={isDown=function() return false end},filesystem={getInfo=function() return nil end}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local T=require('ui.theme')
T.font=function() return font() end
local Simulator=require('ui.simulator')
local commands={}
local sim=Simulator.new({command=function(raw) commands[#commands+1]=raw end,announce=function() end,feedback=function() end,settings=function() end,jiggle=function() end})
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
local function snapshot(rev,edit,gallery)
  local out={
    row(rev,'ready','Player 1','Player 2',1,'turn:action','','Your turn','',0,1,'you','you','p1',0,0,0,'','','','1'),
    row('S','you',46,6,2,1,0),row('S','opponent',47,6,7,0,0),
    row('C','p1#1','sv01-036','Fuecoco','you','hand',0,'false','Pokemon','','Basic','',0,'','','','Fire','true',0),
    row('C','p1#2','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,0,'','','','Fire','true',0),
    row('C','p1#3','sv01-030','Growlithe','you','bench',0,'false','Pokemon','','Basic',70,0,'','','','Fire','true',0),
    row('C','p1#4','sv01-181','Nest Ball','you','discard',0,'false','Trainer','Item','','',0,'','','','','false',0),
    row('E',edit,'true','',1,3,30,'false','false'),
  }
  for _,r in ipairs(gallery or {}) do out[#out+1]=r end
  return table.concat(out,'\n')
end
local function last() return commands[#commands] end
local function cmd(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
local function control(action) for _,b in ipairs(sim.controls) do if b.action==action then return b end end end
local function click(x,y) sim:mousepressed(x,y);sim:mousereleased(x,y) end
local function drag(x,y,tx,ty,t,motion)
  sim:mousepressed(x,y)
  sim:update(1/60,t,x+20,y+20,not motion)
  sim:update(1/60,t+0.02,tx,ty,not motion)
  sim:mousereleased(tx,ty)
end

sim:layout(1280,800);sim:open(false)
sim:sync(snapshot(1,'off'))
local narrow=sim.L.hud.w
local button=control('edit-open')
assert(button and not button.disabled,'The turn shows a live Edit mode button')
click(button.x+5,button.y+5)
assert(last()=='edit-mode\ton','Edit mode asks the host to open, got '..tostring(last()))

local gallery={row('G','sv01-001','Pineco','Pokemon','','Basic','true'),row('G','sv01-002','Charizard ex','Pokemon','','Stage2','true'),row('G','sv01-181','Nest Ball','Trainer','Item','','true')}
gallery[#gallery+1]=row('N','sv01-003','Bulbasaur','Pokemon','','Basic','true')
gallery[#gallery+1]=row('N','sv01-004','Ivysaur','Pokemon','','Stage1','true')
sim:sync(snapshot(2,'on',gallery))
assert(#sim.galleryNearby==2 and sim.galleryNearby[1].cardId=='sv01-003','Prefetched cards are kept nearest first, off the page')
-- Each frame draws one prefetched face whose scan is staged, so a turned page adopts it.
sim.art={['sv01-003']='a.png',['sv01-004']='b.png'}
local faces=sim:galleryFaces()
sim:preloadGallery()
assert(faces:has(sim:galleryFaceKey(sim.galleryNearby[1])) and not faces:has(sim:galleryFaceKey(sim.galleryNearby[2])),'One prefetched face a frame, nearest first')
sim:preloadGallery()
assert(faces:has(sim:galleryFaceKey(sim.galleryNearby[2])),'The next frame draws the next one')
local turned=sim:galleryItem({cardId='sv01-003',name='Bulbasaur',category='Pokemon',trainerType='',stage='Basic'},1)
local before=faces.count
faces:release(sim:acquireGalleryFace(turned,1))
assert(faces.count==before,'A page turned to adopts the face drawn ahead')
sim.art={}
assert(sim.editing and sim.L.gallery and sim.L.hud.w>narrow,'Editing widens the column and lays out the gallery')
assert(#sim.galleryCards==3,'Each gallery row becomes a card')
local grid=sim:galleryGrid()
assert(grid.cols>=3 and grid.rows>=2,'The gallery holds at least three columns')
assert(sim.galleryCards[1].x<sim.L.hud.x+sim.L.hud.w,'Gallery cards sit in the column')
assert(control('edit-return') and control('edit-search') and control('edit-next') and not control('edit-open') and not control('log'),'The column trades its controls for the gallery\'s')
local paged=false
for _,c in ipairs(commands) do if c:match('^edit%-page\t1\t'..grid.cols*grid.rows..'$') then paged=true end end
assert(paged,'Lua tells the host how many cards a page holds')
assert(sim.galleryCards[1].collection and sim.galleryCards[1].collection.count==3,'Gallery cards fan like the collection rows')
for i=1,30 do sim:update(1/60,1+i/60,-100,-100,true) end
-- The wheel over the column turns the page.
sim.mx,sim.my=sim.L.gallery.x+20,300
sim.wheelPagedAt=nil
sim:wheelmoved(-1)
assert(last()=='edit-page\t2\t'..grid.cols*grid.rows,'The wheel asks for the next page, got '..tostring(last()))
local turned=#commands
sim.wheelPagedAt=nil
sim:wheelmoved(1)
assert(#commands==turned,'The wheel does not turn before page one')

-- A gallery card dropped on the Bench well adds it there.
local g=sim.galleryCards[1]
local bw=sim.L.zones.you_bench.well
drag(g.x,g.y,bw.x+20,bw.y+bw.h/2,2,true)
assert(last()=='edit\tadd\tsv01-001\tbench\t','Gallery to Bench adds the card, got '..tostring(last()))
assert(sim.editLanding,'The drop point is kept for the card it adds')
do
  local drop=sim.editLanding
  sim.reduced=false
  sim:sync(snapshot(2.2,'on',gallery)..'\n'..row('C','p1#e0','sv01-001','Pineco','you','hand',1,'false','Pokemon','','Basic',50,0,'','','','Grass','true',1))
  local added=sim.byUid['you:p1#e0']
  local deck=sim.L.zones.you_deck
  assert(math.abs(added.x-drop.x)<1 and math.abs(added.y-drop.y)<1,'A card added from the gallery enters from its drop point')
  assert(math.abs(added.x-deck.x)>50,'not from the deck')
  assert(sim.editLanding==nil,'The drop point is used once')
  sim:sync(snapshot(2.3,'on',gallery))
end
local dealt=sim.galleryCards[1]
assert(math.abs(dealt.x-dealt.homeX)>1,'Taking a card from the gallery deals its page again')
for i=1,60 do sim:update(1/60,2.1+i/60,-100,-100,true) end
assert(sim.editDrag==nil,'The drag ends on release')
-- A Stage 2 dropped on the Active evolves it, no rules asked.
local active=sim.byUid['you:p1#2']
drag(sim.galleryCards[2].x,sim.galleryCards[2].y,active.x,active.y,3)
assert(last()=='edit\tadd\tsv01-002\tonto\t-1','Gallery onto the Active lands on it, got '..tostring(last()))
-- The Benched Pokémon dropped on the Active swaps the two.
local bench=sim.byUid['you:p1#3']
drag(bench.x,bench.y,active.x,active.y,4)
assert(last()==cmd('edit','move','p1#3','onto','-1'),'Bench onto the Active swaps them, got '..tostring(last()))
-- A hand card dropped back on the gallery leaves the game; one dropped on the discard goes there.
local hand=sim.byUid['you:p1#1']
drag(hand.x,hand.y,sim.L.gallery.x+40,300,5)
assert(last()==cmd('edit','remove','p1#1'),'Table card onto the gallery removes it, got '..tostring(last()))
-- The host's answer takes the card out: it burns away where it was dropped, not toward the discard.
do
  local removedCard=hand
  local at={x=removedCard.x,y=removedCard.y}
  sim.reduced=false
  local rows={}
  for line in snapshot(5.5,'on',gallery):gmatch('[^\n]+') do if not line:find('p1%%231',1) then rows[#rows+1]=line end end
  sim:sync(table.concat(rows,'\n'))
  local ghost
  for _,c in ipairs(sim.ghosts) do if c.item.id=='p1#1' then ghost=c end end
  assert(ghost and ghost.disintegration and ghost.ghost.burning,'The removed card burns away')
  assert(math.abs(ghost.ghost.target.x-at.x)<1 and math.abs(ghost.ghost.target.y-at.y)<1,'where it was dropped')
  for i=1,60 do sim:update(1/60,5.5+i/60,-100,-100,false) end
  local left=false
  for _,c in ipairs(sim.ghosts) do if c.item.id=='p1#1' then left=true end end
  assert(not left,'and is gone once burnt')
  sim:sync(snapshot(5.6,'on',gallery))
  for i=1,30 do sim:update(1/60,6.6+i/60,-100,-100,true) end
  hand=sim.byUid['you:p1#1']
end
local dw=sim.L.zones.you_discard.well
drag(hand.x,hand.y,dw.x+dw.w/2,dw.y+dw.h/2,6)
assert(last()==cmd('edit','move','p1#1','discard',''),'Hand to discard moves it, got '..tostring(last()))
-- A gallery card dropped on the gallery is not sent.
local before=#commands
drag(g.x,g.y,g.x+5,g.y+60,7)
assert(#commands==before,'Gallery onto the gallery sends nothing')
-- A face-down Prize click turns it over.
local pz=sim.L.zones.you_prizes
local Layout=require('ui.sim_layout')
local px,py=Layout.prize(pz,1)
click(px,py)
assert(last()=='edit\tflip\t1','A Prize click flips that slot, got '..tostring(last()))
-- The "View Prize" badge names the Prize under the pointer.
sim.mx,sim.my=px,py
assert(sim:editPrizeHit(sim.mx,sim.my)==1,'The pointer is over the Prize the badge names')
-- A revealed Prize click turns it back face down.
sim.reduced=false
sim:sync(snapshot(2.5,'on',gallery)..'\n'..row('C','p1#30','sv01-030','Growlithe','you','prize',1,'false','Pokemon','','Basic',70,0,'','','','Fire','true',1))
local revealed=sim.byUid['you:p1#30']
assert(sim.prizeFlips['you:1'] and sim.prizeFlips['you:1'].faceUp,'Revealing a Prize starts its flip')
for i=1,60 do sim:update(1/60,7.2+i/60,-100,-100,false) end
assert(sim:prizeFlip('you',1)==nil,'The flip ends')
assert(revealed,'The revealed Prize is on the table')
click(revealed.x,revealed.y)
assert(last()=='edit\tflip\t1','A revealed Prize click flips it back, got '..tostring(last()))
local pzx,pzy=Layout.prize(sim.L.zones.you_prizes,1)
assert(math.abs(revealed.x-pzx)<1 and math.abs(revealed.y-pzy)<1,'A revealed Prize turns over in its slot rather than sliding from the deck')
sim.reduced=false
sim:sync(snapshot(2.6,'on',gallery))
assert(sim.prizeFlips['you:1'] and not sim.prizeFlips['you:1'].faceUp and sim.prizeFlips['you:1'].card,'Turning it down flips its face over in place')
for i=1,30 do sim:update(1/60,8.3+i/60,-100,-100,true) end
assert(sim:prizeFlip('you',1)==nil,'That flip ends too')
-- The deck well opens the deck tray.
local kw=sim.L.zones.you_deck.well
click(kw.x+kw.w/2,kw.y+kw.h/2)
assert(last()=='pile\tdeck' and sim.pileOwner=='deck','The deck well opens the deck tray, got '..tostring(last()))

-- The tray opens beside the gallery, and cards move between the two.
local tray=table.concat({snapshot(3,'on',gallery),row('M','pile','','',false,'9'),row('O','','Rare Candy','blue',true,false,'sv01-191','p1#9','false',1)},'\n')
sim:sync(tray)
assert(sim.overlay and sim.overlay.kind=='pile' and sim:editTray(),'The deck tray is an edit tray')
assert(sim.overlay.x>sim.L.table.x,'The tray sits over the table, right of the gallery')
for i=1,40 do sim:update(1/60,8+i/60,-100,-100,true) end
-- Behind the tray the table is inert: its cards and controls take nothing, and a drop there lands nowhere.
local tc=sim.overlay.cards[1]
local sent=#commands
sim:mousepressed(tc.x,tc.y)
sim:update(1/60,8.9,tc.x+30,tc.y+30,true)
assert(tc.editHidden,'A card lifted out of the tray leaves its place empty')
sim:mousereleased(tc.x+30,tc.y+30)
assert(not tc.editHidden,'and fills it again once dropped back')
sent=#commands
drag(tc.x,tc.y,hand.x,hand.y,9)
assert(#commands==sent,'A tray card dropped on the table sends nothing')
drag(hand.x,hand.y,sim.L.gallery.x+40,300,9.5)
assert(#commands==sent,'A table card does not drag while the tray is open')
click(kw.x+kw.w/2,kw.y+kw.h/2)
assert(#commands==sent,'The table\'s wells take no click while the tray is open')
assert(sim:hit(control('edit-return').x+5,control('edit-return').y+5)>0,'The column stays live')
-- Between the tray and the gallery cards still move both ways.
drag(tc.x,tc.y,sim.L.gallery.x+40,300,9.7)
assert(last()==cmd('edit','remove','p1#9'),'Tray card onto the gallery removes it, got '..tostring(last()))
local o=sim.overlay
drag(g.x,g.y,o.x+o.w/2,o.y+o.h/2,10)
assert(last()=='edit\tadd\tsv01-001\tdeck\t','Gallery card onto the deck tray adds it to the deck, got '..tostring(last()))

-- Back closes edit mode; the host's off snapshot restores the column.
click(control('edit-return').x+5,control('edit-return').y+5)
assert(last()=='edit-mode\toff','Return asks the host to close, got '..tostring(last()))
sim:sync(snapshot(4,'off'))
assert(not sim.editing and sim.L.hud.w==narrow and #sim.galleryCards==0 and control('edit-open'),'Off restores the column and the button')
-- With room beside the board the widened column and the table move as one, centred; without,
-- only the shortfall narrows the table.
do
  local L=require('ui.sim_layout')
  local plain,wide=L.desktop(1280,800,false,160),L.desktop(1280,800,true,160)
  assert(wide.hud.w>plain.hud.w,'The column widens')
  assert(wide.table.w==plain.table.w and wide.zones.you_bench.well.w==plain.zones.you_bench.well.w,'The table and its Bench keep their size')
  local left,right=math.huge,-math.huge
  for _,z in pairs(wide.zones) do if z.well and not z.hidden then left=math.min(left,z.well.x);right=math.max(right,z.well.x+z.well.w) end end
  local function firstWell(L) local m=math.huge;for _,z in pairs(L.zones) do if z.well and not z.hidden then m=math.min(m,z.well.x) end end;return m end
  assert(math.abs((left-(wide.hud.x+wide.hud.w))-(firstWell(plain)-(plain.hud.x+plain.hud.w)))<0.01,'The table sits beside the column as it does outside edit mode')
  local gapLeft,gapRight=wide.hud.x+160,1280+160-right
  assert(math.abs(gapLeft-gapRight)<0.01,'The column and table are centred in the room, got '..gapLeft..' and '..gapRight)
  local tight,tightEdit=L.desktop(1280,800),L.desktop(1280,800,true)
  assert(tightEdit.hud.x>=4 and tightEdit.table.x>tight.table.x,'With no margin the table gives way')
end
print('PASS: simulator edit mode')
