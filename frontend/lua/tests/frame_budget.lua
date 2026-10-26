-- Frame budget: bounds the LÖVE calls a late-game table and a builder frame
-- make, the textures each snapshot creates and decodes, and checks that every
-- Canvas and Image is released exactly once and never drawn after release.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local Snapshots=require('support.snapshots')
local Simulator=require('ui.simulator')
local Builder=require('ui.builder')
local Mailbox=require('ui.mailbox')

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
local rows={'1'}
for i,cardId in ipairs(order) do rows[#rows+1]=cardId..'\t__card_art_'..i..'.png' end
local artRaw=table.concat(rows,'\n')
sim.art=Mailbox.artMap(artRaw);sim.artRaw=artRaw
Stub.reset()
sim:sync(raw)
local opened={decode=Stub.get('decode'),canvas=Stub.get('g.newCanvas')}
atMost('table open: decoded files',opened.decode,73)
balanced('table open')

frames(120)
local function perFrame(label,n,mx,my)
  frames(10,mx,my)
  Stub.reset()
  frames(n,mx,my)
  local result={}
  for _,name in ipairs({'g.rectangle','g.polygon','shader.send','shader.hasUniform','font.getWidth','g.newCanvas','g.newImage','g.setColor'}) do
    result[name]=Stub.get(name)/n
  end
  return result
end
local idle=perFrame('idle',20)
atMost('idle table frame: g.rectangle',idle['g.rectangle'],230)
atMost('idle table frame: shader:send',idle['shader.send'],400)
atMost('idle table frame: hasUniform',idle['shader.hasUniform'],400)
check(idle['g.newCanvas']==0 and idle['g.newImage']==0,'An idle frame creates no textures')

-- An action that leaves both discard piles alone.
Stub.reset()
sim:sync((Snapshots.snapshot({revision=2})))
atMost('action off the piles: new canvases',Stub.get('g.newCanvas'),4)
atMost('action off the piles: decoded files',Stub.get('decode'),2)
frames(60)
balanced('after an action')

-- A new discard top repaints only that pile.
Stub.reset()
sim:sync((Snapshots.snapshot({revision=3,discard=1})))
atMost('new discard top: new canvases',Stub.get('g.newCanvas'),4)
frames(60)
balanced('after a discard')

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
atMost('prompt frame: font:getWidth',prompt['font.getWidth'],40)
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
atMost('builder frame: font:getWidth',Stub.get('font.getWidth')/10,200)
atMost('builder frame: g.polygon',Stub.get('g.polygon')/10,110)

print('PASS: frame budget ('..table.concat(report,'; ')..')')
