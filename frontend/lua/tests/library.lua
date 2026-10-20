package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
love={math={random=function() return 0.5 end},graphics={},keyboard={isDown=function() return false end}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local Library=require('ui.library')
local Codec=require('ui.account')
local commands={}
local library=Library.new({command=function(raw) commands[#commands+1]=Codec.fields(raw) end,announce=function() end,feedback=function() end})
local function snapshot(revision,count,result,page)
  local lines={table.concat({revision,'ready','0','','','','decks','name-asc',page or '1','2',count,'','0',result or ''},'\t')}
  for i=1,count do lines[#lines+1]='D\tdeck'..i..'\tDeck '..i..'\t\t60\t0\t' end
  return table.concat(lines,'\n')
end
local function activate(action)
  for i,b in ipairs(library.controls) do if b.action==action then library:activate(i); return end end
  error('Missing control '..action)
end
for _,view in ipairs({{1280,800,12},{480,850,4}}) do
  library:layout(view[1],view[2]); library:sync(snapshot(view[1],view[3]))
  library:layout(view[1],view[2]) -- settles the entrance animation for geometry assertions
  for _,b in ipairs(library.controls) do
    assert(b.x>=0 and b.y>=0 and b.x+b.w<=view[1] and b.y+b.h<=view[2],b.action..' outside viewport')
  end
  local cols=view[3]/2
  local rowEnd=library.cards[1].homeY+(view[1]<600 and 79 or 94)+24+28
  local nextRow=library.cards[cols+1]
  assert(rowEnd<nextRow.homeY-D.HALF_H*nextRow.baseScale,'Rows overlap')
  activate('new-deck'); assert(library.modal.mode=='create')
  assert(library.baseControls[1].action=='home','Underlying controls must remain visible')
  local before=#commands
  library:input('1\tname\tZo%C3%AB%09Deck\t0\t0\tinput')
  assert(library.draft=='Zoë\tDeck' and #commands==before,'Typing must not create a deck')
  library:submit()
  local sent=commands[#commands]; assert(sent[1]=='create' and sent[3]=='Zoë\tDeck')
  library:sync(snapshot(view[1]+1,view[3],'error')); assert(library.modal,'Failed save must keep the dialog')
  library:sync(snapshot(view[1]+2,view[3],'ok')); assert(not library.modal,'Successful save closes the dialog')
  library.inputRaw=nil
end
library:layout(1280,800); library:sync(snapshot(2000,12)); library:layout(1280,800)
local card=library.cards[1]
library:mousepressed(card.x,card.y)
library.drag.active=true; card.dragging=true
local target=library.cards[2]
local beforeDrop=#commands
library:mousereleased(target.x,target.y)
assert(#commands==beforeDrop,'Dragging must not reorder automatically sorted decks')
assert(not card.dragging and not library.drag)
local T=require('ui.theme')
for _,b in ipairs(library.controls) do
  assert(b.action~='show' and b.action~='new-folder' and b.action~='settings')
  if b.action=='previous' or b.action=='next' then assert(b.colour==T.red and not b.disabled) end
  if b.action=='home' then assert(b.y==library.height-66 and b.w==1000 and b.x==(library.width-1000)/2) end
end
print('PASS: decks-only controls, red pagination, bottom Back, mailbox, save/error, responsive bounds and drag release')
local Settings=require('ui.settings')
local Preferences=require('ui.preferences')
local Modal=require('ui.modal')
library:build(); library:open(false)
local settings=Settings.new(Preferences.new(),{},false)
assert(library:offset()==600 and library.motion.VT.y==settings.motion.VT.y)
local back=library.controls[1]
assert(library:hit(back.x+5,back.y+5)==0,'Underlying target must not be clickable before the modal arrives')
assert(library:hit(back.x+5,back.y+5+library:offset())==1,'Modal hit testing must follow its visible position')
for frame=1,180 do
  library.motion:update(1/60,frame/60,false,false,false)
  settings.motion:update(1/60,frame/60,false,false,false)
  assert(library.motion.VT.y==settings.motion.VT.y,'Decks and Settings must share the same entrance')
end
assert(library:offset()==0)
library:openModal('create',{kind='deck',name=''})
assert(library.modal.motion.VT.y==10,'Management dialogs use the same entrance')
local closed=false; library.callbacks.home=function() closed=true end
library:keypressed('escape'); assert(not library.modal and not closed)
library:keypressed('escape'); assert(closed,'Escape closes the collection')
library:open(true); assert(library:offset()==0,'Reduced motion must skip the entrance')
local colour,rect
love.graphics.setColor=function(...) colour={...} end
love.graphics.rectangle=function(...) rect={...} end
Modal.backdrop(390,844)
assert(colour[4]==0.7 and rect[2]==0 and rect[3]==0 and rect[4]==390 and rect[5]==844,'Backdrop covers the full framebuffer')
print('PASS: settings-equivalent modal motion, animated hit testing, Escape, reduced motion and full-screen backdrop')

library.reduced=false
library:sync(snapshot(3001,12,nil,2))
for _,card in ipairs(library.cards) do
  assert(math.abs(card.x-(library.width/2+D.HALF_W*card.baseScale))<1e-9,'New page must start at the collection row origin')
end
library.reduced=true
library:sync(snapshot(3002,12,nil,1))
for _,card in ipairs(library.cards) do
  assert(card.motion.VT.x==card.motion.T.x and card.motion.VT.y==card.motion.T.y,'Reduced motion must place the new page immediately')
end
print('PASS: page replacement triggers collection entrance; reduced motion skips it')

-- Legality verdicts arrive later in field 8 and must not restart the entrance.
library:layout(1280,800); library:sync(snapshot(5000,3)); library:layout(1280,800)
local firstCards=library.cards
local judged={table.concat({5001,'ready','0','','','','decks','name-asc','1','2','3','','0',''},'\t'),
 'D\tdeck1\tDeck 1\t\t60\t0\t\t0','D\tdeck2\tDeck 2\t\t60\t0\t\t1','D\tdeck3\tDeck 3\t\t60\t0\t\t1'}
library:sync(table.concat(judged,'\n'))
assert(library.cards==firstCards,'A verdict must not rebuild the piles')
assert(not library.items[1].illegal and library.items[2].illegal and library.items[3].illegal)
assert(library.cards[2].item.illegal,'Piles read the flag through their shared item')
print('PASS: deck legality verdicts flip pile alerts in place')
