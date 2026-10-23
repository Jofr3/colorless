package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
love={math={random=function() return 0.5 end},graphics={},keyboard={isDown=function() return false end}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local Sandbox=require('ui.sandbox')
local Codec=require('ui.codec')
local calls={};local left=false
local chooser=Sandbox.new({command=function(raw) calls[#calls+1]=Codec.fields(raw) end,feedback=function() end,announce=function() end,home=function() left=true end})
local function snapshot(revision,count,busy)
  local rows={table.concat({revision,'ready',busy and '1' or '0','','deck1','deck2'},'\t')}
  for i=1,25 do rows[#rows+1]='D\tdeck'..i..'\t'..(i==25 and 'Special % deck' or 'Deck '..i)..'\t'..(i==2 and count or 60) end
  return table.concat(rows,'\n')
end
local function activate(action)
  for i,b in ipairs(chooser.controls) do if b.action==action then chooser:activate(i);return end end
  error('Missing '..action)
end
for _,view in ipairs({{1280,800,10},{480,850,4}}) do
  chooser.query='';chooser.page=1
  chooser:layout(view[1],view[2]);chooser:sync(snapshot(view[1],60));chooser:layout(view[1],view[2])
  for _,b in ipairs(chooser.controls) do
    assert(b.x>=chooser.x and b.x+b.w<=chooser.x+chooser.w and b.y>=chooser.y and b.y+b.h<=chooser.y+chooser.h,b.action..' outside modal')
  end
  assert(#chooser.cards==view[3])
  for _,card in ipairs(chooser.cards) do
    assert(card.homeY-D.HALF_H*card.baseScale-32>=chooser.area.y,'Title outside tray')
    assert(card.homeY+D.HALF_H*card.baseScale+24<=chooser.area.y+chooser.area.h,'Count outside tray')
    local _,top=card:target(1,view[1],require('ui.deck_pile').parallax())
    assert(top-D.HALF_H*card.baseScale-32>=card.bounds.y,'Selection outline must enclose title')
    assert(card.homeY+D.HALF_H*card.baseScale+24<=card.bounds.y+card.bounds.h,'Selection outline must enclose count')
  end
  assert(chooser:canStart())
  activate('tab2');activate('card');assert(calls[#calls][1]=='select' and calls[#calls][2]=='2' and calls[#calls][3]=='deck1')
  activate('next');assert(chooser.page==2 and chooser.cards[1].item.id=='deck'..(view[3]+1))
  assert(chooser.selected[1]=='deck1' and chooser.selected[2]=='deck2','Paging must preserve selections')
  chooser:input('1\tsearch\tsPeCiAl%20%25\t9\t9\tinput')
  assert(chooser.page==1 and chooser.pages==1 and #chooser.cards==1 and chooser.cards[1].item.id=='deck25','Search is case insensitive and treats % literally')
  activate('card');assert(calls[#calls][3]=='deck25','Select the filtered card, not the unfiltered index')
  chooser:input('2\tsearch\tmissing\t7\t7\tdone');assert(#chooser.cards==0 and chooser:canStart(),'No matches must not clear selected decks')
  chooser:input('3\tsearch\t\t0\t0\tdone');assert(#chooser.cards==view[3])
  chooser:sync(snapshot(view[1]+1,0));assert(not chooser:canStart())
  local before=#calls;activate('start');assert(#calls==before,'Incomplete decks cannot start')
  chooser:sync(snapshot(view[1]+2,60));activate('start');assert(calls[#calls][1]=='start' and chooser.busy)
  before=#calls;activate('card');activate('start');assert(#calls==before,'Busy controls cannot change selections or double start')
  chooser:sync(snapshot(view[1]+3,60));chooser:open(false)
  local b=chooser.controls[#chooser.controls]
  assert(chooser:hit(b.x+5,b.y+5)~=#chooser.controls,'Hit testing follows entrance animation')
  assert(chooser:hit(b.x+5,b.y+5+chooser:offset())==#chooser.controls)
  chooser:open(true);assert(chooser:offset()==0)
  chooser:keypressed('escape');assert(left and calls[#calls][1]=='close')
  chooser.inputRaw=nil
end
-- A burst of wheel events turns one page; the next turn waits for the delay.
local clock=100;love.timer={getTime=function() return clock end}
chooser:layout(1280,800);chooser.query='';chooser.page=1;chooser:sync(snapshot(9001,60))
for _=1,5 do chooser:wheelmoved(-1) end;assert(chooser.page==2,'One wheel burst turns one page')
clock=clock+0.1;chooser:wheelmoved(-1);assert(chooser.page==2,'Wheel paging waits for the delay')
clock=clock+0.2;chooser:wheelmoved(1);assert(chooser.page==1,'Wheel pages again after the delay')
chooser:keypressed('pagedown');chooser:keypressed('pagedown');assert(chooser.page==3,'Page keys are not delayed')
love.timer=nil
print('PASS: wheel paging turns one page per delay; page keys stay immediate')
print('PASS: searchable five-column deck grid, independent selection, pagination, responsive bounds, validation, busy controls and modal motion')
