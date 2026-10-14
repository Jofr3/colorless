package.path='frontend/lua/?.lua;'..package.path
love={math={random=function()return 0.5 end},graphics={},keyboard={isDown=function()return false end},filesystem={getInfo=function()return nil end}}
local Card=require('ui.card')
Card.rebuild=function(self)self.texture={release=function()end}end
local T=require('ui.theme')
T.font=function()return{getWidth=function(_,s)return #s*8 end,getWrap=function(_,s)return #s,{s}end}end
local Simulator=require('ui.simulator')
local commands={}
local sim=Simulator.new({command=function(raw)commands[#commands+1]=raw end,announce=function()end,feedback=function()end,settings=function()end})
local raw='1\tready\tPlayer 1\tPlayer 2\t1\tturn:action\t\tYour turn\t0\t1\nS\tyou\t46\t6\t1\nS\topponent\t47\t6\t7\nC\tcard1\tart1\tPokemon\tyou\thand\t0\tfalse\t\t0\t0\t\nA\t1\tEnd turn\tred\tfalse\tfalse\t'
sim:layout(1280,800);sim:open(false);sim:sync(raw)
local card=sim.cards[1]
for i=1,180 do sim:update(1/60,i/60,-100,-100,false)end
local x,y=card.x,card.y
sim:mousepressed(x,y)
sim:update(1/60,3.02,x+50,y-50,false)
assert(card.dragging,'Hand card must drag')
sim:mousereleased(-100,-100)
assert(not card.dragging and sim.drag==nil,'Invalid drop releases the card')
for i=1,180 do sim:update(1/60,3.02+i/60,-100,-100,true)end
assert(math.abs(card.x-card.homeX)<0.01 and math.abs(card.y-card.homeY)<0.01,'Rejected drop returns to hand')
sim:mousepressed(card.x,card.y);sim:update(1/60,7,823,342,false);sim:mousereleased(823,342)
assert(commands[#commands]=='move\tcard1\thand\t0\tactive\t0','Drop uses the correct engine zone and UID')
sim:sync(raw:gsub('^1','2')..'\nM\tChoice\tChoose a card\ttrue\nO\t2\tPokemon\tblue\tfalse\tfalse\tart1\nF\t3\tConfirm\tblue\ttrue\tfalse\t')
assert(sim.menuTitle=='Choice' and sim.mandatory)
assert(sim:cardHit(card.x,card.y)==nil,'Modal blocks table interactions')
for _,b in ipairs(sim.controls)do assert(b.x>=sim.dialog.x and b.x+b.w<=sim.dialog.x+sim.dialog.w,'Control inside dialog')end
sim:layout(480,850)
assert(sim.zoom>0 and sim.ox>=0 and sim.oy>=0,'Small viewport still fits full page')
print('PASS: Lua simulator card movement, drop translation, return motion, modal blocking and viewport layout')
