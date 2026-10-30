-- The builder's data in flight, in both layouts: results kept and dimmed while
-- a search is out (the pager says Searching...), the save caption beside the
-- deck name with its Retry, the portrait message line on both tabs, and Sort
-- in portrait's Filters dialog.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local Card=require('ui.card');Card.rebuild=function(self)self.texture={release=function()end}end
local Builder=require('ui.builder')
local Codec=require('ui.codec')
local T=require('ui.theme')
local Wire=require('ui.wire_fields')
local B=Wire.builder
local function check(ok,message) if not ok then error(message,2) end end
local shader=Stub.shader()
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader}

local function row(tag,spec,fields)
  local out={}
  local width=0
  for _,column in pairs(spec) do width=math.max(width,column) end
  for i=1,width do out[i]='' end
  if tag then out[1]=tag end
  for name,value in pairs(fields) do out[assert(spec[name],name)]=Codec.encode(value) end
  return table.concat(out,'\t')
end
local revision=0
-- A ready builder: `results` catalog cards c1..cN, a few deck rows, filters.
local function snapshot(o)
  revision=revision+1
  local lines={row(nil,B.header,{revision=revision,phase='ready',name='Fire Deck',format='standard',
    saveStatus=o.saveStatus or '',message=o.message or '',busy=o.busy and 1 or 0,page=o.page or 1,pages=3,total=24,count=14,
    selected='',details='',transfer='',cover='',importing=0,dirty=0,retry=o.retry and 1 or 0})}
  for i=1,o.results or 8 do
    lines[#lines+1]=row('C',B.card,{cardId=(o.prefix or 'c')..i,name='Card '..i,supertype='Pokémon',subtype='Basic',
      quantity=i==1 and 2 or 0,remaining=2,hp=70,mark='G',number=tostring(i),copyLimit=4,illegal=0,gaps=''})
  end
  for i=1,3 do
    lines[#lines+1]=row('D',B.card,{cardId='d'..i,name='Deck card '..i,supertype='Pokémon',subtype='Basic',quantity=2,
      remaining=2,hp=60,mark='G',number=tostring(i),copyLimit=4,illegal=0,gaps=''})
  end
  lines[#lines+1]=row('V',B.validation,{message='54 more cards to reach 60.',pokemon=6,trainer=0,energy=0})
  for i,key in ipairs({'supertype','types','subtypes','suffixes','rarities','legalOnly'}) do
    lines[#lines+1]=row('O',B.option,{key=key,label='Option '..i,value='All',count=3,index=1,selected=1})
  end
  lines[#lines+1]=row('F',B.field,{key='sort',value=o.sort or 'name'})
  return table.concat(lines,'\n')
end
local VIEWS={{1280,800,8,'landscape'},{480,850,4,'portrait'}}
local function builder(view)
  local sent,said={},{}
  local b=Builder.new({command=function(raw) sent[#sent+1]=Codec.fields(raw) end,feedback=function() end,
    announce=function(text) said[#said+1]=text end,signin=function() end})
  b:layout(view[1],view[2]);b:sync(snapshot({results=view[3]}));b:layout(view[1],view[2])
  return b,sent,said
end
local function find(b,pred) for i,c in ipairs(b.controls) do if pred(c) then return i,c end end end
local function overlaps(a,x,y,w,h) return a.x<x+w and x<a.x+a.w and a.y<y+h and y<a.y+a.h end
-- The text the page draws, with where it draws it.
local function drawn(b)
  local out={};local text=T.text
  T.text=function(value,size,x,y,w,...) out[#out+1]={text=value,size=size,x=x,y=y,w=w};return text(value,size,x,y,w,...) end
  local ok,err=pcall(function() b:draw(shaders) end)
  T.text=text
  check(ok,tostring(err))
  return out
end
-- The drawn text that is `value`, or fitCaption's cut of it (the stub font is wider than the game's).
local function textAt(list,value)
  for _,t in ipairs(list) do
    local cut=t.text:match('^(.-)%.%.%.$')
    if t.text==value or cut and #cut>=8 and value:sub(1,#cut)==cut then return t end
  end
end

-- PG5: a search keeps the results on screen, dimmed, until its page lands.
for _,view in ipairs(VIEWS) do
  local b,sent=builder(view)
  local cards={};for i,c in ipairs(b.cards) do cards[i]=c;check(not c.greyed,view[4]..': results are not dimmed while idle') end
  check(b.pageText.value=='Page 1/3',view[4]..': the pager shows the page')
  b:sync(snapshot({results=view[3],busy=true}))
  check(#b.cards==view[3],view[4]..': the results stay while the search is out')
  for i,c in ipairs(b.cards) do
    check(c==cards[i],view[4]..': kept results are not dealt again')
    check(c.greyed,view[4]..': kept results draw dimmed')
  end
  check(b.pageText.value=='Searching...',view[4]..': the pager says Searching... ('..b.pageText.value..')')
  drawn(b)
  -- A dimmed card still opens its details and still drags into the deck: its id is valid.
  local i=find(b,function(c) return c.action=='card' and c.card==2 end)
  b:activate(i)
  check(sent[#sent-0][1]=='detail' and sent[#sent][2]=='c2' or sent[#sent-1][1]=='detail' and sent[#sent-1][2]=='c2',view[4]..': a dimmed card opens its details')
  check(b.modal and b.modal.mode=='detail',view[4]..': the details dialog opens')
  b:closeModal()
  local c=b.cards[1];b:mousepressed(c.x,c.y);b.drag.active=true;c.dragging=true
  if view[4]=='landscape' then b:mousereleased(950,350) else b:mousereleased(240,b.height-100) end
  check(sent[#sent][1]=='add' and sent[#sent][2]=='c1',view[4]..': a dimmed card drags into the deck')
  b:sync(snapshot({results=view[3],prefix='n'}))
  for _,c in ipairs(b.cards) do check(not c.greyed,view[4]..': the new page is not dimmed') end
  check(b.cards[1].item.id=='n1' and b.pageText.value=='Page 1/3',view[4]..': the new page replaces the old one')
  b:sync(snapshot({results=0,busy=true}))
  check(textAt(drawn(b),'Loading cards...'),view[4]..': an empty grid says loading')
end
print('PASS: results stay, dimmed and still usable, while a search is out; the pager says Searching...')

-- PG6: the save caption beside the deck name, and its Retry.
local CAPTIONS={pending='Saving...',saving='Saving...',saved='Saved',retrying='Retrying...',failed='Not saved'}
for _,view in ipairs(VIEWS) do
  for _,tab in ipairs(view[4]=='portrait' and {'catalog','deck'} or {'catalog'}) do
    local b,sent=builder(view)
    b.tab=tab;b:build()
    local where=view[4]..' '..tab
    local x,y,w,h=b:statusSlot()
    check(x>=0 and y>=0 and x+w<=b.width and y+h<=b.height,where..': the save caption is on screen')
    for _,c in ipairs(b.controls) do check(not overlaps(c,x,y,w,h),where..': the save caption is clear of '..c.action) end
    local _,name=find(b,function(c) return c.input and c.arg=='name' end)
    if name then check(name.x+name.w<x and name.y==y,where..': the caption sits beside the deck name') end
    check(not textAt(drawn(b),'Saving...'),where..': nothing is said while there is nothing to save')
    for status,caption in pairs(CAPTIONS) do
      b:sync(snapshot({results=view[3],saveStatus=status,message=status=='failed' and 'Could not save. Your edits are kept. Retry.' or ''}))
      check(b:saveCaption()==caption,where..': '..status..' reads '..tostring(b:saveCaption()))
      local t=textAt(drawn(b),caption)
      -- Portrait's catalog Retry save button covers the caption's place and says it itself.
      if status=='failed' and where=='portrait catalog' then check(not t,where..': Retry save stands in for Not saved')
      else check(t and t.x>=x and t.x+(t.w or 0)<=x+w and t.y>=y and t.y<y+h,where..': '..caption..' draws in its place') end
      b:build()
      local i,retry=find(b,function(c) return c.action=='retry-save' end)
      if status=='failed' then
        -- The user's rule: buttons keep their look and text, so Retry save is the button it was.
        local p=view[4]=='portrait'
        check(retry and retry.label==(p and 'Retry save' or 'Retry') and retry.colour==T.red and retry.fontSize==(p and 24 or 16),where..': Retry save keeps its look and text')
        check(retry.x==(p and 24 or 1122) and retry.w==(p and 432 or 110) and retry.h==(p and 36 or 18),where..': Retry save keeps its place and size')
        for _,c in ipairs(b.controls) do check(c==retry or not overlaps(c,retry.x,retry.y,retry.w,retry.h),where..': Retry save is clear of '..c.action) end
        check(b:describe(retry)=='Retry save',where..': Retry says what it retries')
        b:activate(i);check(sent[#sent][1]=='retry-save',where..': Retry sends the save again')
      else
        check(not retry,where..': only a failed save offers Retry')
      end
    end
  end
end
print('PASS: the save caption reads Saving, Saved, Retrying and Not saved beside the deck name, and Retry save is unchanged')

-- Failure and recovery are each announced once; saving and retrying say nothing.
do
  local b,_,said=builder(VIEWS[1])
  local function heard(o) local before=#said;b:sync(snapshot(o));local out={};for i=before+1,#said do out[#out+1]=said[i] end;return table.concat(out,' | ') end
  check(heard({saveStatus='pending'})=='','Pending is not announced')
  check(heard({saveStatus='saving'})=='','Saving is not announced')
  check(heard({saveStatus='saved'})=='','A save that never failed is not announced')
  check(heard({saveStatus='retrying'})=='','Retrying is not announced')
  local failed='Could not save. Your edits are kept. Retry.'
  check(heard({saveStatus='failed',message=failed})==failed,'The failure is announced')
  check(heard({saveStatus='failed',message=failed})=='','The failure is announced once')
  check(heard({saveStatus='saving'})=='','Its retry is not announced')
  check(heard({saveStatus='saved'})=='Deck saved.','The recovery is announced')
  check(heard({saveStatus='saved'})=='','The recovery is announced once')
  check(heard({saveStatus=''})=='','The caption clearing is not announced')
end
print('PASS: a failed save and its recovery are each announced once')

-- PG4: portrait draws builder messages on a line of their own on both tabs.
do
  local messages={'This card has reached its copy limit.','Resolve unavailable cards before adding more.',
    'Deck changed elsewhere; reloaded the latest.','Could not save. Your edits are kept. Retry.','Card search failed. Try again.'}
  for _,view in ipairs(VIEWS) do
    for _,tab in ipairs(view[4]=='portrait' and {'catalog','deck'} or {'catalog'}) do
      local b=builder(view);b.tab=tab;b:build()
      local where=view[4]..' '..tab
      local x,y,w=b:messageLine()
      for _,message in ipairs(messages) do
        b:sync(snapshot({results=view[3],message=message}))
        local t=textAt(drawn(b),message)
        check(t and t.x==x and t.y==y and t.w==w and t.size<=18,where..': '..message..' draws on the message line')
        for _,c in ipairs(b.controls) do check(not overlaps(c,x,y,w,20),where..': the message line is clear of '..c.action..' '..tostring(c.label)) end
      end
      if view[4]=='portrait' and tab=='catalog' then
        -- Below the second row of cards and their counts, above the pager.
        local bottom=0
        for _,c in ipairs(b.cards) do bottom=math.max(bottom,c.homeY+94.5*c.baseScale+12+20) end
        local _,pager=find(b,function(c) return c.action=='page' end)
        check(y>=bottom and y+20<=pager.y,'portrait catalog: the message line clears the grid ('..bottom..') and the pager ('..pager.y..')')
        local sx,sy,sw,sh=b:statusSlot()
        check(x+w<=sx and sy<=y and sy+sh>=y+20,'portrait catalog: the message shares its row with the save caption')
      elseif view[4]=='portrait' then
        local _,import=find(b,function(c) return c.action=='transfer' end)
        local _,kind=find(b,function(c) return c.action=='deck-type' end)
        -- Above the chosen deck type's marker, which rises up to 29 px over its tab.
        check(y>=import.y+import.h and y+20<=kind.y-29,'portrait deck: the message line sits under Import / Clear, above the deck types')
      end
      -- A load failure keeps its Retry, clear of the message.
      b:sync(snapshot({results=view[3],message='Card search failed. Try again.',retry=true}))
      local _,retry=find(b,function(c) return c.action=='retry' end)
      if where=='portrait catalog' then
        check(retry and not textAt(drawn(b),'Card search failed. Try again.'),where..': Retry loading takes the message line')
      else check(retry and not overlaps(retry,x,y,w,20),where..': Retry loading is clear of the message line') end
    end
  end
  -- While a card is dragged, the drop hint takes the catalog's message line.
  local b=builder(VIEWS[2]);b:sync(snapshot({results=4,message='This card has reached its copy limit.'}))
  local c=b.cards[1];b:mousepressed(c.x,c.y);b.drag.active=true;c.dragging=true
  local list=drawn(b)
  check(textAt(list,'Drop here to add to deck') and not textAt(list,'This card has reached its copy limit.'),'The drop hint replaces the message while dragging')
  b:cancelInteractions()
end
print('PASS: portrait draws builder messages on the catalog and deck tabs, clear of the grid, pager and controls')

-- PG4: portrait sorts from the Filters dialog's Cards tab, in its free last slot.
do
  local b,sent=builder(VIEWS[2])
  b.filterPage=1;b:openModal('filters')
  local _,centre=find(b,function(c) return c.cycleCentre and c.arg=='sort' end)
  check(centre and centre.optionTitle=='Sort' and centre.label=='Name' and centre.pipCount==3 and centre.pipIndex==1,'Portrait Filters has a Sort cycle')
  local cycles={};for _,c in ipairs(b.controls) do if c.cycleCentre then cycles[#cycles+1]=c end end
  check(#cycles==8 and cycles[8]==centre and cycles[7].y==centre.y,'Sort fills the last slot beside the seventh filter')
  local i,right=find(b,function(c) return c.action=='sort' and c.label=='>' end)
  check(right.colour==T.red and right.w==28.8,'Sort uses the filter cycle look')
  b:activate(i);check(sent[#sent][1]=='sort' and sent[#sent][2]=='1','Its > steps the sort forward')
  local left=find(b,function(c) return c.action=='sort' and c.label=='<' end)
  b:activate(left);check(sent[#sent][1]=='sort' and sent[#sent][2]=='-1','Its < steps the sort back')
  b.focus=i;b:keypressed('left');check(sent[#sent][1]=='sort' and sent[#sent][2]=='-1','Left steps the sort back')
  b.focus=i;b:keypressed('right');check(sent[#sent][1]=='sort' and sent[#sent][2]=='1','Right steps the sort forward')
  check(b:describe(right)=='Sort: Name, left and right change it','The Sort cycle says its value')
  b:sync(snapshot({results=4,sort='hp-desc'}))
  local _,after=find(b,function(c) return c.cycleCentre and c.arg=='sort' end)
  check(after.label=='HP' and after.pipIndex==2,'The cycle follows the sort')
  b:closeModal()
  local l=builder(VIEWS[1]);l.filterPage=1;l:openModal('filters')
  check(not find(l,function(c) return c.arg=='sort' end),'Landscape keeps Sort beside Filters, not in the dialog')
  l:closeModal()
  check(find(l,function(c) return c.action=='sort' end),'Landscape still has its Sort button')
end
print('PASS: portrait sorts from the Filters dialog with the cycle look, by pointer and keys')
