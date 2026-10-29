package.path='frontend/lua/?.lua;'..package.path
love={math={random=function()return 0.5 end},graphics={newFont=function(_,size)return {getWidth=function(_,value)return #value*size*0.5 end,setFilter=function()end}end},keyboard={isDown=function()return false end}}
local Card=require('ui.card');Card.rebuild=function(self)self.texture={release=function()end}end
local Builder=require('ui.builder')
local Codec=require('ui.codec')
local commands={};local b=Builder.new({command=function(raw)commands[#commands+1]=Codec.fields(raw)end,feedback=function()end,announce=function()end})
local function snapshot(rev,n)
 local lines={table.concat({rev,'ready','Test Deck','standard','','','0','1','2','16','8','','','', '', '0','0','0'},'\t')}
 for i=1,n do lines[#lines+1]='C\tc'..i..'\tCard '..i..'\tPokemon\tBasic\t1\t3\t60\tH\t1' end
 for i=1,12 do lines[#lines+1]='D\td'..i..'\tDeck card '..i..'\tPokemon\tBasic\t1\t3' end
 for i=1,10 do lines[#lines+1]='O\tf'..i..'\tFilter '..i..'\tAll' end
 lines[#lines+1]='S\tc1\tCard 1\tPokemon\tBasic\t1\t3\t60\tH\t1'
 return table.concat(lines,'\n')
end
local function bounds()
 for _,c in ipairs(b.controls)do assert(c.x>=0 and c.y>=0 and c.x+c.w<=b.width and c.y+c.h<=b.height,c.action..' outside viewport')end
end
for _,view in ipairs({{1280,800,8},{480,850,4}})do
 b:closeModal();b:layout(view[1],view[2]);b:sync(snapshot(view[1],view[3]));b:layout(view[1],view[2]);bounds()
 for _,mode in ipairs({'detail','filters','choices','transfer','clear','validation','stats'})do
  b.transferMode='import';b:openModal(mode,b.items[1]);bounds()
  for _,c in ipairs(b.controls)do assert(c.x>=b.modal.x and c.y>=b.modal.y and c.x+c.w<=b.modal.x+b.modal.w and c.y+c.h<=b.modal.y+b.modal.h,mode..' has out-of-modal control '..c.action)end
  assert(b.baseControls[1].action=='leave');b:closeModal()
 end
end
b:layout(1280,800);b:sync(snapshot(3000,8));b:layout(1280,800)
local c=b.cards[1];b:mousepressed(c.x,c.y);assert(b.drag)
b.drag.active=true;c.dragging=true;b:mousereleased(950,350)
assert(commands[#commands][1]=='add' and commands[#commands][2]=='c1');assert(not c.dragging)
local before=#commands;b:mousepressed(c.x,c.y);b.drag.active=true;c.dragging=true;b:mousereleased(500,350);assert(#commands==before)
b:open(false,'test');assert(b:offset()==600)
local back=b.controls[1];assert(b:hit(back.x+2,back.y+2)~=1,'Hit test must follow entrance motion')
print('PASS: builder responsive bounds, nested dialogs, drag-to-add target and modal motion')
local tabs=Builder.new({command=function(raw)commands[#commands+1]=Codec.fields(raw)end,feedback=function()end,announce=function()end})
tabs:layout(1280,800);tabs:sync(snapshot(4000,8))
local mixed=snapshot(4001,8)..'\nD\tt1\tTrainer one\tTrainer\tSupporter\t2\t2\nD\te1\tEnergy one\tEnergy\tBasic Energy\t5\t94\nD\tu1\tUnavailable\t\t\t1\t0'
tabs:sync(mixed)
local function choose(kind)
 for i,c in ipairs(tabs.controls)do if c.action=='deck-type' and c.arg==kind then tabs:activate(i);return end end
 error('Missing deck type '..kind)
end
local beforeTabs=#commands
tabs.deckPage=2;choose('Trainer')
assert(tabs.deckPage==1 and #tabs:visibleDeck()==1 and tabs:visibleDeck()[1].id=='t1')
for _,c in ipairs(tabs.controls)do if c.action=='detail' then assert(c.arg.id=='t1','Row controls must target the filtered card')end end
choose('Pokémon');assert(#tabs:visibleDeck()==12,'Pokémon and ASCII Pokemon share the category')
tabs.deckPage=2;tabs:build();local rows=0
for _,c in ipairs(tabs.controls)do if c.action=='detail' then rows=rows+1 end end
assert(rows==3,'Filtered pagination must use nine desktop rows')
choose('Energy');assert(#tabs:visibleDeck()==1)
tabs:sync(snapshot(4002,8));assert(#tabs:visibleDeck()==0 and tabs.deckPage==1,'Removing a category must clamp its page')
choose('all');tabs:sync(mixed);assert(#tabs:visibleDeck()==15,'All must retain unavailable entries')
assert(#commands==beforeTabs,'Filtering must not mutate the deck or catalog')
print('PASS: deck type filters, stable row identities, filtered pagination, empty categories and read-only tab changes')

local function activate(action,arg)
 for i,c in ipairs(tabs.controls)do if c.action==action and (arg==nil or c.arg==arg)then tabs:activate(i);return end end
 error('Missing control '..action)
end
choose('Pokémon');tabs.deckPage=2;tabs:build();activate('deck-view')
assert(tabs.deckView=='cards' and tabs.deckPage==2 and tabs:deckPageSize()==6)
assert(#tabs.deckCards==6 and tabs.deckCards[3].item.id=='d9','Switching views must retain the first visible entry')
assert(commands[#commands][1]=='preview-cards' and commands[#commands][2]=='d7\nd8\nd9\nd10\nd11\nd12')
assert(tabs.deckCards[1].collection.y==tabs.deckCards[3].collection.y and tabs.deckCards[4].collection.y>tabs.deckCards[3].collection.y,'Grid must have three cards per row')
activate('deck-page',-1);assert(tabs.deckCards[1].item.id=='d1' and tabs.deckPageText.value=='Page 1/2')
for i,c in ipairs(tabs.controls)do if c.action=='deck-card' then tabs:activate(i);break end end
assert(tabs.modal.mode=='detail' and tabs.modal.id=='d1' and commands[#commands-1][2]=='d1','Card view must inspect the correct entry')
tabs:closeModal();choose('Trainer');assert(#tabs.deckCards==1 and tabs.deckCards[1].item.id=='t1')
for _,view in ipairs({{1280,800},{480,850}})do
 tabs.tab='deck';tabs:layout(view[1],view[2])
 local px,py=tabs:deckPager()
 for _,c in ipairs(tabs.controls)do
  assert(c.x>=0 and c.y>=0 and c.x+c.w<=tabs.width and c.y+c.h<=tabs.height)
  if c.action=='deck-view'then assert(c.x==px+256 and c.y==py and c.h==36)end
 end
end
activate('deck-view');assert(tabs.deckView=='list' and #tabs.deckCards==0 and tabs.deckType=='Trainer')
assert(commands[#commands][1]=='preview-cards' and commands[#commands][2]=='','Returning to the list releases preview artwork')
print('PASS: compact deck paginator, card view pagination, inspection, category filtering and responsive toggle')

local Stats=require('ui.deck_stats')
local example={format='standard',count=9,groups={7,2,0},deck={
 {name='Pikachu',kind='Pokemon',subtype='Basic',quantity=3},
 {name='Pikachu',kind='Pokémon',subtype='Basic',quantity=1},
 {name='Raichu',kind='Pokémon',subtype='Stage 1',quantity=3},
 {name='Supporter',kind='Trainer',subtype='Supporter',quantity=2},
}}
local left,right=Stats.rows(example)
assert(#left==3 and #right==3 and left[2].value=='9/60' and left[3].value=='4')
assert(right[1].value=='7' and right[1].suffix==' (77%)')
example.count=0;example.deck={};example.groups={0,0,0};left,right=Stats.rows(example)
assert(left[3].value=='0' and right[2].progress==0 and right[2].suffix==' (0%)')
for _,format in ipairs({'expanded','unknown'})do
 assert((Stats.rows({format=format,count=60,groups={0,0,0},deck={}}))[2].value=='60/60')
end
local deckTab;for _,c in ipairs(tabs.controls)do if c.action=='tab' and c.arg=='deck' then deckTab=c.label end end
assert(deckTab=='Deck '..tabs.count..'/60')
activate('deck-info');assert(tabs.modal.mode=='stats')
assert(#tabs.controls==1 and tabs.controls[1].action=='close','Stats only has the Back button')
local sx,sy,sw,rx,ry=Stats.layout(tabs.modal)
assert(sx==rx and sw==tabs.modal.w-48 and ry+2*58+53<tabs.controls[1].y,'Single-column rows must fit above Back')
tabs:closeModal();assert(not tabs.modal and tabs.deckType=='Trainer','Closing information must preserve the builder view')
print('PASS: compact single-column deck statistics, empty composition and Back navigation')

local T=require('ui.theme')
for _,view in ipairs({{1280,800},{480,850}})do
 tabs:layout(view[1],view[2]);tabs:openModal('filters')
 for page=1,3 do
  tabs.filterPage=page;tabs:build()
  local tabCount,cycles=0,0
  local cycleControls={}
  for _,c in ipairs(tabs.controls)do
   assert(c.x>=tabs.modal.x and c.y>=tabs.modal.y and c.x+c.w<=tabs.modal.x+tabs.modal.w and c.y+c.h<=tabs.modal.y+tabs.modal.h)
   if c.action=='filter-tab'then tabCount=tabCount+1;assert(c.colour==T.red and c.h==48)end
   if c.cycleCentre then cycles=cycles+1;cycleControls[cycles]=c;assert(c.w==(tabs.portrait and 116 or 192) and c.h==38.4)end
  end
  assert(tabCount==3 and cycles==(page==1 and 7 or page==2 and 4 or 0))
  if page<3 then
   assert(cycleControls[1].y==cycleControls[2].y and cycleControls[2].x>cycleControls[1].x+cycleControls[1].w+36,'Filter rows must have two separate columns')
   assert(cycleControls[3].x==cycleControls[1].x and cycleControls[3].y>cycleControls[1].y,'Third filter begins the next row')
  end
 end
 tabs:closeModal()
end
print('PASS: settings-style filter tabs and compact cycles fit all tabs in both layouts')

tabs.reduced=true;tabs:layout(1280,800);tabs.filterPage=3;tabs:openModal('filters')
local sliders={}
for i,c in ipairs(tabs.controls)do
 assert(c.action~='sort','Text tab must not contain sorting')
 if c.action=='hp-slider'then sliders[c.arg]={control=c,index=i}end
end
assert(sliders.hpMin and sliders.hpMax)
local low=sliders.hpMin.control;local high=sliders.hpMax.control
tabs:mousepressed(low.x+low.w*0.3,low.y+20)
assert(tabs.hpDrag and tabs.fields.hpMin=='120')
tabs:mousereleased(low.x+low.w*0.4,low.y+20)
assert(not tabs.hpDrag and tabs.fields.hpMin=='160' and commands[#commands][1]=='filter')
tabs:setHP('hpMax',300);tabs:setHP('hpMin',390);assert(tabs.fields.hpMin=='300','Minimum must not exceed maximum')
tabs:setHP('hpMax',50);assert(tabs.fields.hpMax=='300','Maximum must not fall below minimum')
tabs.focus=sliders.hpMin.index;tabs:keypressed('home');assert(tabs.fields.hpMin=='')
tabs:keypressed('right');assert(tabs.fields.hpMin=='10' and tabs.focus==sliders.hpMin.index)
tabs:keypressed('left');assert(tabs.fields.hpMin=='')
tabs.focus=sliders.hpMax.index;tabs:keypressed('end');assert(tabs.fields.hpMax=='')
tabs:mousepressed(high.x+high.w/2,high.y+20);assert(tabs.hpDrag)
tabs:closeModal();assert(not tabs.hpDrag,'Closing the modal cancels slider drag')
tabs:openModal('filters');tabs:mousepressed(high.x+high.w/2,high.y+20);assert(tabs.hpDrag)
local sentHP=#commands;tabs:cancelInteractions()
assert(not tabs.hpDrag and not tabs.pressed,'A page change cancels the slider drag')
tabs:mousereleased(high.x+high.w*0.9,high.y+20);assert(#commands==sentHP,'A cancelled slider sends no filter')
tabs:closeModal()
print('PASS: HP sliders support drag, ten-point keyboard steps, unbounded endpoints and valid ranges')

tabs.filterPage=1;tabs:openModal('filters')
local beforeFilterClick=#commands
for i,c in ipairs(tabs.controls)do
 if c.cycleCentre then
  assert(tabs:hit(c.x+c.w/2,c.y+c.h/2)~=i,'Filter value must not be clickable')
  assert(tabs:hit(c.x+c.w/2,c.y+c.h/2,false,true)==i,'Filter value must retain hover detection')
  tabs:activate(i);assert(tabs.modal.mode=='filters')
 end
end
assert(#commands==beforeFilterClick,'Filter values must not send picker or format commands')
print('PASS: filter centers are inert; arrow controls remain available')

local flagged=snapshot(5000,8)..'\nD\tx1\tOld card\tPokemon\tBasic\t2\t2\t60\tE\t1\t4\t1\nD\tx2\tNew card\tPokemon\tBasic\t2\t2\t60\tH\t1\t4\t0'
tabs.deckType='all';tabs.deckView='list';tabs.deckPage=1;tabs:sync(flagged);tabs:closeModal()
local byId={};for _,item in ipairs(tabs.deck)do byId[item.id]=item end
assert(byId.x1.illegal==true and byId.x2.illegal==false and byId.d1.illegal==false,'Row legality follows the illegal field')
local alerts=0;for _,c in ipairs(tabs.controls)do if c.deckRow and c.arg.illegal then alerts=alerts+1 end end
assert(alerts==0,'The flagged rows are on a later page')
tabs.deckPage=2;tabs:build();alerts=0
for _,c in ipairs(tabs.controls)do if c.deckRow and c.arg.illegal then alerts=alerts+1;assert(c.arg.id=='x1')end end
assert(alerts==1,'Only the illegal row carries an alert')
print('PASS: illegal deck rows are flagged from the sync payload')
tabs.deckView='cards';tabs.deckPage=3;tabs:makeDeckCards()
local galleryAlerts=0;for _,c in ipairs(tabs.deckCards)do if c.item.illegal then galleryAlerts=galleryAlerts+1;assert(c.item.id=='x1')end end
assert(galleryAlerts==1,'Gallery cards carry the same legality flag')
tabs.deckView='list';tabs.deckPage=1
print('PASS: gallery cards share the deck row legality flag')

local loading=Builder.new({command=function(raw)commands[#commands+1]=Codec.fields(raw)end,feedback=function()end,announce=function()end})
loading:layout(1280,800)
local loadingHeader=table.concat({6000,'ready','Test Deck','standard','','','0','1','1','0','3','','','','','0','0','0'},'\t')
loading:sync(loadingHeader..'\nL\tp1\tLoading%20card...\t2\nD\tu1\tUnavailable%20card\t\t\t1\t0\nV\tLoading%20cards...\t0\t0\t0')
local entry=loading.deck[1]
assert(#loading.deck==2 and entry.pending and entry.id=='p1' and entry.name=='Loading card...' and entry.quantity==2,'A loading entry joins the deck list')
assert(loading.validation=='Loading cards...')
local function controlFor(action,id)
 for i,c in ipairs(loading.controls)do if c.action==action and (c.arg==id or type(c.arg)=='table' and c.arg.id==id)then return i,c end end
end
assert(controlFor('detail','p1'),'A loading entry keeps its row')
assert(not controlFor('discard','p1') and not controlFor('remove','p1'),'A loading entry offers no discard or remove')
local _,plus=controlFor('add','p1');assert(plus and plus.disabled,'A loading entry cannot be added to')
local discardUnavailable=controlFor('discard','u1');assert(discardUnavailable,'An unavailable entry keeps its discard')
for _,action in ipairs({'discard','remove'})do
 loading.controls[#loading.controls+1]={action=action,arg='p1',x=0,y=0,w=1,h=1}
 local sent=#commands;loading:activate(#loading.controls)
 assert(#commands==sent,'A loading entry refuses '..action)
end
loading:build();loading:activate(discardUnavailable)
assert(commands[#commands][1]=='discard' and commands[#commands][2]=='u1','Discarding an unavailable entry still sends it')
loading:activate((controlFor('detail','p1')))
assert(loading.modal and loading.modal.mode=='detail')
for _,c in ipairs(loading.controls)do if c.action=='remove' or c.action=='discard' then assert(c.disabled,'The loading entry detail cannot remove it')end end
loading:closeModal()
print('PASS: loading deck entries draw without discard and refuse it')
