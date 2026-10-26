-- Model.parse against the snapshots TypeScript publishes, with no LÖVE at all.
package.path='frontend/lua/?.lua;'..package.path
love=nil
local Model=require('ui.sim_model')
local T=require('ui.theme')

local function fixture(name)
  local f=assert(io.open('frontend/lua/tests/fixtures/'..name,'rb'))
  local raw=f:read('*a');f:close()
  return (raw:gsub('\n$',''))
end
local function check(ok,message) if not ok then error(message,2) end end
local function find(list,keep) for _,x in ipairs(list) do if keep(x) then return x end end end
local function count(list,keep) local n=0;for _,x in ipairs(list) do if keep(x) then n=n+1 end end;return n end
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end

check(Model.parse('')==nil,'An empty snapshot has no model')

local m=Model.parse(fixture('sim_snapshot.txt'))
check(m.revision==1 and m.phase=='ready' and m.you=='Ash' and m.opponent=='Misty','Header names the players')
check(m.turn==1 and m.gamePhase=='turn:action' and m.title=='Your turn' and m.hint:find('Attach Energy'),'Header carries the turn and phase')
check(m.viewerSeat=='p1' and m.activePlayer=='you' and m.waiting=='you','Header carries the seats')
check(m.turnIndex==0 and m.turnCount==1 and m.matchId=='100' and m.shuffled=='' and m.outcome=='' and m.outcomeDetail=='','Header carries the history and match id')
check(not m.allow.energy and not m.allow.supporter and not m.allow.retreated and m.allow.partial==false,'Nothing used yet this turn')
check(m.mode=='local' and m.flags.undo and m.flags.concede and m.away.name=='' and m.away.ms=='','Lifecycle row parsed')
check(#m.knockedOut==0 and m.rareCandy==nil and m.menu==nil,'No KO, Rare Candy or prompt on the open table')

check(m.sides.you.deck==42 and m.sides.you.prizes==6 and m.sides.you.discard==0 and m.sides.you.mulligan==0,'Own side counts')
check(m.sides.you.hand==count(m.items,function(i) return i.owner=='you' and i.zone=='hand' end),'Own hand count matches its cards')
check(m.sides.opponent.hand==count(m.items,function(i) return i.owner=='opponent' and i.zone=='hand' and i.hidden end),'Opponent hand is face down')

local active=find(m.items,function(i) return i.owner=='you' and i.zone=='active' end)
check(active.name=='fix-attacker' and active.hp==120 and active.damage==0 and active.types=='Fire' and active.status=='','Own Active parsed')
check(#active.energies==2 and active.energies[1]=='Colorless','Attached Energy kinds parsed')
check(#active.energyCards==2 and active.energyCards[1].id=='p1#50' and active.energyCards[1].cardId=='fix-energy' and active.energyCards[1].kind=='Colorless','Attached Energy cards parsed')
check(active.tools==1 and active.toolCards[1].id=='p1#43' and active.toolCards[1].cardId=='fix-tool','Attached Tool parsed')
local stadium=find(m.items,function(i) return i.zone=='stadium' end)
check(stadium.owner=='global' and stadium.hp==nil and stadium.category=='Trainer' and stadium.trainerType=='Stadium' and not stadium.draggable,'Stadium is a public Trainer')
for _,i in ipairs(m.items) do
  if i.owner=='you' and i.zone=='hand' then check(i.displayIndex==i.index and i.draggable,'Hand card '..i.id..' keeps its order and drags') end
end

check(m.info['sv01-167'].name=='Beach Court' and m.info['sv01-167'].effect:find('Retreat Cost'),'Stadium text parsed')
check(m.info['fix-attacker'].hp=='120' and m.info['fix-attacker'].attacks:find('Flame'),'Pokemon text parsed')
check(m.info['fix-energy'].energyType=='Normal' and m.info['fix-energy'].types=='Colorless','Energy text parsed')

local play=m.cardActions['nest-ball'][1]
check(play.label=='Play' and play.uid=='nest-ball' and not play.disabled and not play.hasCost and play.targetUid=='' and play.group=='','Nest Ball can be played')
local flame=find(m.cardActions[active.id],function(a) return a.label=='Flame' end)
check(flame.hasCost and flame.damage=='60' and flame.cost[1]=='Fire' and flame.cost[2]=='Colorless','Attack button parsed')
local endTurn=find(m.actions,function(a) return a.label=='End turn' end)
check(endTurn.slot=='primary' and not endTurn.disabled and endTurn.colour==T.red,'Sidebar colours resolve to the palette')

local p=Model.parse(fixture('sim_prompt.txt'))
check(p.revision==2 and p.gamePhase=='effect:choose' and p.hint:find('Search your deck'),'Prompt header parsed')
check(p.menu.kind=='cards' and p.menu.mandatory and p.menu.id~='' and p.menu.counterSourceUid=='' and not p.menu.counterTransfer,'Search prompt is a mandatory card menu')
check(#p.menu.options>0 and #p.menu.footer==1 and p.menu.footer[1].label=='0/1','Prompt options and footer parsed')
for _,o in ipairs(p.menu.options) do check(o.uid~='' and o.cardId~='' and o.label~='' and not o.disabled and not o.selected,'Option '..o.token..' names a card') end
check(next(p.cardActions)==nil,'Card buttons hide behind the prompt')

-- Rows the fixtures do not carry.
local header=row(7,'ready','A','B',3,'turn:action','Oops','T','H',2,4,'opponent','opponent','p2',1,1,1,'win','Prizes','both','')
local raw=table.concat({header,
  row('O','orphan','Before any menu','blue','false','false','','',''),
  row('D','x'),row('D','y'),row('D','x'),
  row('R','candy'),
  row('M','board','Pick','Note','false','pick-1','true','src','true'),
  row('O','1','Target','nope','true','true','c1','u1','true'),
  row('F','2','Done','green','false','false','','',''),
  row('Z','unknown tag'),
},'\n')
local x=Model.parse(raw)
check(x.allow.energy and x.allow.supporter and x.allow.retreated and x.allow.partial==nil,'Allowances without a lifecycle row')
check(x.mode==nil and x.flags==nil and x.away==nil,'Mode, flags and away stay unset without a lifecycle row')
check(x.outcome=='win' and x.outcomeDetail=='Prizes' and x.shuffled=='both' and x.matchId=='' and x.message=='Oops','Outcome and shuffle')
check(#x.knockedOut==2 and x.knockedOut[1]=='x' and x.knockedOut[2]=='y','Knock Outs keep engine order, once each')
check(x.rareCandy=='candy','Rare Candy pending')
check(x.menu.kind=='board' and x.menu.id=='pick-1' and x.menu.title=='Pick' and x.menu.note=='Note' and not x.menu.mandatory and x.menu.hideTargetOutline and x.menu.counterSourceUid=='src' and x.menu.counterTransfer,'Board menu parsed')
check(#x.menu.options==1 and x.menu.options[1].colour==T.blue and x.menu.options[1].disabled and x.menu.options[1].selected and x.menu.options[1].dimmed,'Options before the menu row are dropped; unknown colours are blue')
check(#x.menu.footer==1 and x.menu.footer[1].colour==T.green,'Footer row parsed')
-- Card text rows repeat across snapshots; each parse still reads its own text.
local function textOf(name)
  return table.concat({row(1,'ready'),row('I','c1','Pokemon','','Basic',60,'Fire','','','',name,'','','','Card')},'\n')
end
check(Model.parse(textOf('First')).info.c1.effect=='First','Card text parsed')
check(Model.parse(textOf('First')).info.c1.effect=='First','Repeated card text parses the same')
check(Model.parse(textOf('Second')).info.c1.effect=='Second','Changed card text replaces the old text')
for i=1,600 do Model.parse(textOf('Text '..i)) end
check(Model.parse(textOf('First')).info.c1.effect=='First','Card text still parses after many distinct rows')
print('PASS: simulator model')
