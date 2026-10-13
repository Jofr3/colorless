package.path='frontend/lua/?.lua;'..package.path
love={math={random=function() return 0.5 end},graphics={},keyboard={isDown=function() return false end}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local Library=require('ui.library')
local Codec=require('ui.account')
local commands={}
local library=Library.new({command=function(raw) commands[#commands+1]=Codec.fields(raw) end,announce=function() end,feedback=function() end})
local function snapshot(revision,count,result)
  local lines={table.concat({revision,'ready','0','','','','decks','manual','1','2',count,'','0',result or ''},'\t')}
  for i=1,count do lines[#lines+1]='D\tdeck'..i..'\tDeck '..i..'\t\t60\t0\t' end
  return table.concat(lines,'\n')
end
local function activate(action)
  for i,b in ipairs(library.controls) do if b.action==action then library:activate(i); return end end
  error('Missing control '..action)
end
for _,view in ipairs({{1280,800,8},{480,850,4}}) do
  library:layout(view[1],view[2]); library:sync(snapshot(view[1],view[3]))
  library:layout(view[1],view[2]) -- settles the entrance animation for geometry assertions
  for _,b in ipairs(library.controls) do
    assert(b.x>=0 and b.y>=0 and b.x+b.w<=view[1] and b.y+b.h<=view[2],b.action..' outside viewport')
  end
  local cols=view[3]/2
  local rowEnd=library.cards[1].homeY+(view[1]<600 and 79 or 94)+24+28
  local nextRow=library.cards[cols+1]
  assert(rowEnd<nextRow.homeY-95*nextRow.baseScale,'Rows overlap')
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
library:layout(1280,800); library:sync(snapshot(2000,8)); library:layout(1280,800)
local card=library.cards[1]
library:mousepressed(card.x,card.y)
library.drag.active=true; card.dragging=true
local target=library.cards[2]
library:mousereleased(target.x,target.y)
assert(commands[#commands][1]=='order' and commands[#commands][4]=='deck2')
assert(not card.dragging and not library.drag)
local T=require('ui.theme')
for _,b in ipairs(library.controls) do
  assert(b.action~='show' and b.action~='new-folder' and b.action~='settings')
  if b.action=='previous' or b.action=='next' then assert(b.colour==T.red and not b.disabled) end
  if b.action=='home' then assert(b.y==library.height-66 and b.w==library.width-96) end
end
print('PASS: decks-only controls, red pagination, bottom Back, mailbox, save/error, responsive bounds and drag reorder')
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
