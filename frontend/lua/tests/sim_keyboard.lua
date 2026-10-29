-- The table without a pointer: keyboard focus survives snapshots and the
-- hot-seat flip, Retreat and Prize prompts answer the keyboard, Enter on a
-- card focuses its buttons and Escape returns, focused cards and the
-- inspector say what they show, trays and the log speak, pile trays name
-- their owner, and Reduced Motion keeps the Knock Out notice and lands coins.
package.path='frontend/lua/?.lua;'..package.path
local function font()
  return {getWidth=function(_,s) return #tostring(s)*8 end,getHeight=function() return 20 end,
    getWrap=function(_,s,w) local lines={};local line=''
      for word in tostring(s):gmatch('%S+') do
        if #line+#word+1>w/8 and line~='' then lines[#lines+1]=line;line=word else line=line=='' and word or line..' '..word end
      end
      if line~='' then lines[#lines+1]=line end;return #s*8,lines end}
end
love={math={random=function() return 0.5 end},graphics={},keyboard={isDown=function() return false end},filesystem={getInfo=function() return nil end}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local T=require('ui.theme')
T.font=function() return font() end
local Fx=require('ui.fx')
local banners={}
local attention=Fx.attention
local bannerAt={}
Fx.attention=function(self,args) banners[#banners+1]=args.text;bannerAt[args.text]={x=args.x,y=args.y};return attention(self,args) end
local Simulator=require('ui.simulator')
local function check(ok,message) if not ok then error(message,2) end end

local commands,said={},{}
local sim=Simulator.new({command=function(raw) commands[#commands+1]=raw end,announce=function(t) said[#said+1]=t end,
  feedback=function() end,settings=function() end,jiggle=function() end})
local function last() return said[#said] or '' end
local RS,US='\30','\31'
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
-- o: gamePhase, hint, seat, retreated, names, prizes, discard, rows (extra), drop (uids to leave out),
-- damage (opp1's), actions (A rows instead of End turn).
local function snapshot(rev,o)
  o=o or {}
  local out={row(rev,'ready',o.you or 'Ash',o.opponent or 'Misty',3,o.gamePhase or 'turn:action','','Your turn',o.hint or '',0,1,'you','you',o.seat or 'p1',0,0,o.retreated and 1 or 0,'','','')}
  local cards={
    row('S','you',40,o.prizes or 6,2,o.discard or 2,0),row('S','opponent',40,6,1,o.oppDiscard or 1,0),
    row('C','card1','sv01-036','Fuecoco','you','hand',0,'false','Pokemon','','Basic','',0,'','','','Fire','true',0),
    row('C','active1','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,20,'Fire|e1|sv03-230,Fire|e2|sv03-230','','','Fire','true',0),
    row('C','bench1','sv01-030','Growlithe','you','bench',0,'false','Pokemon','','Basic',70,0,'','','','Fire','true',0),
    row('C','opp1','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,o.damage or 0,'Water|oe|sv03-230','','asleep','Water','false',0),
    row('C','opp2','sv01-052','Quaxly','opponent','bench',0,'false','Pokemon','','Basic',60,0,'','','','Water','false',0),
    row('C','h1','hidden','Face-down card','opponent','hand',0,'true','','','','',0,'','','','','false',0),
    row('I','sv01-033','Pokemon','','Basic',70,'Fire',1,'Water:×2','','','','Bite'..US..'Colorless'..US..'10'..US..''..RS..'Flare'..US..'Fire,Colorless'..US..'30'..US..'Discard an Energy.','','Houndour'),
    row('I','sv01-052','Pokemon','','Basic',60,'Water',1,'Lightning:×2','','','','Splash'..US..'Water'..US..'10'..US..'','','Quaxly'),
    row('K','4','active1','Flare · 30','red','false','','','Fire,Colorless','','true'),
    row('K','5','active1','Retreat','blue',o.retreated and 'true' or 'false','','retreat','Colorless','','true'),
  }
  for _,r in ipairs(cards) do
    local uid=r:match('^C\t([^\t]*)')
    if not (uid and o.drop and o.drop[uid]) then out[#out+1]=r end
  end
  for _,r in ipairs(o.actions or {row('A','6','End turn','red','false','primary')}) do out[#out+1]=r end
  for _,r in ipairs(o.rows or {}) do out[#out+1]=r end
  return table.concat(out,'\n')
end
local time=0
local function frames(n) for _=1,n do time=time+1/60;sim:update(1/60,time,-1000,-1000,sim.reduced) end end
local function tabTo(pred,label)
  for _=1,sim:stopCount()+1 do
    sim:keypressed('tab')
    if pred() then return end
  end
  error('Tab never reached '..label,2)
end
local function onCard(uid) return function() return sim.focusCard and sim.focusCard.item.id==uid end end
local function onControl(label) return function() local b=sim.controls[sim.focus];return b and b.label==label end end

sim:layout(1280,800);sim:open(false)
sim:sync(snapshot(1));frames(5)

-- A focused card keeps focus through a snapshot that changes something else,
-- and Tab goes on to the next card.
tabTo(onCard('bench1'),'the Bench card')
local focused=sim.focus
local expected
for i=focused+1,sim:stopCount() do if not sim:skipStop(i) then expected=i;break end end
local nextUid=select(2,sim:stopAt(expected)).item.id
sim:sync(snapshot(2,{damage=10}));frames(2)
check(sim.focusCard and sim.focusCard.item.id=='bench1','A snapshot keeps keyboard focus on the same card')
check(select(2,sim:stopAt(sim.focus))==sim.focusCard,'The focus index points at the focused card')
sim:keypressed('tab')
check(sim.focusCard and sim.focusCard.item.id==nextUid,'Tab moves on to the next card, not the start of the ring')
-- A control keeps focus when the list before it changes.
tabTo(onControl('End turn'),'End turn')
sim:sync(snapshot(3,{actions={row('A','7','Attack','blue','false','primary'),row('A','8','End turn','red','false','primary')}}));frames(2)
check(sim.controls[sim.focus].label=='End turn','Control focus follows its control, not its index')
-- A public card keeps focus across the hot-seat flip.
tabTo(onCard('opp1'),'the opponent Active')
local flipped=snapshot(4,{seat='p2'}):gsub('\topponent\t','\tthem\t'):gsub('\tyou\t','\topponent\t'):gsub('\tthem\t','\tyou\t')
sim:sync(flipped);frames(2)
check(sim.focusCard and sim.focusCard.item.id=='opp1','Focus survives the hot-seat flip by uid')
sim:sync(snapshot(5));frames(2)
-- A focused card that leaves the table leaves nothing focused.
tabTo(onCard('opp2'),'the opponent Bench')
sim:sync(snapshot(6,{drop={opp2=true}}));frames(2)
check(sim.focus==0 and sim.focusCard==nil,'A card gone from the table clears focus')
print('PASS: keyboard focus survives snapshots, control list changes and the hot-seat flip')

-- Focus says where a card is and how it stands; the hover popup follows it.
tabTo(onCard('opp1'),'the opponent Active')
check(last()=="Quaxly, opponent's Active, 60 of 60 HP, 1 Water Energy, Asleep",'A focused card reads its place, HP, Energy and condition, got '..last())
frames(1)
check(sim.popup==sim.focusCard and sim.popupBox,'The keyboard card shows the hover popup')
tabTo(onCard('active1'),'your Active')
check(last()=='Houndour, your Active, 50 of 70 HP, 2 Fire Energy','got '..last())
-- Enter shows the card's buttons and focuses the first one; Escape returns.
sim:keypressed('return')
check(sim.highlight and sim.highlight.item.id=='active1','Enter selects the card')
local b=sim.controls[sim.focus]
check(b and b.attached and b.label=='Flare · 30','Enter focuses the first attached button')
check(last()=='Flare · 30, costs 1 Fire and 1 Colorless','An attack button reads its cost, got '..last())
sim:keypressed('tab')
check(sim.controls[sim.focus].label=='Retreat' and last()=='Retreat, costs 1 Colorless','Tab reaches Retreat, got '..last())
local before=#said
sim:keypressed('escape')
check(sim.highlight==nil and sim.focusCard and sim.focusCard.item.id=='active1','Escape returns focus to the card')
check(#said==before+1,'Escape reads the card once')
check(last()=='Houndour, your Active, 50 of 70 HP, 2 Fire Energy','Escape reads the card again, got '..last())
-- Retreat invokes its own token, which opens the Bench pick.
sim:keypressed('return');sim:keypressed('tab')
local beforeSend=#said
sim:keypressed('return')
check(commands[#commands]=='invoke\t6\t5','Retreat sends its action, got '..tostring(commands[#commands]))
-- The button's card is not read before the action's own result: it would be
-- the card before the action, and after a hot-seat flip the wrong player's.
check(#said==beforeSend,'A card button sends without reading its card, got '..last())
check(sim.focusCard and sim.focusCard.item.id=='active1','Focus falls back to the button\'s card')
-- A refused Retreat is skipped, and Enter on the card says why.
sim:sync(snapshot(7,{retreated=true}));frames(2)
tabTo(onCard('active1'),'your Active')
sim:keypressed('return')
check(last()=='Flare · 30, costs 1 Fire and 1 Colorless. Unavailable: Retreat, you already retreated this turn','got '..last())
sim:keypressed('tab')
check(sim.controls[sim.focus].label=='View','Tab passes the unavailable Retreat')
sim:keypressed('escape')
-- V opens the inspector on a focused card, which reads the printed card.
said={};sim:keypressed('v')
check(sim.overlay and sim.overlay.kind=='inspect','V inspects the focused card')
check(last():find('^Houndour, your Active, 50 of 70 HP, 2 Fire Energy%. Basic Pokémon, Fire type, 70 HP%. Attack: Bite, costs 1 Colorless, 10 damage%. Attack: Flare, costs 1 Fire and 1 Colorless, 30 damage%. Discard an Energy%. Weakness: Water ×2%. Retreat cost: 1 Colorless%.$'),'The inspector reads the card, got '..last())
sim.overlay:keypressed('escape')
print('PASS: cards read their place and state, Enter focuses their buttons, Escape returns, Retreat answers the keyboard, V inspects')

-- A button that asks for a target says the question as the pick opens.
sim:sync(snapshot(71,{rows={row('K','60','card1','Attach','blue','false','active1','attach','','','false'),
  row('K','61','card1','Attach','blue','false','bench1','attach','','','false')}}));frames(2)
tabTo(onCard('card1'),'the hand card')
sim:keypressed('return')
check(sim.controls[sim.focus].label=='Attach','Enter focuses Attach')
sim:keypressed('return')
check(sim.luaTargeting and last()=='Attach to which Pokémon? Click a highlighted card.','The target pick is announced, got '..last())
sim:keypressed('escape')
check(sim.luaTargeting==nil,'Escape leaves the target pick')
sim:sync(snapshot(72));frames(2)
print('PASS: a target pick says its question')

-- Prize slots join the ring only while a Prize prompt asks.
local function prizeStops() local n=0;for i=1,sim:stopCount() do local _,_,p=sim:stopAt(i);if p then n=n+1 end end;return n end
check(prizeStops()==0,'No Prize stops outside a Prize prompt')
sim:sync(snapshot(8,{rows={row('M','prizes','Choose a Prize','Click one of your Prize cards.','true','p'),
  row('O','20','Prize 1','blue','false','false','','prize:0'),row('O','21','Prize 3','blue','false','false','','prize:2')}}));frames(2)
check(prizeStops()==2,'The prompt\'s two Prizes are focus stops')
tabTo(function() return last()=='Prize 3 of 6' end,'Prize 3')
sim:keypressed('return')
check(commands[#commands]=='invoke\t8\t21','Enter takes the focused Prize, got '..tostring(commands[#commands]))
print('PASS: a Prize prompt puts its face-down Prizes in the ring')

-- An untitled card tray prints and says its instruction.
said={}
sim:sync(snapshot(9,{gamePhase='effect:choose',hint='Search your deck for a Basic Pokémon onto your Bench.',rows={row('M','cards','','','true','search'),
  row('O','30','Fuecoco','blue','false','false','sv01-036','d1'),row('O','31','Growlithe','blue','false','false','sv01-030','d2'),
  row('F','32','0/2','blue','true','false','','')}}));frames(1)
local tray=sim.overlay
check(tray.instructionText=='Search your deck for a Basic Pokémon onto your Bench.','The tray carries the prompt\'s instruction')
check(tray.viewport.y==tray.y+48,'The instruction takes one band above the cards')
check(last()=='Search your deck for a Basic Pokémon onto your Bench. 2 cards.','The tray says its instruction as it opens, got '..last())
-- A toggle says the host's answer: the card, its state and the count.
tray:activate(1)
sim:sync(snapshot(10,{gamePhase='effect:choose',rows={row('M','cards','','','true','search'),
  row('O','30','Fuecoco','blue','false','true','sv01-036','d1'),row('O','31','Growlithe','blue','false','false','sv01-030','d2'),
  row('F','32','1/2','blue','false','false','','')}}));frames(1)
check(sim.overlay==tray and last()=='Fuecoco, selected, 1 of 2','A pick says its selection and count, got '..last())
tray:keypressed('tab')
check(last()=='Fuecoco, selected','Focus on a picked card says it is selected, got '..last())
sim:sync(snapshot(11));frames(1)
print('PASS: card trays print and say their instruction, and picks say what is selected')

-- Pile trays name whose discard they hold; an empty pile does not open.
local function pileControl(owner) for i,c in ipairs(sim.controls) do if c.action=='pile' and c.owner==owner then return i,c end end end
sim:sync(snapshot(12,{oppDiscard=0}));frames(1)
check(select(2,pileControl('opponent')).disabled,'An empty discard pile is disabled')
check(not select(2,pileControl('you')).disabled,'A discard pile with cards is live')
tabTo(function() local x=sim.controls[sim.focus];return x and x.action=='pile' end,'the discard pile')
check(last()=='Your discard pile, 2 cards','A pile reads its owner and size, got '..last())
sim:keypressed('return')
check(commands[#commands]=='pile\tyou','Enter opens the pile')
said={}
sim:sync(snapshot(13,{rows={row('M','pile','','','false','pile'),row('O','40','Switch','blue','true','false','sv01-194','d1'),row('O','41','Potion','blue','true','false','sv01-188','d2')}}));frames(1)
check(sim.overlay.data.title=='Your discard (2)','The pile tray is titled with its owner and count, got '..tostring(sim.overlay.data.title))
check(last()=='Your discard (2). 2 cards.','The pile tray says its title, got '..last())
sim.overlay:keypressed('escape')
sim:sync(snapshot(14,{oppDiscard=1}));frames(1)
sim:activate((pileControl('opponent')))
sim:sync(snapshot(15,{oppDiscard=1,rows={row('M','pile','','','false','pile2'),row('O','42','Switch','blue','true','false','sv01-194','d3')}}));frames(1)
check(sim.overlay.data.title=="Misty's discard (1)",'The opponent\'s pile names them, got '..tostring(sim.overlay.data.title))
sim.overlay:keypressed('escape')
print('PASS: pile trays name their owner and size; an empty pile stays shut')

-- The log reads its newest entries on open, and up and down read the rest.
said={}
sim:sync(snapshot(16,{rows={row('M','log','Game log','turn\t\t\tTurn 1\np1\tAsh\t0:01\tAsh drew 7 cards.\np2\tMisty\t0:02\tMisty attached Water Energy.','false','log')}}));frames(1)
check(last()=='Game log, 3 entries. Latest: Turn 1. Ash: Ash drew 7 cards. Misty: Misty attached Water Energy. Up and down read the log.','The log reads its newest entries, got '..last())
sim.overlay:keypressed('up')
check(last()=='Entry 2 of 3: Ash: Ash drew 7 cards.','Up reads the previous entry, got '..last())
sim.overlay:keypressed('down');sim.overlay:keypressed('down')
check(last()=='Entry 3 of 3: Misty: Misty attached Water Energy.','Down stops at the newest entry, got '..last())
sim.overlay:keypressed('escape')
print('PASS: the Game log speaks its entries')
-- A page turn moves the reading cursor to the page shown: Up and Down read
-- that page's entries, and an entry on another page turns to it and rebuilds,
-- so the arrows name the page that shows.
local entries={}
for i=1,30 do entries[#entries+1]='p1\tAsh\t0:01\tstep '..i end
sim:sync(snapshot(161,{rows={row('M','log','Game log',table.concat(entries,'\n'),'false','log2')}}));frames(1)
local log=sim.overlay
local function arrow(action) for _,c in ipairs(log.controls) do if c.action==action then return c end end end
local firstPage=0
for _,e in ipairs(log.logEntries) do if math.ceil(e.line/log.visible)==1 then firstPage=firstPage+1 end end
check(log.pages==2 and log.page==2,'The long log opens on its last page')
log:keypressed('pageup')
check(log.page==1 and last()=='Page 1 of 2','Page up shows page 1, got '..last())
log:keypressed('up')
check(last()=='Entry '..firstPage..' of 30: Ash: step '..firstPage,'Up after a page turn reads the last entry shown, got '..last())
check(log.page==1,'Reading the page shown keeps it')
check(arrow('prev').speech=='Previous page, page 1 of 2','The arrows name the page shown, got '..tostring(arrow('prev').speech))
log:keypressed('down')
check(last()=='Entry '..(firstPage+1)..' of 30: Ash: step '..(firstPage+1),'Down reads on to the next page, got '..last())
check(log.page==2 and arrow('next').speech=='Next page, page 2 of 2','Reading onto page 2 turns to it and rebuilds the arrows, got '..tostring(arrow('next').speech))
log:keypressed('pageup');log:keypressed('down')
check(last()=='Entry 1 of 30: Ash: step 1','Down after a page turn reads the first entry shown, got '..last())
log:keypressed('pagedown')
check(log.page==2 and last()=='Page 2 of 2','Next page goes forward from the page shown, got '..last())
log:keypressed('escape')
print('PASS: the Game log reads the page it shows after a page turn')

-- Reduced Motion: a static Knock Out notice, and coins that land at once.
sim:sync(snapshot(17));frames(2)
sim.reduced=true;banners={}
local knocked=snapshot(18,{rows={row('D','opp1')},drop={opp1=true}})..'\n'..row('C','opp1','sv01-052','Quaxly','opponent','discard',0,'false','Pokemon','','Basic',60,0,'','','','Water','false',0)
sim:sync(knocked);frames(1)
local named=false;for _,t in ipairs(banners) do if t=='KNOCKED OUT: Quaxly' then named=true end end
check(named,'Reduced Motion still names the knocked-out Pokémon, banners: '..table.concat(banners,', '))
check(sim.koPresentation==nil,'Reduced Motion plays no burn')
local D=require('ui.card_dimensions')
-- The notice marks the victim's own spot: where it stood, or, after a
-- hot-seat flip to the victim, that player's Active in the new layout.
local function at(zone,where)
  local p,z=bannerAt['KNOCKED OUT: Quaxly'],sim.L.zones[zone]
  check(p and math.abs(p.x-z.x)<1 and math.abs(p.y-(z.y-0.6*D.H*z.scale))<1,where..' marks '..zone..', got '..(p and p.x..','..p.y or 'nothing'))
end
at('opp_active','Without a flip the notice')
sim:sync(snapshot(181));frames(2)
bannerAt={}
local swap=function(raw) return (raw:gsub('\topponent\t','\tthem\t'):gsub('\tyou\t','\topponent\t'):gsub('\tthem\t','\tyou\t')) end
sim:sync(swap(snapshot(182,{seat='p2',rows={row('D','opp1')},drop={opp1=true}})..'\n'..row('C','opp1','sv01-052','Quaxly','opponent','discard',0,'false','Pokemon','','Basic',60,0,'','','','Water','false',0)));frames(1)
at('you_active','After the flip to the victim the notice')
sim:sync(snapshot(183));frames(2)
sim:sync(snapshot(19,{rows={row('M','coin','Coin flip','Ash: Heads\nMisty: Tails','true','coin'),row('O','50','Continue','blue','false','false','','')}}));frames(1)
for _,f in ipairs(sim.overlay.flips) do check(f.landed,'Reduced Motion lands every coin on the first frame') end
local Overlay=require('ui.sim_overlay')
local _,lift,landed=Overlay.coinPose(0.3,true)
check(lift==0 and landed,'A reduced coin draws landed, with no lift')
_,lift,landed=Overlay.coinPose(0.3,false)
check(lift>0 and not landed,'A coin spins in the air without Reduced Motion')
print('PASS: Reduced Motion keeps the Knock Out notice and lands coin flips at once')
