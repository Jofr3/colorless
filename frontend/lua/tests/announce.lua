-- What the deck pages say to a screen reader: every focusable control on the
-- builder, library, sandbox and online pages says words, not '' or a bare
-- symbol; one-page pagers leave the Tab order; builder dialogs, value changes
-- and page states are announced.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
require('support.draw_stub').install()
local Codec=require('ui.codec')
local Controls=require('ui.controls')
local Wire=require('ui.wire_fields')
local function check(ok,message) if not ok then error(message,2) end end
local function noop() end

local said,sent={},{}
local function last() return said[#said] or '' end
local function callbacks()
  return {command=function(raw) sent[#sent+1]=Codec.fields(raw) end,announce=function(text) said[#said+1]=text end,
    feedback=noop,home=noop,jiggle=noop,signin=noop,refresh=noop,decks=noop}
end
local function heard(fn) local before=#said;fn();local out={};for i=before+1,#said do out[#out+1]=said[i] end;return out end
-- Words, not an empty string or a lone '<', '>', '-', '+' or 'x'.
local function speakable(text) return type(text)=='string' and text:find('%a%a')~=nil end

-- A row from field names, in the columns wire_fields.lua gives them.
local function row(tag,spec,fields)
  local out={}
  local width=0
  for _,column in pairs(spec) do width=math.max(width,column) end
  for i=1,width do out[i]='' end
  if tag then out[1]=tag end
  for name,value in pairs(fields) do out[assert(spec[name],name)]=Codec.encode(value) end
  return table.concat(out,'\t')
end

-- Tabs through every control twice and checks each stop: it says words, and
-- every control Tab may reach is reached. Returns what the walk said.
local function walk(label,screen,list)
  list=list or 'controls'
  local reachable,reached=0,{}
  for _,b in ipairs(screen[list]) do if not Controls.unfocusable(b) then reachable=reachable+1 end end
  check(reachable>0,label..' has focusable controls')
  local spoken=heard(function()
    for _=1,2*#screen[list] do
      screen:keypressed('tab')
      local b=screen[list][screen.focus]
      check(b and not Controls.unfocusable(b),label..': Tab landed on a control it must skip ('..tostring(b and b.label)..')')
      reached[screen.focus]=true
      check(speakable(last()),label..' control '..screen.focus..' ('..tostring(b.label)..') says '..('%q'):format(last()))
    end
  end)
  local count=0;for _ in pairs(reached) do count=count+1 end
  check(count==reachable,label..': Tab reached '..count..' of '..reachable..' focusable controls')
  return spoken
end
local function stops(screen,pred,list)
  local n=0
  for _,b in ipairs(screen[list or 'controls']) do if pred(b) and not Controls.unfocusable(b) then n=n+1 end end
  return n
end
local function index(screen,pred,list)
  for i,b in ipairs(screen[list or 'controls']) do if pred(b) then return i,b end end
end

-- Builder snapshots: a catalog page of eight prints (two of one card), a deck
-- with an illegal, an unavailable and a loading entry, and filter options.
local B=Wire.builder
local function builderSnapshot(o)
  o=o or {}
  local lines={row(nil,B.header,{revision=o.revision or 1,phase=o.phase or 'ready',name=o.name or 'Fire Deck',
    format=o.format or 'standard',saveStatus='',message=o.message or '',busy=o.busy and 1 or 0,page=o.page or 1,
    pages=o.pages or 3,total=24,count=o.count or 14,selected=o.selected or '',details=o.details or '',transfer='',
    cover='',importing=0,dirty=0,retry=0})}
  for i=1,o.results or 8 do
    local id=i<=2 and 'sv04-0'..(30+i) or 'sv01-0'..(10+i)
    lines[#lines+1]=row('C',B.card,{cardId=id,name=i<=2 and 'Charcadet' or 'Card '..i,supertype='Pokémon',subtype='Basic',
      quantity=i==1 and (o.charcadet or 3) or 0,remaining=1,hp=70,mark='G',number=i<=2 and tostring(30+i) or tostring(10+i),
      copyLimit=4,illegal=0,gaps=''})
  end
  lines[#lines+1]=row('D',B.card,{cardId='sv04-031',name='Charcadet',supertype='Pokémon',subtype='Basic',quantity=o.charcadet or 3,
    remaining=1,hp=70,mark='G',number='31',copyLimit=4,illegal=0,gaps=''})
  lines[#lines+1]=row('D',B.card,{cardId='old-001',name='Old Card',supertype='Trainer',subtype='Item',quantity=2,remaining=2,
    hp='',mark='D',number='1',copyLimit=4,illegal=1,gaps=''})
  lines[#lines+1]=row('D',B.card,{cardId='gone-1',name='Unavailable card',supertype='',subtype='',quantity=1,remaining=0,
    hp='',mark='',number='',copyLimit='',illegal='',gaps=''})
  lines[#lines+1]=row('L',B.pending,{cardId='wait-1',name='Loading card...',quantity=2})
  for i=1,o.deckRows or 8 do
    lines[#lines+1]=row('D',B.card,{cardId='e-'..i,name='Energy '..i,supertype='Energy',subtype='Basic Energy',quantity=1,
      remaining=59,hp='',mark='',number=tostring(i),copyLimit=60,illegal=0,gaps=''})
  end
  if o.selected then
    lines[#lines+1]=row('S',B.card,{cardId=o.selected,name='Charcadet',supertype='Pokémon',subtype='Basic',quantity=o.charcadet or 3,
      remaining=1,hp=70,mark='G',number='31',copyLimit=4,illegal=0,gaps=o.selectedGaps or 'attack'})
  end
  lines[#lines+1]=row('V',B.validation,{message='46 more cards to reach 60.',pokemon=3,trainer=2,energy=8})
  lines[#lines+1]=row('O',B.option,{key='supertype',label='Category',value=o.category or 'All',count=4,index=1,selected=1})
  lines[#lines+1]=row('O',B.option,{key='types',label='Energy type',value='All',count=11,index=1,selected=1})
  lines[#lines+1]=row('F',B.field,{key='sort',value=o.sort or 'name'})
  if o.choices then
    lines[#lines+1]=row('P',B.picker,{key='types',label='Energy type',page=1,pages=2,query=''})
    for i=1,3 do lines[#lines+1]=row('Q',B.choice,{value='v'..i,label='Value '..i,selected=i==1 and 1 or 0}) end
  end
  return table.concat(lines,'\n')
end
local revision=0
local function nextRevision() revision=revision+1;return revision end

local Builder=require('ui.builder')
for _,view in ipairs({{1280,800},{480,850}}) do
  local b=Builder.new(callbacks())
  b:layout(view[1],view[2]);b:sync(builderSnapshot({revision=nextRevision(),choices=true}));b:layout(view[1],view[2])
  local name=view[1]..'x'..view[2]
  local tabs=b.portrait and {'catalog','deck'} or {'catalog'}
  for _,tab in ipairs(tabs) do
    b.tab=tab
    for _,deckView in ipairs({'list','cards'}) do
      b.deckView=deckView;b:build()
      walk('Builder '..name..' '..tab..' '..deckView,b)
    end
  end
  b.deckView='list';b.tab='catalog';b:build()
  for _,mode in ipairs({'detail','transfer','clear','validation','stats','choices'}) do
    b:openModal(mode,b.items[1])
    walk('Builder '..name..' '..mode,b)
    b:closeModal()
  end
  b:openModal('filters')
  for page=1,3 do b.filterPage=page;b:build();walk('Builder '..name..' filters '..page,b) end
  b:closeModal()
end
print('PASS: every builder control, deck row, card, pager, filter and dialog control says words')

do
  local b=Builder.new(callbacks())
  b:layout(1280,800);b:sync(builderSnapshot({revision=nextRevision()}));b:layout(1280,800)
  local function says(pred) local i=index(b,pred);check(i,'Builder has the control');return b:describe(b.controls[i]) end
  check(says(function(c) return c.input and c.arg=='name' end)=='Deck name: Fire Deck. Enter to edit.','The name field says its label and value')
  check(says(function(c) return c.input and c.arg=='query' end)=='Search cards: empty. Enter to edit.','The search field says its label and value')
  local first,second=b:describe(b.controls[index(b,function(c) return c.action=='card' and c.card==1 end)]),
    b:describe(b.controls[index(b,function(c) return c.action=='card' and c.card==2 end)])
  check(first=='Charcadet, SV04 31, 3 in deck','A catalog card says its print and copies: '..first)
  check(second=='Charcadet, SV04 32, not in deck' and first~=second,'Two prints of one card sound different: '..second)
  check(says(function(c) return c.action=='page' and c.arg==-1 end)=='Previous page, page 1 of 3','The catalog pager says its page')
  check(says(function(c) return c.action=='page' and c.arg==1 end)=='Next page, page 1 of 3','The catalog pager says its page')
  check(says(function(c) return c.deckRow and c.arg.id=='sv04-031' end)=='3 x Charcadet','A deck row says its quantity and name')
  check(says(function(c) return c.deckRow and c.arg.id=='old-001' end)=='2 x Old Card, not legal in Standard','A deck row says it is illegal')
  check(says(function(c) return c.deckRow and c.arg.id=='wait-1' end)=='2 x Loading card','A loading row says it is loading')
  check(says(function(c) return c.action=='remove' and c.arg=='sv04-031' end)=='Remove one Charcadet, 3 in deck','Minus says what it removes')
  check(says(function(c) return c.action=='add' and c.arg=='sv04-031' end)=='Add one Charcadet, 3 in deck','Plus says what it adds')
  check(says(function(c) return c.action=='deck-page' and c.arg==1 end)=='Next page, page 1 of 2','The deck pager says its page')
  b:openModal('filters')
  check(says(function(c) return c.cycleKey=='supertype' and c.label=='>' end)=='Category: All, left and right change it','A filter says its option and value')
  check(stops(b,function(c) return c.cycleKey=='supertype' end)==1,'A filter is one Tab stop')
  -- Left and Right on a focused filter step it, and its new value is announced.
  b.focus=index(b,function(c) return c.cycleKey=='supertype' and c.label=='>' end)
  b:keypressed('right');check(sent[#sent][1]=='cycle' and sent[#sent][2]=='supertype' and sent[#sent][3]=='1','Right steps the filter forward')
  b:keypressed('left');check(sent[#sent][1]=='cycle' and sent[#sent][3]=='-1','Left steps the filter back')
  b.focus=index(b,function(c) return c.cycleKey=='format' and c.label=='>' end)
  b:keypressed('left');check(sent[#sent][1]=='format' and sent[#sent][2]=='-1','Left steps the format back')
  b:closeModal()
end
print('PASS: builder fields, prints, rows, row actions, pagers and filters say their label, value and target')

-- One page: the pagers stay drawn and clickable, but Tab passes over them.
do
  local b=Builder.new(callbacks())
  b:layout(1280,800);b:sync(builderSnapshot({revision=nextRevision(),pages=1,deckRows=2}));b:layout(1280,800)
  check(stops(b,function(c) return c.action=='page' or c.action=='deck-page' end)==0,'Single-page pagers leave the Tab order')
  local i,pager=index(b,function(c) return c.action=='page' end)
  check(pager and pager.label=='<' and not pager.disabled,'A single-page pager keeps its face')
  check(b:hit(pager.x+pager.w/2,pager.y+pager.h/2,true)==i,'A single-page pager still answers the pointer')
  walk('Builder single page',b)
  b:sync(builderSnapshot({revision=nextRevision(),pages=3,deckRows=2}))
  check(stops(b,function(c) return c.action=='page' end)==2,'A second page puts the pagers back in the Tab order')
end
print('PASS: one-page builder pagers are skipped by Tab and still drawn and clickable')

-- Each builder dialog says what it shows when it opens.
do
  local b=Builder.new(callbacks())
  b:layout(1280,800);b:sync(builderSnapshot({revision=nextRevision()}));b:layout(1280,800)
  local item=b.items[1]
  b:openModal('detail',item)
  check(last()=='Charcadet. Pokémon Basic, 70 HP. 3 in deck.','The card dialog says the card: '..last())
  local count=#said
  b:sync(builderSnapshot({revision=nextRevision(),selected=item.id,details='Loading card details...'}))
  check(#said==count,'The details placeholder is not read out')
  b:sync(builderSnapshot({revision=nextRevision(),selected=item.id,details='Ember  30\nDiscard an Energy.'}))
  check(last()=='Charcadet. Pokémon Basic, 70 HP. 3 in deck. Not simulated yet: attack effect. Ember 30 Discard an Energy.',
    'The card dialog reads the card text once it arrives: '..last())
  count=#said
  b:sync(builderSnapshot({revision=nextRevision(),selected=item.id,details='Ember  30\nDiscard an Energy.'}))
  check(#said==count,'The card text is read once')
  b:closeModal()
  b:sync(builderSnapshot({revision=nextRevision()}))
  b:openModal('detail',item)
  b:sync(builderSnapshot({revision=nextRevision(),selected=item.id,selectedGaps='',details='Search your deck.'}))
  check(last():find('Search your deck%.$'),'A card with no simulation gaps still reads its card text: '..last())
  b:closeModal()
  b:openModal('stats');check(last():find('^Deck information%. Format: Standard%. Total cards: 14 of 60%.'),'Deck information reads its stats: '..last())
  b:closeModal()
  b:openModal('validation');check(last()=='Deck details. 14 of 60 cards, Standard. 46 more cards to reach 60.','Deck details reads its checks: '..last())
  b:closeModal()
  b:openModal('clear');check(last()=='Clear this deck? All cards will be removed. The deck itself will be kept. Clear deck or Back.','The clear dialog asks: '..last())
  b:closeModal()
  b.filterPage=1;b:openModal('filters');check(last():find('^Filters, Cards tab%.'),'Filters names its tab: '..last())
  b:closeModal()
  b:openModal('transfer');check(last():find('^Import or export decklist%.'),'Import / Export names itself: '..last())
  b:closeModal()
  b:openModal('choices');check(speakable(last()),'The option list names itself')
end
print('PASS: builder card, deck information, deck details, clear, filters and import dialogs announce what they show')

-- A sync announces the option value, sort, page and quantity it changed, once,
-- and nothing while the HP slider is dragged.
do
  local b=Builder.new(callbacks())
  b:layout(1280,800);b:open(true,'deck');b:sync(builderSnapshot({revision=nextRevision()}));b:layout(1280,800)
  check(said[#said-1]=='Deck builder. Opening your deck.' and last()=='Deck builder. Fire Deck, 14 cards.','The builder announces itself and its deck')
  local function change(o,expect,why)
    local spoken=heard(function() b:sync(builderSnapshot(o)) end)
    check(#spoken==1 and spoken[1]==expect,why..': '..table.concat(spoken,' | '))
  end
  change({revision=nextRevision(),category='Trainer'},'Category: Trainer','An option change is announced')
  change({revision=nextRevision(),category='Trainer',format='expanded'},'Format: Expanded','A format change is announced')
  change({revision=nextRevision(),category='Trainer',format='expanded',sort='hp-desc'},'Sort: HP','A sort change is announced')
  change({revision=nextRevision(),category='Trainer',format='expanded',sort='hp-desc',page=3},'Page 3 of 3','A page change is announced')
  change({revision=nextRevision(),category='Trainer',format='expanded',sort='hp-desc',page=3,charcadet=4,count=15},'4 Charcadet in deck','A quantity change is announced')
  local quiet=heard(function() b:sync(builderSnapshot({revision=nextRevision(),category='Trainer',format='expanded',sort='hp-desc',page=3,charcadet=4,count=15})) end)
  check(#quiet==0,'An unchanged sync says nothing')
  b.hpDrag={arg='hpMin'}
  quiet=heard(function() b:sync(builderSnapshot({revision=nextRevision(),page=1,charcadet=4,count=15})) end)
  check(#quiet==0,'Nothing is announced while the HP slider is dragged')
  b.hpDrag=nil
  change({revision=nextRevision(),page=1,results=0,charcadet=4,count=15},'No matching cards','An empty search is announced')
  b:open(true,'deck')
  check(last()=='Deck builder. Opening your deck.','Reopening announces the page again')
  change({revision=nextRevision(),phase='anonymous'},'Deck builder. Sign in to build your deck.','A signed-out builder says so')
end
print('PASS: builder option, format, sort, page, quantity and empty-search changes and page states are announced once')

-- The library.
local L=Wire.library
local function librarySnapshot(o)
  o=o or {}
  local lines={row(nil,L.header,{revision=nextRevision(),phase=o.phase or 'ready',busy=o.busy and 1 or 0,message=o.message or '',
    query=o.query or '',sort=o.sort or 'name-asc',page=o.page or 1,pages=o.pages or 1,total=o.total or o.decks or 3,result=o.result or ''})}
  for i=1,o.decks or 3 do lines[#lines+1]=row('D',L.deck,{id='deck'..i,name='Deck '..i,count=i==2 and 42 or 60,tint=i*30,illegal=i==2 and 1 or 0}) end
  return table.concat(lines,'\n')
end
local Library=require('ui.library')
do
  local l=Library.new(callbacks())
  l:layout(1280,800);l:open(true)
  local spoken=heard(function() l:sync(librarySnapshot({decks=12,total=14,pages=2})) end)
  check(spoken[1]=='Deck library, 14 decks.','Opening the library says how many decks: '..tostring(spoken[1]))
  l:layout(1280,800)
  walk('Library',l)
  local _,prev=index(l,function(b) return b.action=='previous' end)
  check(l:describe(prev)=='Previous page, page 1 of 2','The library pager says its page')
  check(l:describe(l.controls[index(l,function(b) return b.action=='card' and b.card==2 end)])=='Deck 2, 42 cards, not ready to play','A pile says its deck')
  check(heard(function() l:sync(librarySnapshot({decks=2,total=14,pages=2,page=2})) end)[1]=='Page 2 of 2','A library page change is announced')
  check(heard(function() l:sync(librarySnapshot({decks=2,total=14,pages=2,page=2,sort='name-desc'})) end)[1]=='Sort: Name Z-A','A sort change is announced')
  l:openModal('manage',l.items[1]);walk('Library manage',l)
  l:openModal('rename',l.items[1]);walk('Library rename',l)
  check(l:describe(l.controls[index(l,function(b) return b.input end)])=='Deck name: Deck 1. Enter to edit.','The name field says its value')
  l:submit()
  check(heard(function() l:sync(librarySnapshot({decks=2,total=14,pages=2,page=2,sort='name-desc',message='Use 1 to 100 characters for the name.'})) end)[1]=='Use 1 to 100 characters for the name.','A rename the page refuses says why')
  l:submit()
  check(heard(function() l:sync(librarySnapshot({decks=2,total=14,pages=2,page=2,sort='name-desc',message='Use 1 to 100 characters for the name.'})) end)[1]=='Use 1 to 100 characters for the name.','A second refusal is heard again')
  l:submit()
  check(heard(function() l:sync(librarySnapshot({decks=2,total=14,pages=2,page=2,sort='name-desc',result='ok'})) end)[1]=='Deck renamed.','A saved rename is announced')
  check(not l.modal,'A saved rename closes the dialog')
  l:openModal('delete',l.items[1]);walk('Library delete',l)
  l:openModal('create',{kind='deck',name=''});walk('Library create',l)
  l:submit()
  check(heard(function() l:sync(librarySnapshot({decks=2,total=14,pages=2,page=2,sort='name-desc',result='error',message='Your library is full (500 decks). Delete one to make room.'})) end)[1]:find('^Your library is full'),'A full library is announced')
  l:closeModal()
  check(heard(function() l:sync(librarySnapshot({sort='name-desc',decks=0,total=0,query='zzz'})) end)[1]=='No matches. Try another name.','No matches is announced')
  check(heard(function() l:sync(librarySnapshot({sort='name-desc',decks=0,total=0})) end)[1]=='Nothing here yet. Create a deck to get started.','An empty library is announced')
  check(heard(function() l:sync(librarySnapshot({sort='name-desc',phase='error',decks=0,total=0,message='Check your connection, then try again.'})) end)[1]
    =='Deck library. Could not load your decks. Check your connection, then try again.','A failed library says why')
  l:layout(1280,800);walk('Library error',l)
  check(heard(function() l:sync(librarySnapshot({sort='name-desc',phase='anonymous',decks=0,total=0,message='Your session expired. Sign in again.'})) end)[1]
    =='Deck library. Sign in to browse and build your collection. Your session expired. Sign in again.','An expired session is announced')
  check(#heard(function() l:sync(librarySnapshot({sort='name-desc',phase='anonymous',decks=0,total=0,message='Your session expired. Sign in again.'})) end)==0,'A repeated state is not')
  l:layout(1280,800);l:sync(librarySnapshot({sort='name-desc',decks=3,pages=1}))
  check(stops(l,function(b) return b.action=='previous' or b.action=='next' end)==0,'Single-page library pagers leave the Tab order')
  l:open(true)
  check(heard(function() l:sync(librarySnapshot({sort='name-desc',decks=3,pages=1,busy=true})) end)[1]=='Deck library, 3 decks.','Reopening the library announces it again')
end
print('PASS: library controls, pagers, dialogs, phases, empty states, validation, saves and errors are announced')

-- The sandbox chooser.
local S=Wire.sandbox
local function sandboxSnapshot(o)
  o=o or {}
  local lines={row(nil,S.header,{revision=nextRevision(),phase=o.phase or 'ready',busy=0,message=o.message or '',first='deck1',second='deck2',hidden=o.hidden or 0})}
  for i=1,o.decks or 25 do lines[#lines+1]=row('D',S.deck,{id='deck'..i,name='Deck '..i,count=60}) end
  return table.concat(lines,'\n')
end
local Sandbox=require('ui.sandbox')
do
  local s=Sandbox.new(callbacks())
  s:layout(1280,800);s:open(true)
  local spoken=heard(function() s:sync(sandboxSnapshot()) end)
  check(spoken[1]=='Sandbox. 25 decks. Player 1: Deck 1. Player 2: Deck 2.','Opening the sandbox says its decks: '..tostring(spoken[1]))
  walk('Sandbox',s)
  check(s:describe(s.controls[index(s,function(b) return b.card==1 end)])=='Deck 1, selected for Player 1, 60 cards','A pile says its seat')
  check(s:describe(s.controls[index(s,function(b) return b.action=='next' end)])=='Next page, page 1 of 3','The sandbox pager says its page')
  check(heard(function() s:changePage(1) end)[1]=='Page 2 of 3','A sandbox page change is announced')
  s:layout(480,850);walk('Sandbox portrait',s)
  s:layout(1280,800);s:sync(sandboxSnapshot({decks=3}))
  check(stops(s,function(b) return b.action=='previous' or b.action=='next' end)==0,'Single-page sandbox pagers leave the Tab order')
  check(heard(function() s:input('1\tsearch\tzzz\t3\t3\tinput') end)[1]=='No matches','An empty sandbox search is announced')
  s:open(true)
  check(heard(function() s:sync(sandboxSnapshot({decks=3})) end)[1]=='Sandbox. 3 decks. Player 1: Deck 1. Player 2: Deck 2.','Reopening the sandbox announces it again')
  check(heard(function() s:sync(sandboxSnapshot({decks=0})) end)[1]=='No valid decks. Create a deck to play.','No valid decks is announced')
  -- Decks the chooser leaves out are counted, with what a deck needs to be played.
  local why='No valid decks. 2 of your decks aren\'t ready: a deck needs exactly 60 cards and a Basic Pok\195\169mon.'
  local spoken=heard(function() s:sync(sandboxSnapshot({decks=0,hidden=2})) end)
  check(spoken[1]==why,'The hidden decks are announced: '..tostring(spoken[1]))
  check(#heard(function() s:sync(sandboxSnapshot({decks=0,hidden=2})) end)==0,'An unchanged empty state is not repeated')
  spoken=heard(function() s:sync(sandboxSnapshot({decks=0,hidden=1})) end)
  check(spoken[1]=='No valid decks. 1 of your decks isn\'t ready: a deck needs exactly 60 cards and a Basic Pok\195\169mon.','One hidden deck: '..tostring(spoken[1]))
  s:open(true)
  spoken=heard(function() s:sync(sandboxSnapshot({decks=0,hidden=1})) end)
  check(spoken[1]=='Sandbox. No valid decks. 1 of your decks isn\'t ready: a deck needs exactly 60 cards and a Basic Pok\195\169mon.','Opening on the empty state says why: '..tostring(spoken[1]))
  local create=s.controls[index(s,function(b) return b.action=='decks' end)]
  check(create and create.label=='Create a deck','The empty state keeps its Create a deck button')
  -- The note draws between the empty title and the button, inside the tray.
  local printed={}
  local printf=love.graphics.printf
  love.graphics.printf=function(text,x,y,w) printed[#printed+1]={text=text,x=x,y=y,w=w};return printf(text,x,y,w) end
  for _,view in ipairs({{1280,800},{390,844}}) do
    s:layout(view[1],view[2]);printed={};s:draw()
    local note
    for _,p in ipairs(printed) do if p.text:find('aren\'t ready') or p.text:find('isn\'t ready') then note=p end end
    check(note,'The hidden-deck note is drawn at '..view[1])
    local b=s.controls[index(s,function(c) return c.action=='decks' end)]
    check(note.x>=s.area.x and note.x+note.w<=s.area.x+s.area.w,'The note stays inside the tray at '..view[1])
    check(note.y>=b.y+b.h and note.y+60<=s.area.y+s.area.h,'The note sits under Create a deck, in the tray, at '..view[1])
  end
  love.graphics.printf=printf
end
print('PASS: sandbox controls, pagers, seats, empty states and page changes are announced')

-- The online deck picker.
do
  local O=Wire.online
  local Online=require('ui.online')
  local o=Online.new(callbacks())
  o:layout(1280,800);o:open(true,'')
  local function snapshot(decks)
    local lines={row(nil,O.header,{revision=nextRevision(),step='versus',busy=0,message='',code='ABCD',role='host',link='connected',
      countdown='',notice='',deckPhase='ready',name='Ash',account='authenticated',canKick=0,status=''})}
    lines[#lines+1]=row('P',O.seat,{seat='you',present=1,name='Ash',connected=1,ready=0,deckId='',deckName='',hasDeck=0})
    lines[#lines+1]=row('P',O.seat,{seat='opponent',present=1,name='Misty',connected=1,ready=0,deckId='',deckName='',hasDeck=0})
    for i=1,decks do lines[#lines+1]=row('D',O.deck,{id='d'..i,name='Deck '..i,count=60,standard=1,expanded=1,online=1,formatName='Standard'}) end
    o:sync(table.concat(lines,'\n'))
  end
  snapshot(12);o:openPicker();o:update(0,20,-1000,-1000,true)
  walk('Online picker',o,'items')
  check(o:describe(o.items[index(o,function(i) return i.action=='previous' end,'items')])=='Previous page, page 1 of 2. Button.','The online pager says its page')
  check(heard(function() o:changePage(1) end)[1]=='Page 2 of 2','An online page change is announced')
  snapshot(3)
  check(stops(o,function(i) return i.action=='previous' or i.action=='next' end,'items')==0,'Single-page online pagers leave the Tab order')
  walk('Online picker single page',o,'items')
end
print('PASS: online picker controls and pagers say words; single-page pagers leave the Tab order')
