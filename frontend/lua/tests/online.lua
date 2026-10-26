-- Headless checks for the online modal: mailbox parsing into steps, layout at
-- both room sizes, the code field, busy guards, no host kick, countdown
-- lock, Escape order, the deck picker, its regulation filter and its online verdict.
package.path='frontend/lua/?.lua;'..package.path
local font={getWidth=function(_,s) return #tostring(s)*8 end,getHeight=function() return 20 end,
  getWrap=function(_,s) return #s*8,{s} end}
love={math={random=function() return 0.5 end},graphics={},keyboard={isDown=function() return false end},
  filesystem={getInfo=function() return nil end}}
local D=require('ui.card_dimensions')
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local T=require('ui.theme')
T.font=function() return font end
local Online=require('ui.online')
assert(not package.loaded['ui.library'] and not package.loaded['ui.simulator'] and not package.loaded['ui.sim_fx'],'The modal needs no other page')
local Codec=require('ui.codec')
local commands,said,sounds,home,signin={},{},{},0,0
local o=Online.new({command=function(raw) commands[#commands+1]=Codec.fields(raw) end,
  announce=function(text) said[#said+1]=text end,feedback=function(name) sounds[#sounds+1]=name end,
  jiggle=function() end,home=function() home=home+1 end,signin=function() signin=signin+1 end})
local revision,time=0,20
local function snapshot(step,opts,rows)
  opts=opts or {};revision=revision+1
  local f={revision,step,opts.busy and 1 or 0,opts.message or '',opts.code or 'ABCD',opts.role or 'host',
    opts.link or 'connected',opts.countdown or '',opts.notice or '',opts.decks or 'idle',opts.name or 'Ash',
    opts.account or 'authenticated',opts.kick and 1 or 0,opts.status or ''}
  for i,v in ipairs(f) do f[i]=Codec.encode(v) end
  local lines={table.concat(f,'\t')}
  for _,r in ipairs(rows or {}) do
    local encoded={}
    for i,v in ipairs(r) do encoded[i]=Codec.encode(v) end
    lines[#lines+1]=table.concat(encoded,'\t')
  end
  o:sync(table.concat(lines,'\n'))
end
local function last() return commands[#commands] end
local function find(pred) for i,item in ipairs(o.items) do if pred(item) then return i,item end end end
local function action(name) return find(function(item) return item.action==name end) end
local function tick(dt) time=time+dt;o:update(dt,time,-1000,-1000,false) end
local function inside(label)
  for _,item in ipairs(o.items) do
    assert(item.x>=o.x and item.x+item.w<=o.x+o.w and item.y>=o.y and item.y+item.h<=o.y+o.h,
      label..': '..tostring(item.label or item.kind)..' outside the frame')
  end
end
local you={'P','you',1,'Ash',1,0,'',''}
local function seats(ready,deck,oppReady,oppConnected)
  return {{'P','you',1,'Ash',1,ready and 1 or 0,deck and 'deck2' or '',deck and 'Deck 2' or ''},
    {'P','opponent',1,'Misty',oppConnected==false and 0 or 1,oppReady and 1 or 0,'',''}}
end
local function decks()
  local rows=seats(false,true)
  for i=1,12 do rows[#rows+1]={'D','deck'..i,'Deck '..i,60,i%2,i%3==0 and 1 or 0,i==11 and 0 or 1,'Standard'} end
  return rows
end

-- Normalisation mirrors normalizeLobbyCode.
assert(Online.normalize('ab-cd')=='ABCD' and Online.normalize('o0il1zz9q')=='ZZ9Q' and Online.normalize('abcdef')=='ABCD')
assert(Online.normalize('')=='' and Online.normalize('é')=='')

-- Opening announces the menu, asks TS for a fresh snapshot and creates a lobby.
o:layout(1280,800);tick(0.01);o:open(true,'')
assert(commands[#commands-1][1]=='open' and #commands[#commands-1]==1 and last()[1]=='create' and o.busy)
assert(said[#said]:find('^Online%. Create tab'))
snapshot('menu',{code='',role='',link='',account='anonymous'})
assert(action('create') and action('signin') and o.items[#o.items].label=='Back')
-- Left and right switch tabs; Join stays disabled until four characters.
o:keypressed('right');assert(o.tab==2 and said[#said]=='Join tab')
local _,join=action('join');assert(join.disabled)
o:input('1\tcode\tab1o\t4\t4\tinput');assert(o.joinCode=='AB' and o.editing=='code')
local before=#commands;o:keypressed('escape');assert(#commands==before,'Keys belong to the native field while editing')
o:input('2\tcode\tabcd\t4\t4\tinput');_,join=action('join');assert(not join.disabled)
o:input('3\tcode\tabcd\t4\t4\tenter');assert(last()[1]=='join' and last()[2]=='ABCD' and not o.editing,'Enter joins')
before=#commands;o:activate((action('join')));assert(#commands==before,'Busy join cannot send twice')
o:keypressed('left');assert(o.tab==1)
snapshot('menu',{code='',role='',link='',busy=true})
local _,create=action('create');assert(create.disabled and create.label=='Please wait...')
before=#commands;o:activate((action('create')));assert(#commands==before,'Busy create cannot send twice')
snapshot('menu',{code='',role='',link='',message="Couldn't reach the lobby server. Try again in a moment."})
assert(said[#said]:find("Couldn't reach"))
o:activate((action('create')));assert(last()[1]=='create' and o.busy)
-- Typing on the Join tab opens the field with that letter.
o:input('4\tcode\t\t0\t0\tdone');o:keypressed('right');o:keypressed('q');assert(last()[1]=='input' and last()[2]=='code' and last()[3]=='Q' and o.editing=='code')
o:input('5\tcode\tQ\t1\t1\tdone');o:keypressed('left')
-- Release outside cancels; the hit area follows the entrance slide.
local back=o.items[#o.items]
o:mousepressed(back.x+5,back.y+5);o:mousereleased(0,0);assert(home==0,'Releasing outside must cancel')
o:open(false,'');snapshot('menu',{code='',role='',link=''})
back=o.items[#o.items]
assert(o:hit(back.x+5,back.y+5)~=#o.items,'Hit testing follows the entrance animation')
assert(o:hit(back.x+5,back.y+5+o:offset())==#o.items)
o:open(true,'');assert(o:offset()==0)
snapshot('menu',{code='',role='',link=''})
o:keypressed('escape');assert(home==1 and last()[1]=='leave' and last()[2]=='home','Menu Escape leaves for home')

-- A deep link joins; each step announces itself.
o:open(true,'ABCD');assert(last()[1]=='open' and last()[2]=='ABCD' and said[#said]=='Joining lobby A B C D')
snapshot('joining',{role='guest'});assert(o.items[#o.items].label=='Cancel')
snapshot('waiting',{},{you});assert(said[#said]=='Lobby code A B C D. Waiting for an opponent to join.' and sounds[#sounds]=='highlight1')
o:activate((action('copy')));assert(last()[1]=='copy' and last()[2]=='code')
snapshot('waiting',{notice='Copied'},{you});assert(o.items[3].label=='Copied' and o.items[4].label=='Copy link' and said[#said]=='Copied')
-- The created lobby fills the Create tab; Leave goes home, Join gives it up.
assert(o.items[1].kind=='tab' and o.tab==1 and o.items[#o.items].label=='Leave' and o.items[#o.items].action=='home' and o.h==540)
before=#commands;o:activate(1);assert(#commands==before,'Create tab while waiting keeps the lobby')
o:activate(2);assert(o.tab==2 and last()[1]=='leave' and #last()==1,'Join leaves the lobby')
snapshot('menu',{code='',role='',link=''});assert(action('join') and not action('create'))
o:activate(1);assert(o.tab==1 and last()[1]=='create' and o.busy,'Returning to Create makes a lobby')
snapshot('versus',{kick=true,status='Waiting for your opponent to ready up...'},seats(false,false))
assert(said[#said]:find('^Versus%. Misty joined%.') and sounds[#sounds]=='cardFan2','Opponent join cue')
local _,ready=action('ready');assert(ready.disabled,'Ready needs a deck')
snapshot('versus',{kick=true},seats(false,true))
_,ready=action('ready');assert(not ready.disabled and action('choose'))
o:activate((action('ready')));assert(last()[1]=='ready' and last()[2]=='1')
snapshot('versus',{kick=true},seats(true,true,true))
assert(said[#said]:find('You are ready%.') and said[#said]:find('Misty is ready%.'))
local _,choose=action('choose');assert(choose.disabled,'A readied deck is locked')
_,ready=action('ready');assert(ready.label=='Cancel ready')
snapshot('versus',{kick=true},seats(false,true))
assert(said[#said]:find('You are no longer ready%.') and said[#said]:find('Misty is no longer ready%.'),'Unready is announced')
assert(not action('kick'),'The opponent has no Kick button')
-- Opponent away and back.
snapshot('versus',{kick=true},seats(false,true,false,false));assert(sounds[#sounds]=='chips1' and said[#said]=='Misty disconnected.')

-- The picker: Escape returns to versus, a pick sends select.
o:activate((action('choose')));assert(o.picker and last()[1]=='decks' and o.items[#o.items].label=='Back')
assert(said[#said]=='Choose your deck. Loading decks.')
before=#commands;o:keypressed('escape');assert(not o.picker and #commands==before,'Picker Escape returns to versus')
o:activate((action('choose')))
snapshot('versus',{kick=true,decks='ready'},decks())
assert(#o.cards==10 and o.pages==2 and said[#said]=='Choose your deck. 12 decks.')
-- Regulation cycle: All, Standard, Not Standard, Expanded, Not Expanded.
local cycle=find(function(item) return item.kind=='cycle' end)
o.focus=cycle;o:keypressed('right')
assert(o.filter==2 and #o.cards==6 and said[#said]=='Deck filter: Standard legal. Left and right change it.')
o:keypressed('right');assert(#o.cards==6)
o:keypressed('right');assert(#o.cards==4 and said[#said]:find('Expanded legal'))
o:keypressed('right');assert(#o.cards==8)
o:keypressed('right');assert(o.filter==1 and #o.cards==10,'The cycle wraps')
o:keypressed('left');assert(o.filter==5 and said[#said]:find('Not Expanded legal'))
local item=o.items[cycle]
o:mousepressed(item.x+5,item.y+10);o:mousereleased(item.x+item.w-5,item.y+10);assert(o.filter==5,'Releasing on the other arrow cancels')
o:mousepressed(item.x+item.w-5,item.y+10);o:mousereleased(item.x+item.w-5,item.y+10);assert(o.filter==1)
o:mousepressed(item.x+item.w-5,item.y+10);o:cancelInteractions();o:mousereleased(item.x+item.w-5,item.y+10)
assert(o.filter==1 and not o.pressed,'A cancelled press does not activate on release')
o:input('5\tsearch\tdeck 11\t7\t7\tdone')
local illegal,illegalItem=find(function(it) return it.kind=='card' end)
assert(illegalItem.blocked and not illegalItem.disabled)
-- Keyboard focus reaches it and reads the reason; the pointer passes over it.
o.focus=cycle;o:keypressed('tab')
assert(o.focus==illegal and said[#said]=="Deck 11. 60 cards. Not legal in Standard, so it can't be played online.",
  'A deck not legal online is focusable and says why')
assert(o:hit(illegalItem.x+illegalItem.w/2,illegalItem.y+illegalItem.h/2)==0,'The pointer cannot pick it')
before=#commands;o:keypressed('return')
assert(#commands==before and o.picker,'A deck not legal online is not chosen')
assert(said[#said]=="Deck 11 can't be played online. It isn't legal in Standard.",'Choosing it says why not')
o:mousepressed(illegalItem.x+5,illegalItem.y+5);o:mousereleased(illegalItem.x+5,illegalItem.y+5)
assert(#commands==before and o.picker)
o:input('6\tsearch\tdeck 1\t6\t6\tinput');assert(#o.cards==4 and o.editing=='search')
o:input('7\tsearch\tdeck 12\t7\t7\tdone')
local card=find(function(it) return it.kind=='card' end)
o:activate(card);assert(last()[1]=='select' and last()[2]=='deck12' and not o.picker and sounds[#sounds]=='cardSlide1')
o:activate((action('choose')));snapshot('versus',{kick=true,decks='anonymous'},seats(false,false))
assert(action('signin'));o:activate((action('signin')));assert(signin==1)
o.picker=false;o:build()
-- The picker closing under the search field ends the native input.
o:activate((action('choose')));snapshot('versus',{kick=true,decks='ready'},decks())
o:input('8\tsearch\tdeck\t4\t4\tinput');assert(o.editing=='search')
snapshot('versus',{kick=true,decks='ready'},seats(true,true));assert(not o.picker and not o.editing and last()[1]=='finish-input')
o:activate((action('ready')));snapshot('versus',{kick=true,decks='ready'},decks())
o:activate((action('choose')));o:input('9\tsearch\tdeck\t4\t4\tinput')
snapshot('waiting',{decks='ready'},{seats()[1]});assert(not o.picker and not o.editing and last()[1]=='finish-input')

-- Countdown: only Leave stays live and Escape is ignored.
snapshot('versus',{kick=true},seats(true,true,true))
snapshot('countdown',{kick=true,countdown=3,status='Both ready - starting...'},seats(true,true,true))
assert(said[#said]=='Battle starting. 3' and sounds[#sounds]=='generic1')
for i,it in ipairs(o.items) do assert((i<#o.items)==(it.disabled==true),'Countdown locks all but Leave: '..it.label) end
before=#commands;o:keypressed('escape');assert(#commands==before and home==1,'Countdown ignores Escape')
snapshot('countdown',{countdown=0},seats(true,true,true));assert(said[#said]=='Go!' and sounds[#sounds]=='whoosh2')
o:activate(#o.items);assert(last()[1]=='leave' and #last()==1,'Leave during the countdown')
snapshot('versus',{},seats(false,true))
o:keypressed('escape');assert(last()[1]=='leave' and #last()==1,'Versus Escape leaves the lobby')
o.tab=1;snapshot('menu',{code='',role='',link=''});assert(last()[1]=='create' and o.busy,'Leaving lands on a new lobby')
snapshot('menu',{code='',role='',link='',message="Couldn't reach the lobby server. Try again in a moment."})
before=#commands;snapshot('menu',{code='',role='',link='',message='x'});assert(#commands==before,'A failed create does not retry by itself')

snapshot('countdown',{countdown=1},seats(true,true,true));snapshot('starting',{},seats(true,true,true))
assert(said[#said]=='Go!' and o.items[#o.items].label=='Leave','GO! even when the zero second is skipped')
o:activate(#o.items);assert(last()[1]=='leave' and last()[2]=='home' and home==2,'Leaving a set match goes home')
-- Info steps: Back to online leaves to the menu; Back goes home.
snapshot('kicked',{role='guest'})
assert(said[#said]=='Removed from the lobby. The host removed you from this lobby.' and sounds[#sounds]=='whoosh')
o:activate((action('online')));assert(last()[1]=='leave' and #last()==1)
snapshot('not-found',{code='ZZZZ'});assert(said[#said]:find('No open lobby with the code ZZZZ'))
o:keypressed('escape');assert(home==3 and last()[2]=='home')

-- Every step fits its frame in both rooms.
local steps={
  {'menu',{account='anonymous'}},{'menu',{account='anonymous'},nil,2},{'joining'},{'waiting',{},{you}},
  {'versus',{kick=true},seats(false,true)},{'versus',{kick=true,decks='ready'},decks(),nil,true},
  {'versus',{decks='anonymous'},seats(false,false),nil,true},{'countdown',{countdown=2},seats(true,true,true)},
  {'starting'},{'invalid'},{'full'},{'not-found'},{'kicked'},
}
-- Draw every step too, against a no-op renderer.
setmetatable(love.graphics,{__index=function() return function() end end})
for _,view in ipairs({{1280,800},{480,850}}) do
  o:layout(view[1],view[2])
  for _,s in ipairs(steps) do
    o:open(true,'');o.tab=s[4] or 1
    snapshot(s[1],s[2],s[3])
    if s[5] then o:activate((action('choose')));snapshot(s[1],s[2],s[3]) end
    inside(view[1]..' '..s[1])
    o.focus=1;tick(0.3);o:draw()
    assert(o.y>=0 and o.y+o.h<=view[2],s[1]..' frame outside the room')
    if s[1]=='versus' and not s[5] then
      for _,tag in ipairs({'you','opponent'}) do
        local p=o.panels[tag]
        assert(p.x>=o.x and p.x+p.w<=o.x+o.w and p.y>=o.y and p.y+p.h<=o.y+o.h-60,tag..' panel overlaps Back')
      end
    end
    if s[5] and s[2].decks=='ready' then
      for _,c in ipairs(o.cards) do
        assert(c.homeY-D.HALF_H*c.baseScale-32>=o.area.y and c.homeY+D.HALF_H*c.baseScale+24<=o.area.y+o.area.h,'Pile outside the tray')
      end
    end
  end
end
print('PASS: online modal steps, code entry, busy guards, no kick, countdown lock, Escape order, deck picker, regulation filter and online verdict')
