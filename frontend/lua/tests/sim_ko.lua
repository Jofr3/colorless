-- The Knock Out presentation on its own: victims, burn order, Prize awards,
-- the handoff pause, and cancel restoring every card it touched.
package.path='frontend/lua/?.lua;'..package.path
local function font()
  return {getWidth=function(_,s) return #tostring(s)*8 end,getHeight=function() return 20 end,
    getWrap=function(_,s) return #tostring(s)*8,{tostring(s)} end}
end
love={math={random=function() return 0.5 end},graphics={},keyboard={isDown=function() return false end},filesystem={getInfo=function() return nil end}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local T=require('ui.theme')
T.font=function() return font() end
local Simulator=require('ui.simulator')
local Model=require('ui.sim_model')
local Ko=require('ui.sim_ko')
local Layout=require('ui.sim_layout')

local sounds={}
local sim=Simulator.new({command=function() end,announce=function() end,feedback=function(name) sounds[#sounds+1]=name end,settings=function() end,jiggle=function() end})
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
local function scene(rev,knocked)
  local out={row(rev,'ready','One','Two',3,'turn:action','','Your turn','',0,1,'you','you','p1',0,0,0,'',''),
    row('S','you',40,knocked and 4 or 6,knocked and 3 or 1,0,0),row('S','opponent',40,6,0,knocked and 3 or 0,0),
    row('C','mine','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,0,'','','','Fire','false',0),
    row('C','held','sv01-033','Houndour','you','hand',0,'false','Pokemon','','Basic','',0,'','','','Fire','false',0)}
  if knocked then
    out[#out+1]=row('C','foe','sv01-052','Quaxly','opponent','discard',0,'false','Pokemon','','Basic',60,0,'','','','Water','false',0)
    out[#out+1]=row('C','foe-e','sv03-230','Fire Energy','opponent','discard',1,'false','Energy','','','',0,'','','','Fire','false',1)
    out[#out+1]=row('C','foe2','sv01-052','Quaxly','opponent','discard',2,'false','Pokemon','','Basic',60,0,'','','','Water','false',2)
    out[#out+1]=row('D','foe2');out[#out+1]=row('D','held');out[#out+1]=row('D','foe');out[#out+1]=row('D','foe2')
  else
    out[#out+1]=row('C','foe','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,50,'Fire|foe-e|sv03-230','','','Water','false',0)
    out[#out+1]=row('C','foe2','sv01-052','Quaxly','opponent','bench',0,'false','Pokemon','','Basic',60,0,'','','','Water','false',0)
  end
  return table.concat(out,'\n')
end
local function check(ok,message) if not ok then error(message,2) end end

sim:layout(1280,800);sim:open(false)
local before=scene(1,false)
sim:sync(before)
for _=1,60 do sim:update(1/60,sim.time+1/60,-100,-100,false) end
local foe,foe2=sim.byUid['opponent:foe'],sim.byUid['opponent:foe2']
local raw=scene(2,true)
local m=Model.parse(raw)

local victims=Ko.victims(m,sim.cards)
check(#victims==2 and victims[1]==foe2 and victims[2]==foe,'Victims follow the engine order, once each, in play only')
local ko=Ko.begin(sim,raw,m,victims)
check(ko.index==1 and foe2.koAnimating and foe2.disintegration and not foe.disintegration,'Only the first victim burns')
check(#foe2.koAttachments==0,'A bare Pokémon burns alone')
check(sounds[#sounds-1]=='whoosh2' and sounds[#sounds]:match('^crumple%d$'),'Each burn starts with the whoosh and a crumple')
check(not ko:returned(m) and ko:returned(Model.parse(before)),'Undo is recognised by a victim back in play')
local later=scene(3,true)
ko:retarget(later,Model.parse(later))
check(ko.raw==later and ko.index==1,'A newer destination keeps the burn going')

local t=sim.time
local done
for _=1,60 do t=t+1/60;sim.time=t;done=ko:update(1/60,t,false) end
check(foe2.koHidden and not foe2.koAnimating and ko.index==2 and foe.disintegration,'The second burn starts when the first ends')
check(#foe.koAttachments==1 and foe.koAttachments[1].item.id=='foe-e','Attached Energy burns with its Pokémon')
check(not done and not ko.prizes,'Prizes wait for the last burn')
for _=1,45 do t=t+1/60;sim.time=t;done=ko:update(1/60,t,false) end
check(ko.waitUntil and ko.prizes and not done,'The last burn starts the handoff pause')
local award=ko:award('you')
check(award.count==2 and award.prizesBefore==6 and award.handBefore==1 and award.handCount==3 and not ko:award('opponent'),'Prizes come from the destination counts')
check(ko:prizeTaken('you',5) and ko:prizeTaken('you',4) and not ko:prizeTaken('you',3) and not ko:prizeTaken('opponent',5),'Only the awarded slots leave the grid')
local completed=ko:completed()
check(completed.foe and completed.foe2 and completed['foe-e'] and not completed.mine,'Burned cards and attachments are complete')
while not done do t=t+1/60;sim.time=t;done=ko:update(1/60,t,false) end
check(t>=ko.waitUntil,'The presentation ends after the pause')
local hand=sim.L.zones.you_hand
local hx,hy=Layout.hand(hand,3,1)
local x,y=ko:prizePosition('you',0)
check(math.abs(x-hx)<1 and math.abs(y-hy)<1,'Prizes land in the hand')
ko:cancel()
for _,c in ipairs({foe,foe2}) do
  check(not c.koHidden and not c.koAnimating and not c.koAttachments and not c.disintegration and not c.dissolve,'Cancel restores '..c.item.id)
end
check(not sim.attached['foe-e'].disintegration,'Cancel restores attached cards')

-- Reduced motion ends the presentation on its first update.
local again=Ko.begin(sim,raw,m,Ko.victims(m,sim.cards))
check(again:update(1/60,t,true),'Reduced motion finishes at once')
again:cancel()
print('PASS: KO presentation')
