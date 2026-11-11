-- Keyboard focus by layout: on the library, builder, sandbox, online lobby and Settings the
-- arrows move to the nearest control in their direction, measured on the pages' real control
-- geometry, while Tab and Shift+Tab keep list order, start at the page's content rather than
-- Back, and the arrows' older meanings (tabs, sliders, option cycles) stay. The builder's
-- shortcuts: '/' searches, 'D' jumps to the deck list, '-' and '+' change a row.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub')
Stub.install()
local shift=false
love.keyboard={isDown=function() return shift end}
local Codec=require('ui.codec')
local Wire=require('ui.wire_fields')
local function check(ok,message) if not ok then error(message,2) end end
local function noop() end
local said,sent={},{}
local function callbacks()
  return {command=function(raw) sent[#sent+1]=Codec.fields(raw) end,announce=function(text) said[#said+1]=text end,
    feedback=noop,home=noop,jiggle=noop,signin=noop,refresh=noop,decks=noop,close=noop,changed=noop,
    reduced=function() return false end}
end
local function row(tag,spec,fields)
  local out={}
  local width=0
  for _,column in pairs(spec) do width=math.max(width,column) end
  for i=1,width do out[i]='' end
  if tag then out[1]=tag end
  for name,value in pairs(fields) do out[assert(spec[name],name)]=Codec.encode(value) end
  return table.concat(out,'\t')
end
local function find(list,pred) for i,b in ipairs(list) do if pred(b) then return i,b end end end
local function centre(b) return b.x+b.w/2,b.y+b.h/2 end
-- Presses `key` on `screen` and returns the control it focused.
local function press(screen,key,list)
  screen:keypressed(key)
  return screen[list or 'controls'][screen.focus]
end

-- Library: a 6x2 grid of piles at 1280x800, a 2-column grid upright.
do
  local Library=require('ui.library')
  local function snapshot(revision,count)
    local lines={table.concat({revision,'ready','0','','','name-asc','1','2',count,''},'\t')}
    for i=1,count do lines[#lines+1]='D\tdeck'..i..'\tDeck '..i..'\t60\t0\t' end
    return table.concat(lines,'\n')
  end
  for _,view in ipairs({{1280,800,6,12},{480,850,2,4}}) do
    local l=Library.new(callbacks())
    l:layout(view[1],view[2]);l:sync(snapshot(view[1],view[4]));l:layout(view[1],view[2])
    local name='Library '..view[1]
    local cols=view[3]
    local back=find(l.controls,function(b) return b.action=='home' end)
    check(back==1,name..': Back stays first in the list, drawn as before')
    local function pile(i) return (find(l.controls,function(b) return b.action=='card' and b.card==i end)) end
    -- Tab from nothing lands on the search field, the page's content, and reaches Back last.
    check(press(l,'tab').action=='input-search',name..': Tab starts at the search field, not Back')
    l.focus=#l.controls;check(press(l,'tab').action=='home',name..': Tab after the last control reaches Back')
    check(press(l,'tab').action=='input-search',name..': and wraps to the search field')
    l.focus=0;shift=true;check(press(l,'tab').action=='home',name..': Shift+Tab from nothing lands on Back');shift=false
    -- Tab still visits a pile and then its Manage button.
    l.focus=pile(1);check(press(l,'tab').action=='manage' and l.controls[l.focus].card==1,name..': Tab goes from a pile to its Manage')
    -- Down moves to the pile below, Up back, Right and Left along the row.
    for i=1,cols do
      l.focus=pile(i)
      check(press(l,'down').action=='card' and l.controls[l.focus].card==i+cols,name..': Down from pile '..i..' reaches the pile below')
      check(press(l,'up').card==i,name..': Up returns to pile '..i)
    end
    l.focus=pile(1)
    for i=2,cols do check(press(l,'right').card==i,name..': Right walks the row to pile '..i) end
    local edge=press(l,'right')
    check(edge.card==cols or edge.action=='next',name..': Right at the row end stays, or upright reaches the pager beside it')
    l.focus=pile(cols);check(press(l,'left').card==cols-1,name..': Left walks back')
    -- From a Manage button the arrows move by its own place: Down to the next row's pile.
    l.focus=pile(1)+1;check(press(l,'down').card==1+cols,name..': Down from Manage reaches the pile below')
    l.focus=pile(1)+1;check(press(l,'up').card==1,name..': Up from Manage returns to its pile')
    -- The header row: Down from search reaches the first piles, Right walks to Sort and New deck.
    l.focus=2
    if view[1]>600 then
      check(press(l,'right').action=='sort' and press(l,'right').action=='new-deck',name..': Right walks the header')
      check(press(l,'down').action=='card',name..': Down from New deck reaches a pile')
    end
    -- Up from Back reaches the controls above it; Down from the last row reaches Back.
    l.focus=back;local above=press(l,'up');check(above and above.action~='home',name..': Up from Back leaves it')
    l.focus=pile(view[4]);local below=press(l,'down')
    check(below.action=='previous' or below.action=='next' or below.action=='home',name..': Down from the last row reaches the pager or Back')
    local before=#said;l.focus=back;press(l,'down')
    check(l.focus==back and #said==before,name..': Down from Back stays put and says nothing new')
  end
  print('PASS: library arrows move through the pile grid; Tab starts at search and reaches Back last')
end

-- Builder.
local B=Wire.builder
local function builderSnapshot(o)
  o=o or {}
  local lines={row(nil,B.header,{revision=o.revision or 1,phase='ready',name='Fire Deck',format='standard',saveStatus='',
    message='',busy=0,page=1,pages=o.pages or 3,total=24,count=14,selected='',details='',transfer='',cover='',importing=0,dirty=0,retry=0})}
  for i=1,8 do
    lines[#lines+1]=row('C',B.card,{cardId='sv01-0'..(10+i),name='Card '..i,supertype='Pokémon',subtype='Basic',quantity=0,
      remaining=1,hp=70,mark='G',number=tostring(10+i),copyLimit=4,illegal=0,gaps=''})
  end
  lines[#lines+1]=row('D',B.card,{cardId='sv04-031',name='Charcadet',supertype='Pokémon',subtype='Basic',quantity=3,
    remaining=1,hp=70,mark='G',number='31',copyLimit=4,illegal=0,gaps=''})
  lines[#lines+1]=row('D',B.card,{cardId='gone-1',name='Unavailable card',supertype='',subtype='',quantity=1,remaining=0,
    hp='',mark='',number='',copyLimit='',illegal='',gaps=''})
  lines[#lines+1]=row('L',B.pending,{cardId='wait-1',name='Loading card...',quantity=2})
  lines[#lines+1]=row('D',B.card,{cardId='full-1',name='Full card',supertype='Trainer',subtype='Item',quantity=4,
    remaining=0,hp='',mark='',number='1',copyLimit=4,illegal=0,gaps=''})
  for i=1,4 do
    lines[#lines+1]=row('D',B.card,{cardId='e-'..i,name='Energy '..i,supertype='Energy',subtype='Basic Energy',quantity=1,
      remaining=59,hp='',mark='',number=tostring(i),copyLimit=60,illegal=0,gaps=''})
  end
  lines[#lines+1]=row('V',B.validation,{message='46 more cards to reach 60.',pokemon=3,trainer=2,energy=8})
  lines[#lines+1]=row('O',B.option,{key='supertype',label='Category',value='All',count=4,index=1,selected=1})
  lines[#lines+1]=row('F',B.field,{key='sort',value='name'})
  return table.concat(lines,'\n')
end
do
  local Builder=require('ui.builder')
  local revision=0
  for _,view in ipairs({{1280,800},{480,850}}) do
    local b=Builder.new(callbacks())
    revision=revision+1
    b:layout(view[1],view[2]);b:sync(builderSnapshot({revision=revision}));b:layout(view[1],view[2])
    local name='Builder '..view[1]
    local portrait=b.portrait
    check(b.controls[1].action=='leave','Back stays first in the builder list')
    -- Tab from nothing starts at the page's content; Back comes after the last control.
    local first=press(b,'tab');check(first.action~='leave',name..': Tab starts past Back ('..tostring(first.label)..')')
    check(b.focus==2,name..': Tab lands on the first control after Back')
    b.focus=#b.controls;check(press(b,'tab').action=='leave',name..': Back follows the last control')
    b.focus=0;shift=true;check(press(b,'tab').action=='leave',name..': Shift+Tab from nothing lands on Back');shift=false
    -- '/' opens the card search for typing, from the deck tab too on a phone.
    if portrait then b.tab='deck';b:build() end
    b.focus=0;press(b,'/')
    local focused=b.controls[b.focus]
    check(focused and focused.input and focused.arg=='query' and b.editing=='query',name..': / focuses the card search and edits it')
    check(sent[#sent][1]=='input' and sent[#sent][2]=='query',name..': / opens the search field for typing')
    local searchFocus=b.focus
    b:keypressed('d');check(b.focus==searchFocus and b.editing=='query',name..': keys belong to the field while it edits')
    b.editing=''
    -- 'D' focuses the deck list's first row, on the deck tab on a phone.
    b.focus=0;press(b,'d')
    local deckRow=b.controls[b.focus]
    check(deckRow and deckRow.deckRow and deckRow.arg.id=='sv04-031',name..': D focuses the first deck row')
    check(not portrait or b.tab=='deck',name..': D shows the deck tab on a phone')
    check(said[#said]:find('Charcadet'),name..': D says the row: '..said[#said])
    -- '-' and '+' change the focused row by one, as its - and + buttons do.
    press(b,'-');check(sent[#sent][1]=='remove' and sent[#sent][2]=='sv04-031',name..': - removes one copy of the focused row')
    press(b,'=');check(sent[#sent][1]=='add' and sent[#sent][2]=='sv04-031',name..': + (the = key) adds one')
    press(b,'kp+');check(sent[#sent][1]=='add',name..': keypad + adds one')
    press(b,'kp-');check(sent[#sent][1]=='remove',name..': keypad - removes one')
    local function focusRow(id)
      b.focus=find(b.controls,function(c) return c.deckRow and c.arg.id==id end)
    end
    focusRow('gone-1');press(b,'-');check(sent[#sent][1]=='discard' and sent[#sent][2]=='gone-1',name..': - discards an unavailable card, as its x does')
    local count=#sent
    focusRow('wait-1');press(b,'-');check(#sent==count,name..': - leaves a loading row alone')
    focusRow('full-1');press(b,'+');check(#sent==count,name..': + does nothing at the copy limit')
    -- On a row's own - button the keys act on that row too.
    b.focus=find(b.controls,function(c) return c.action=='add' and c.arg=='e-1' end)
    press(b,'-');check(sent[#sent][1]=='remove' and sent[#sent][2]=='e-1',name..': - on a row button changes its row')
    -- Elsewhere '-' and '+' do nothing.
    count=#sent;b.focus=find(b.controls,function(c) return c.action=='deck-type' end);press(b,'+')
    check(#sent==count,name..': + off a deck row sends nothing')
    -- Arrows: Down walks the rows, Right reaches the row's - and +, Left returns.
    focusRow('sv04-031')
    check(press(b,'down').deckRow and b.controls[b.focus].arg.id=='gone-1',name..': Down reaches the next row')
    check(press(b,'up').arg.id=='sv04-031',name..': Up returns')
    check(press(b,'right').action=='remove' and press(b,'right').action=='add',name..': Right walks to - then +')
    local l1=press(b,'left');local l2=press(b,'left');check(l1.action=='remove' and l2.deckRow,name..': Left walks back to the row ('..tostring(l1.action)..' '..tostring(l2.action)..' '..tostring(l2.label)..')')
    check(press(b,'down').action=='detail',name..': Down from the row is the next row')
    focusRow('sv04-031');check(press(b,'up').action=='deck-type',name..': Up from the first row reaches the type tabs')
    -- In card view 'D' focuses the first card and '-' and '+' change it.
    b.deckView='cards';b:build()
    b.focus=0;press(b,'d');local card=b.controls[b.focus]
    check(card and card.action=='deck-card',name..': D focuses the first deck card in card view')
    press(b,'=');check(sent[#sent][1]=='add' and sent[#sent][2]==card.arg.id,name..': + adds to the focused deck card')
    b.deckView='list';b:build()
    -- The catalog: Down from the search reaches the cards, cards move by their grid.
    if portrait then b.tab='catalog';b:build() end
    b.focus=find(b.controls,function(c) return c.input and c.arg=='query' end)
    local below=press(b,'down');check(below.action=='card',name..': Down from the search reaches a card')
    local i1,c1=b.focus,below
    local right=press(b,'right');check(right.action=='card' and right.y==c1.y and right.x>c1.x,name..': Right moves along the card row')
    b.focus=i1;local down=press(b,'down')
    check(down.action=='card' and down.y>c1.y and math.abs(centre(down)-centre(c1))<1,name..': Down moves to the card below')
    -- The rows are fanned, so the outer cards sit a few pixels lower than the inner ones: Down and
    -- Up still leave the row rather than step along it, with a single page too, where the pager
    -- takes no focus and the nearest control below is far.
    revision=revision+1;b:sync(builderSnapshot({revision=revision,pages=1}))
    if portrait then b.tab='catalog' end
    b:update(1/60,10,-1000,-1000,true);b:build()
    for i,c in ipairs(b.controls) do
      if c.action=='card' then
        for _,key in ipairs({'down','up'}) do
          b.focus=i;local to=press(b,key)
          local away=key=='down' and to.y>=c.y+c.h/2 or key=='up' and to.y+to.h<=c.y+c.h/2
          check(b.focus==i or away,name..': '..key..' from '..c.label..' leaves its row, not to '..tostring(to.label))
        end
      end
    end
    -- A modal keeps the shortcuts away, the phone's tab under it too.
    local tab=b.tab
    b:openModal('clear');local open=#sent;press(b,'/');check(b.tab==tab,name..': / under a dialog leaves the tab under it');press(b,'d')
    check(b.tab==tab,name..': D under a dialog leaves the tab under it')
    check(b.modal and b.modal.mode=='clear' and b.editing=='' and #sent==open,name..': no shortcut works under a dialog')
    check(b.controls[#b.controls].action=='close' and press(b,'tab').action=='clear',name..': a dialog Tabs from its first control')
    b:closeModal()
  end
  print('PASS: builder arrows move by layout, Tab starts past Back, and /, D, - and + work')
end

-- Sandbox: the player tabs, search, a pile grid, the pager, Play and Back.
do
  local Sandbox=require('ui.sandbox')
  local function snapshot(revision)
    local rows={table.concat({revision,'ready','0','','deck1','deck2'},'\t')}
    for i=1,25 do rows[#rows+1]='D\tdeck'..i..'\tDeck '..i..'\t60' end
    return table.concat(rows,'\n')
  end
  for _,view in ipairs({{1280,800},{480,850}}) do
    local s=Sandbox.new(callbacks())
    s:layout(view[1],view[2]);s:sync(snapshot(view[1]));s:layout(view[1],view[2])
    local name='Sandbox '..view[1]
    check(press(s,'tab').action=='tab1',name..': Tab starts at Player 1, as before')
    check(press(s,'right').action=='tab2',name..': Right moves to Player 2')
    check(press(s,'left').action=='tab1',name..': Left returns')
    check(press(s,'down').action=='search',name..': Down reaches the search field')
    local first=press(s,'down');check(first.action=='card',name..': Down reaches the piles')
    local firstIndex=s.focus
    local below=press(s,'down')
    check(below.action=='card' and below.y>first.y and math.abs(centre(below)-centre(first))<1,name..': Down moves to the pile below')
    s.focus=firstIndex;check(press(s,'right').action=='card',name..': Right walks the piles')
    s.focus=find(s.controls,function(b) return b.action=='start' end)
    check(press(s,'down').action=='home',name..': Down from Play reaches Back')
    s.focus=0;shift=true;check(press(s,'tab').action=='home',name..': Shift+Tab from nothing lands on Back, the last control');shift=false
  end
  print('PASS: sandbox arrows move by layout and Tab keeps its order')
end

-- Online: left and right still switch the menu's tabs and step the picker's filter cycle; up
-- and down move by layout.
do
  local Online=require('ui.online')
  local W=Wire.online
  local o=Online.new(callbacks())
  local revision=0
  local function snapshot(step,opts,rows)
    opts=opts or {};revision=revision+1
    local lines={row(nil,W.header,{revision=revision,step=step,busy=0,message='',code=opts.code or 'ABCD',role='host',
      link='connected',countdown='',notice='',deckPhase=opts.decks or 'idle',name='Ash',account='authenticated',status=''})}
    for _,r in ipairs(rows or {}) do lines[#lines+1]=row(r[1],r[1]=='P' and W.seat or W.deck,r[2]) end
    o:sync(table.concat(lines,'\n'))
  end
  o:layout(1280,800);o:update(0.01,20,-1000,-1000,false);o:open(true,'')
  snapshot('menu',{code=''})
  o.focus=0
  check(press(o,'tab','items').kind=='tab',"Online: Tab starts at the Create tab")
  check(press(o,'down','items').action=='create',"Online: Down from the tabs reaches Create lobby")
  check(press(o,'down','items').kind=='back',"Online: Down from Create lobby reaches Back")
  check(press(o,'up','items').action=='create',"Online: Up returns")
  press(o,'right','items');check(o.tab==2,"Online: Right still switches to the Join tab")
  press(o,'left','items');check(o.tab==1,"Online: Left switches back")
  -- The deck picker: Down from the search reaches the piles; Left and Right on the cycle step it.
  local seats={{'P',{seat='you',present=1,name='Ash',connected=1,ready=0,deckId='',deckName='',hasDeck=0}},
    {'P',{seat='opponent',present=1,name='Misty',connected=1,ready=0,deckId='',deckName='',hasDeck=0}}}
  for i=1,12 do seats[#seats+1]={'D',{id='deck'..i,name='Deck '..i,count=60,standard=1,expanded=0,online=1,formatName='Standard'}} end
  snapshot('versus',{decks='ready'},seats)
  o:activate((find(o.items,function(b) return b.action=='choose' end)))
  check(o.picker,'Online: Choose deck opens the picker')
  o.focus=find(o.items,function(b) return b.kind=='field' end)
  local pile=press(o,'down','items');check(pile.kind=='card',"Online: Down from the picker's search reaches a pile")
  local right=press(o,'right','items');check(right.kind=='card' and right.x>pile.x,"Online: Right walks the piles")
  local cycle=find(o.items,function(b) return b.kind=='cycle' end)
  o.focus=cycle;local filter=o.filter;press(o,'right','items')
  check(o.focus==cycle and o.filter~=filter,"Online: Right on the format cycle still steps it")
  print('PASS: online arrows keep switching tabs and stepping the cycle; up and down move by layout')
end

-- Settings: left and right keep their meaning on tabs, sliders and cycles; up and down move by
-- layout; Tab keeps its ring.
do
  local Settings=require('ui.settings')
  local Preferences=require('ui.preferences')
  local popup=Settings.new(Preferences.new(),callbacks(),false)
  popup:layout(1280,800)
  check(popup.focus==1,'Settings opens by keyboard on the Game tab')
  popup:keypressed('right');check(popup.tab==2 and popup.focus==2,'Right on a tab still switches tabs')
  local item=press(popup,'down','items');check(item.key=='crt','Down from the Graphics tab reaches CRT')
  local crt=popup.preferences.crt;popup:keypressed('right');check(popup.preferences.crt==crt+5,'Right on the slider still adjusts it')
  check(press(popup,'down','items').key=='bloom','Down walks the rows')
  check(press(popup,'down','items').key=='highFrameRate' and press(popup,'down','items').kind=='back','Down reaches Back')
  check(press(popup,'down','items').kind=='back','Down from Back stays')
  check(press(popup,'up','items').key=='highFrameRate','Up returns')
  popup.focus=find(popup.items,function(b) return b.key=='crt' end)
  local up=press(popup,'up','items');check(up.kind=='tab','Up from the first row reaches a tab')
  popup.focus=4;check(press(popup,'tab','items').key=='crt','Tab keeps list order')
  print('PASS: Settings arrows keep tabs, sliders and cycles and move up and down by layout')
end
