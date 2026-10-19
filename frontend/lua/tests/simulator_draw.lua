-- Draw-path smoke test: every table state renders with a no-op LÖVE graphics
-- stub, so nil fields and bad arithmetic in draw code fail here, not in WASM.
package.path='frontend/lua/?.lua;'..package.path
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
local shaders={dissolve=shader,foil=shader,holo=shader,polychrome=shader}
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
  row('C','opp1','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,0,'Water',0,'','Water','false'),
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
  sim:sync(snapshot(2,{row('M','list','Choose an attack','Pick one.','false','m1'),row('O','9','Bite · 10','red','false','false','',''),row('O','10','Flare · 30','red','true','false','',''),row('F','11','Confirm','blue','false','false','','')}));frames(5,8)
  sim:sync(snapshot(3,{row('M','cards','Choose cards (1/2)','Pick.','true','m2'),row('O','12','Fuecoco','blue','false','true','sv01-036','x1'),row('O','13','Growlithe','blue','true','false','sv01-030','x2'),row('F','14','Confirm','blue','false','false','','')}));frames(5,9)
  local oc=sim.overlay.cards[1];at(oc.homeX,oc.homeY)
  sim:sync(snapshot(4,{row('M','coin','Coin flip','Player 1: Heads\nPlayer 2: Tails','true','m3'),row('O','15','Continue','blue','false','false','','')}));frames(80,10)
  sim:sync(snapshot(5,{row('M','log','Game log','Turn 1\n0:01 Player 1 drew 7 cards.\n0:02 Player 1 attached Fire Energy.','false','m4')}));frames(5,12)
  sim:sync(snapshot(6,{row('M','pile','Your discard pile','3 cards.','false','m5'),row('O','16','Switch','blue','true','false','sv01-194','d1'),row('O','17','Potion','blue','true','false','sv01-188','d2')}));frames(5,13)
  sim:sync(snapshot(7,{row('M','board','Choose a Pokémon','Pick one','false','m6'),row('O','18','Houndour','blue','false','true','sv01-033','active1'),row('F','19','Confirm','blue','false','false','','')}));frames(5,14)
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
print('PASS: Lua simulator draw paths for every table state and overlay kind in both layouts')
