-- Each screen says where it draws the text field a native proxy edits (audit BR6), so main.lua can
-- tell the page and the page can put the proxy there: the IME window and a phone keyboard's pan
-- then anchor at the field, not at the canvas's corner. editBox returns the box Input draws the
-- editing field in, in the space main.lua draws the screen in (a modal's slide and the lobby's
-- entrance included), and nothing while no field edits. Every text field: the deck library's
-- search and deck name, the builder's name, search, option search, rules text and decklist, the
-- sandbox's search, the lobby's code and deck search, sign-in and sign-up email, password and
-- name, the deletion's password or email, the account name and the name prompt.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local Card=require('ui.card');Card.rebuild=function(self)self.texture={release=function()end}end
local Codec=require('ui.codec')
local Input=require('ui.text_input')
local Wire=require('ui.wire_fields')
local function check(ok,message) if not ok then error(message,2) end end
local function noop() end
local shader=Stub.shader()
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader}

-- The graphics transform, translate and scale only (no field is drawn rotated).
local g=Stub.graphics
local t,stack={x=0,y=0,sx=1,sy=1},{}
rawset(g,'origin',function() t={x=0,y=0,sx=1,sy=1} end)
rawset(g,'push',function() stack[#stack+1]={x=t.x,y=t.y,sx=t.sx,sy=t.sy} end)
rawset(g,'pop',function() t=table.remove(stack) end)
rawset(g,'translate',function(dx,dy) t.x,t.y=t.x+dx*t.sx,t.y+dy*t.sy end)
rawset(g,'scale',function(sx,sy) t.sx,t.sy=t.sx*sx,t.sy*(sy or sx) end)
rawset(g,'rotate',noop)
-- Where the editing field's face was drawn: Input.draw and the lobby code both draw it here.
local drawn
local background=Input.background
Input.background=function(item,editing,...)
  if editing then
    check(not drawn,'One field draws as editing')
    drawn={t.x+item.x*t.sx,t.y+item.y*t.sy,item.w*t.sx,item.h*t.sy}
  end
  return background(item,editing,...)
end
local function near(a,b) return math.abs(a-b)<1e-6 end
-- Draws the screen and compares the editing field's face with its editBox.
local function matches(label,screen,draw)
  drawn=nil;t={x=0,y=0,sx=1,sy=1};stack={}
  draw()
  check(#stack==0,label..': the draw left the transform stack balanced')
  local box={screen:editBox()}
  check(drawn,label..': a field draws as editing')
  check(#box==4,label..': editBox gives a box')
  for i=1,4 do
    check(near(box[i],drawn[i]),label..': editBox '..table.concat(box,',')..' is where the field draws, '..table.concat(drawn,','))
  end
end
local function idle(label,screen)
  check(screen:editBox()==nil,label..': no box while no field edits')
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
local VIEWS={{1280,800,'landscape'},{480,850,'portrait'}}
local function find(list,pred) for i,c in ipairs(list) do if pred(c) then return i,c end end end

-- The deck library: the search, and the name in the New deck dialog as it slides in.
local Library=require('ui.library')
for _,view in ipairs(VIEWS) do
  local l=Library.new({command=noop,announce=noop,feedback=noop})
  local count=view[3]=='portrait' and 4 or 12
  local lines={table.concat({1,'ready','0','','','name-asc','1','2',count,''},'\t')}
  for i=1,count do lines[#lines+1]='D\tdeck'..i..'\tDeck '..i..'\t60\t0\t' end
  l:layout(view[1],view[2]);l:sync(table.concat(lines,'\n'));l:layout(view[1],view[2])
  idle('library '..view[3],l)
  l:activate((find(l.controls,function(b) return b.action=='input-search' end)))
  matches('library search '..view[3],l,function() l:draw(shaders) end)
  l:input('1\tsearch\tfire\t4\t4\tdone');idle('library after its search ends '..view[3],l)
  l:activate((find(l.controls,function(b) return b.action=='new-deck' end)))
  l.modal.motion.VT.y=3.5
  l:activate((find(l.controls,function(b) return b.action=='input-name' end)))
  matches('library deck name, its dialog sliding in '..view[3],l,function() l:draw(shaders);l:drawModal() end)
  l:closeModal();idle('library with its dialog closed '..view[3],l)
end

-- The builder: deck name and card search on the page, rules text and option search in their
-- dialogs, the decklist in the transfer dialog.
local Builder=require('ui.builder')
local B=Wire.builder
local function builderSnapshot(results)
  local lines={row(nil,B.header,{revision=1,phase='ready',name='Fire Deck',format='standard',saveStatus='',message='',
    busy=0,page=1,pages=3,total=24,count=14,selected='',details='',transfer='',cover='',importing=0,dirty=0,retry=0})}
  for i=1,results do
    lines[#lines+1]=row('C',B.card,{cardId='c'..i,name='Card '..i,supertype='Pokémon',subtype='Basic',
      quantity=0,remaining=2,hp=70,mark='G',number=tostring(i),copyLimit=4,illegal=0,gaps=''})
  end
  for i,key in ipairs({'supertype','types','subtypes','suffixes','rarities','legalOnly'}) do
    lines[#lines+1]=row('O',B.option,{key=key,label='Option '..i,value='All',count=3,index=1,selected=1})
  end
  return table.concat(lines,'\n')
end
local mailboxes,ended=require('ui.host_constants').mailboxes,0
for _,view in ipairs(VIEWS) do
  local b=Builder.new({command=noop,feedback=noop,announce=noop,signin=noop})
  b:layout(view[1],view[2]);b:sync(builderSnapshot(view[3]=='portrait' and 4 or 8));b:layout(view[1],view[2])
  local function edit(field,label,draw)
    local i=find(b.controls,function(c) return c.action=='input' and c.arg==field end)
    check(i,'builder '..label..' has its field')
    b:activate(i)
    matches('builder '..label,b,draw or function() b:draw(shaders);b:drawModal(shaders) end)
    ended=ended+1;Stub.files[mailboxes.builderInput]=ended..'\t'..field..'\t\t0\t0\tdone';b:update(0,1,-1000,-1000,false)
  end
  idle('builder '..view[3],b)
  edit('query','card search '..view[3])
  if view[3]=='portrait' then b.tab='deck';b:build() end
  edit('name','deck name '..view[3])
  b.tab='catalog';b:build()
  b:openModal('filters');b.modal.motion.VT.y=2
  for page=1,4 do
    if find(b.controls,function(c) return c.action=='input' and c.arg=='text' end) then break end
    b.filterPage=page;b:build()
  end
  edit('text','rules text, its dialog sliding '..view[3])
  b:closeModal()
  b:openModal('choices',{key='types',label='Types'})
  edit('optionQuery','option search '..view[3])
  b:closeModal()
  b.transferBaseline='';b:openModal('transfer');b:refreshTransferControls()
  edit('transfer','decklist '..view[3])
  b:closeModal();idle('builder with its dialogs closed '..view[3],b)
end

-- The sandbox's deck search.
local Sandbox=require('ui.sandbox')
for _,view in ipairs(VIEWS) do
  local s=Sandbox.new({command=noop,feedback=noop,announce=noop,home=noop})
  local rows={table.concat({1,'ready','0','','deck1','deck2'},'\t')}
  for i=1,12 do rows[#rows+1]='D\tdeck'..i..'\tDeck '..i..'\t60' end
  s:layout(view[1],view[2]);s:sync(table.concat(rows,'\n'));s:layout(view[1],view[2])
  idle('sandbox '..view[3],s)
  s:activate((find(s.controls,function(b) return b.input end)))
  matches('sandbox search '..view[3],s,function() s:draw() end)
  s:input('2\tsearch\t\t0\t0\tdone');idle('sandbox after its search ends '..view[3],s)
end

-- The lobby: the code on the Join tab as the lobby slides in, and the deck picker's search.
local Online=require('ui.online')
local W=Wire.online
for _,view in ipairs(VIEWS) do
  local o=Online.new({command=noop,announce=noop,feedback=noop,jiggle=noop,home=noop,signin=noop})
  local revision=0
  local function snapshot(step,rows)
    revision=revision+1
    local lines={row(nil,W.header,{revision=revision,step=step,busy=0,message='',code=step=='menu' and '' or 'ABCD',
      role=step=='menu' and '' or 'host',link=step=='menu' and '' or 'connected',countdown='',notice='',deckPhase='ready',name='Ash',
      account='authenticated',canKick=0,status=''})}
    for _,r in ipairs(rows or {}) do lines[#lines+1]=row(r[1],r[1]=='P' and W.seat or W.deck,r[2]) end
    o:sync(table.concat(lines,'\n'))
  end
  o:layout(view[1],view[2]);o:open(false,'');snapshot('menu')
  o:update(1/60,20,-1000,-1000,false)
  check(o:offset()~=0,'The lobby is still sliding in')
  idle('lobby '..view[3],o)
  o:keypressed('right');o:keypressed('q')
  matches('lobby code, sliding in '..view[3],o,function() o:draw() end)
  o:input('1\tcode\tQ\t1\t1\tdone');idle('lobby after its code ends '..view[3],o)
  local rows={{'P',{seat='you',present=1,name='Ash',connected=1,ready=0,deckId='',deckName='',hasDeck=0}},
    {'P',{seat='opponent',present=1,name='Misty',connected=1,ready=0,deckId='',deckName='',hasDeck=0}}}
  for i=1,6 do rows[#rows+1]={'D',{id='deck'..i,name='Deck '..i,count=60,standard=1,expanded=0,online=1,formatName='Standard'}} end
  snapshot('versus',rows)
  o:activate((find(o.items,function(item) return item.action=='choose' end)))
  check(o.picker,'The deck picker opens')
  o:activate((find(o.items,function(item) return item.kind=='field' end)))
  matches('lobby deck search '..view[3],o,function() o:draw() end)
end

-- Settings: sign-in and sign-up fields, the deletion's confirmation, the account name and the
-- name prompt, while the popup slides in.
local Settings=require('ui.settings')
local Preferences=require('ui.preferences')
local Account=require('ui.account')
for _,view in ipairs(VIEWS) do
  local account=Account.new();account.status='anonymous'
  local popup=Settings.new(Preferences.new(),{auth=noop,account=noop,feedback=noop,announce=noop,close=noop,changed=noop,
    reduced=function() return false end},false,false,account)
  popup:layout(view[1],view[2]);popup.motion.VT.y=1.5
  idle('settings '..view[3],popup)
  local function authField(mode,field)
    popup:openAuth(mode)
    local i=find(popup.items,function(item) return item.kind=='auth-field' and item.field==field end)
    check(i,mode..' has its '..field)
    popup:activate(i)
    matches(mode..' '..field..' '..view[3],popup,function() popup:draw() end)
    popup:authInput(table.concat({7,'','','','',0,0,'done',field},'\t'))
    idle(mode..' after its '..field..' ends '..view[3],popup)
    popup:closeAuth()
  end
  authField('login','email');authField('login','password')
  authField('register','email');authField('register','password');authField('register','name')
  account.status='authenticated';account.hasPassword=true
  authField('delete','password')
  account.hasPassword=false
  authField('delete','email')
  account.name='Ash';popup.tab=Settings.tabs.account;popup:build()
  popup:activate((find(popup.items,function(item) return item.action=='edit' end)))
  check(account.editing,'The account name edits')
  matches('account name '..view[3],popup,function() popup:draw() end)
  account.editing=false;idle('account name done '..view[3],popup)
  popup:openNamePrompt(true)
  popup:activate((find(popup.items,function(item) return item.action=='edit' end)))
  matches('name prompt '..view[3],popup,function() popup:draw() end)
  account.editing=false
end
print('PASS: every text field says where it is drawn while it edits, and nothing while none does')
