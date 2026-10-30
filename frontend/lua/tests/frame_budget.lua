-- Frame budget: bounds the LÖVE calls a late-game table and a builder frame
-- make, the textures each snapshot creates and decodes, and checks that every
-- Canvas and Image is released exactly once and never drawn after release.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local Snapshots=require('support.snapshots')
local Simulator=require('ui.simulator')
local Builder=require('ui.builder')
local CardFrame=require('ui.card_frame')

local function check(ok,message) if not ok then error(message,2) end end
local report={}
local function atMost(name,value,limit)
  report[#report+1]=('%s %g'):format(name,value)
  check(value<=limit,('%s: %s exceeds the budget of %s'):format(name,value,limit))
end
local shader=Stub.shader()
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader}

local sim=Simulator.new({command=function() end,announce=function() end,feedback=function() end,settings=function() end,jiggle=function() end})
local time=10
local function frames(n,mx,my)
  for _=1,n do time=time+1/60;sim:update(1/60,time,mx or -100,my or -100,false);sim:draw(shaders) end
end
-- Every texture the table can still draw.
local function reachable()
  local list={}
  local function add(c) if c and c.texture then list[#list+1]=c.texture end end
  for _,c in ipairs(sim.cards) do add(c) end
  for _,c in ipairs(sim.ghosts) do add(c) end
  for _,p in ipairs(sim.piles) do add(p) end
  for _,p in pairs(sim.pendingPiles or {}) do add(p) end
  for _,c in pairs(sim.attached or {}) do add(c) end
  if sim.overlay then for _,c in ipairs(sim.overlay.cards or {}) do add(c) end end
  return list
end
local function balanced(when)
  local seen,n={},0
  for _,t in ipairs(reachable()) do
    check(not t.released,when..': the table holds a released canvas')
    if not seen[t] then seen[t]=true;n=n+1 end
  end
  check(Stub.live.canvas==n,('%s: %d canvases alive, %d in use'):format(when,Stub.live.canvas,n))
  check(Stub.live.art==0,when..': a decoded scan outlived its rebuild')
end

-- The table's first snapshot with every card's scan cached; copies of a card
-- share one file, as the browser host writes them.
sim:layout(1280,800);sim:open(false)
local raw,order=Snapshots.snapshot({revision=1})
-- The other player's hand, face up after a hot-seat flip, is cached too.
local _,misty=Snapshots.snapshot({flipped=true})
local rows,listed={'1'},{}
for _,list in ipairs({order,misty}) do
  for _,cardId in ipairs(list) do
    if not listed[cardId] then listed[cardId]=true;rows[#rows+1]=cardId..'\t__card_art_'..(#rows)..'.png' end
  end
end
local artRaw=table.concat(rows,'\n')
local files=require('ui.host_constants').mailboxes
Stub.files[files.art]=artRaw
Stub.files[files.simulator]=raw
Stub.reset()
frames(1)
Stub.files[files.simulator]=nil
atMost('table open: decoded files',Stub.get('decode'),24)
atMost('table open: edge pixel reads',Stub.get('imageData.getPixel'),51000)
balanced('table open')

frames(120)
local function perFrame(label,n,mx,my)
  frames(10,mx,my)
  Stub.reset()
  frames(n,mx,my)
  local result={}
  for _,name in ipairs({'g.rectangle','g.polygon','shader.send','shader.hasUniform','font.getWidth','font.getWrap','g.newCanvas','g.newImage','g.setColor'}) do
    result[name]=Stub.get(name)/n
  end
  return result
end
local idle=perFrame('idle',20)
atMost('idle table frame: g.rectangle',idle['g.rectangle'],230)
atMost('idle table frame: shader:send',idle['shader.send'],250)
atMost('idle table frame: hasUniform',idle['shader.hasUniform'],0)
check(idle['g.newCanvas']==0 and idle['g.newImage']==0,'An idle frame creates no textures')

-- An action that leaves both discard piles alone.
Stub.reset()
sim:sync((Snapshots.snapshot({revision=2})))
atMost('action off the piles: new canvases',Stub.get('g.newCanvas'),0)
atMost('action off the piles: decoded files',Stub.get('decode'),0)
frames(60)
balanced('after an action')

-- A new discard top repaints only that pile.
Stub.reset()
sim:sync((Snapshots.snapshot({revision=3,discard=1})))
atMost('new discard top: new canvases',Stub.get('g.newCanvas'),2)
frames(60)
balanced('after a discard')

-- A card sliding to the discard holds the new pile back until it lands; a
-- second snapshot during the slide keeps that waiting pile.
sim:sync((Snapshots.snapshot({revision=31,discard=1,discarded=1})))
check(sim.pendingPiles.you~=nil,'The discard pile waits for the sliding card')
local waiting=sim.pendingPiles.you
balanced('while a card slides to the discard')
Stub.reset()
sim:sync((Snapshots.snapshot({revision=32,discard=1,discarded=1})))
check(sim.pendingPiles.you==waiting,'An unchanged waiting pile is kept')
atMost('snapshot during a slide: new canvases',Stub.get('g.newCanvas'),0)
frames(60)
check(sim.pendingPiles.you==nil,'The waiting pile replaces the shown one when the card lands')
balanced('after the slide')

-- A hot-seat End turn mirrors the table for the next player. Public cards
-- keep their uid, so they keep the face they already painted and appear in
-- place on the mirrored side: no slide, no ghost. Only faces that changed are
-- painted: the next player's hand, a card turned face up, one turned face
-- down, and one whose card changed.
sim:sync((Snapshots.snapshot({revision=40,hide={['opponent-b4']=true}})));frames(60)
balanced('before a hot-seat flip')
local painted={}
for _,c in ipairs(sim.cards) do painted[c.item.id]=c.texture end
local generation=Stub.generation
local repainted={['opponent-b4']='turned face up',['you-b4']='turned face down',['you-b3']='changed card'}
Stub.reset()
-- Inside one face batch, as Simulator:update reads the mailbox.
CardFrame.open()
sim:sync((Snapshots.snapshot({revision=41,flipped=true,hide={['you-b4']=true},cardIds={['you-b3']='sv04-099'}})))
CardFrame.close()
check(sim.viewerSeat=='p2','The flip snapshot seats the other player')
-- One scan each for the six hand cards and the one turned face up.
atMost('hot-seat flip: new canvases',Stub.get('g.newCanvas'),9)
atMost('hot-seat flip: decoded files',Stub.get('decode'),7)
check(#sim.ghosts==0,'A hot-seat flip sends no card to the discard')
local kept=0
local function inPlace(when)
  for _,c in ipairs(sim.cards) do
    check(math.abs(c.x-c.homeX)<1 and math.abs(c.y-c.homeY)<1,('%s: %s slides instead of appearing in place'):format(when,c.item.id))
  end
end
inPlace('hot-seat flip')
for _,c in ipairs(sim.cards) do
  local id=c.item.id
  if repainted[id] then
    check(c.texture~=painted[id] and c.texture.generation>generation,id..' is '..repainted[id]..' but keeps its old face')
  elseif painted[id] then
    check(c.texture==painted[id],id..' repaints a face that did not change');kept=kept+1
  else
    check(c.item.owner=='you' and c.item.zone=='hand' and c.texture.generation>generation,id..' is new to the table but has no fresh face')
  end
end
check(sim.byUid['you:opponent-b4'] and not sim.byUid['you:opponent-b4'].item.hidden,'The face-up card is on the new side')
check(sim.byUid['opponent:you-b4'] and sim.byUid['opponent:you-b4'].item.hidden,'The face-down card is on the new side')
check(kept>=10,'Public cards in play keep their faces across the flip, kept '..kept)
balanced('on a hot-seat flip')
frames(30)
inPlace('after a hot-seat flip')
check(#sim.ghosts==0,'No ghost appears after the flip')
balanced('after a hot-seat flip')
-- The flip back to the first player.
Stub.reset()
sim:sync((Snapshots.snapshot({revision=42})))
atMost('hot-seat flip back: new canvases',Stub.get('g.newCanvas'),10)
inPlace('flip back')
frames(60)
balanced('after the flip back')
-- Evolving gives the stack the Stage card's uid: the Basic's card takes it
-- over in place and repaints its one canvas.
Stub.reset()
sim:sync((Snapshots.snapshot({revision=43,uids={['you-b0']='you-s0'},cardIds={['you-b0']='sv02-033'}})))
check(sim.byUid['you:you-s0'] and sim.byUid['you:you-s0'].item.evolvedFrom,'The evolved card takes over the Basic')
check(#sim.ghosts==0,'Evolving leaves no ghost')
atMost('evolution: new canvases',Stub.get('g.newCanvas'),1)
frames(60)
balanced('after an evolution')

-- A resize empties every Canvas in love.js, so every face must be repainted.
local before=Stub.generation
sim:layout(480,850)
for _,t in ipairs(reachable()) do check(t.generation>before,'A resize repaints every texture the table draws') end
balanced('after a resize')
local portrait=perFrame('portrait',20)
atMost('portrait table frame: g.rectangle',portrait['g.rectangle'],230)
sim:layout(1280,800)
balanced('after a second resize')

-- A targeting prompt with long text.
sim:sync(Snapshots.prompt(4));frames(30)
local prompt=perFrame('prompt',20)
atMost('prompt frame: font:getWidth',prompt['font.getWidth'],2)
atMost('prompt frame: font:getWrap',prompt['font.getWrap'],0)
balanced('after a prompt')

-- The setup screen's dice button.
sim:sync(Snapshots.setup(5,'late'));frames(90)
local setup=perFrame('setup',10)
atMost('setup frame: g.rectangle',setup['g.rectangle'],100)
balanced('after setup')

-- Reopening the table forgets every face.
sim:open(false)
sim:sync((Snapshots.snapshot({revision=1,matchId='again'})));frames(30)
balanced('after reopening')

-- The deck builder with long card and deck names.
local builder=Builder.new({command=function() end,feedback=function() end,announce=function() end})
builder:layout(1280,800)
builder:sync(Snapshots.builder(1))
for _=1,30 do time=time+1/60;builder:update(1/60,time,-100,-100,false);builder:draw(shaders) end
Stub.reset()
for _=1,10 do time=time+1/60;builder:update(1/60,time,-100,-100,false);builder:draw(shaders) end
atMost('builder frame: font:getWidth',Stub.get('font.getWidth')/10,10)
atMost('builder frame: g.polygon',Stub.get('g.polygon')/10,110)

print('PASS: frame budget ('..table.concat(report,'; ')..')')
