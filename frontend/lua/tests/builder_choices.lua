-- The builder's option lists: Enter on a focused filter cycle, or a click on its centre, opens
-- that filter's searchable, paged, multi-select list; the arrows and Left/Right still step the
-- cycle. The list searches, picks, pages, marks what is chosen, announces each change, keeps
-- focus on the control it was on, and Back or Escape returns to the Filters dialog.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
require('support.draw_stub').install()
local Codec=require('ui.codec')
local Controls=require('ui.controls')
local Button=require('ui.button')
local T=require('ui.theme')
local W=require('ui.wire_fields').builder
local Builder=require('ui.builder')
local function check(ok,message) if not ok then error(message,2) end end
local function noop() end

local said,sent={},{}
local function last() return said[#said] or '' end
local function lastSent() return sent[#sent] or {} end
local function callbacks()
  return {command=function(raw) sent[#sent+1]=Codec.fields(raw) end,announce=function(text) said[#said+1]=text end,
    feedback=noop,signin=noop}
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
local function fixture(name)
  local f=assert(io.open('frontend/lua/tests/fixtures/'..name,'rb'));local raw=f:read('*a');f:close()
  return (raw:gsub('\n$',''))
end
-- The pinned snapshot with revision `rev`, its types option showing `types`, plus `extra` rows.
local revision=100
local function snapshot(types,extra)
  revision=revision+1
  local lines={}
  for line in fixture('builder_snapshot.txt'):gmatch('[^\n]+') do
    if #lines==0 then line=line:gsub('^%d+',tostring(revision)) end
    if line:match('^O\ttypes\t') then
      line=row('O',W.option,{key='types',label='Energy type',value=types and types.value or 'All',count=11,
        index=types and types.index or 1,selected=types and types.selected or '1'})
    end
    lines[#lines+1]=line
  end
  for _,r in ipairs(extra or {}) do lines[#lines+1]=r end
  return table.concat(lines,'\n')
end
-- The types list's rows: page `page` of `pages`, searched for `query`, with `choices`
-- ({value,label,selected}).
local function list(page,pages,query,choices,key,label)
  local rows={row('P',W.picker,{key=key or 'types',label=label or 'Energy type',page=page,pages=pages,query=query or ''})}
  for _,c in ipairs(choices) do rows[#rows+1]=row('Q',W.choice,{value=c[1],label=c[2],selected=c[3] and 1 or 0}) end
  return rows
end
local PAGE1={{'','All',true},{'Grass','Grass'},{'Fire','Fire'},{'Water','Water'},{'Lightning','Lightning'},{'Psychic','Psychic'},{'Fighting','Fighting'}}
local PAGE2={{'Darkness','Darkness'},{'Metal','Metal'},{'Dragon','Dragon'},{'Colorless','Colorless'},{'Fairy','Fairy'}}
local function find(b,pred) for i,c in ipairs(b.controls) do if pred(c) then return i,c end end end
local function arrow(b,key,side) return find(b,function(c) return c.cycleKey==key and c.label==side end) end
local function centreOf(b,key) return find(b,function(c) return c.cycleCentre and c.arg==key end) end
local function click(b,c) local x,y=c.x+c.w/2,c.y+c.h/2;b:mousepressed(x,y);b:mousereleased(x,y) end
local function sentWith(action) for i=#sent,1,-1 do if sent[i][1]==action then return sent[i] end end end

for _,view in ipairs({{1280,800},{480,850}})do
  local tag=view[1]..'x'..view[2]
  local b=Builder.new(callbacks())
  b.reduced=true
  b:layout(view[1],view[2]);b:sync(snapshot());b:layout(view[1],view[2])
  b.filterPage=1;b:openModal('filters')

  -- The centre takes no focus: one Tab stop per filter, its '>'.
  local ci,centre=centreOf(b,'types')
  check(centre and Controls.unfocusable(centre),tag..': the cycle centre is not focusable')
  for _=1,2*#b.controls do b:keypressed('tab');check(b.focus~=ci,tag..': Tab never lands on a cycle centre') end

  -- Left and Right on the focused cycle still step it.
  local ri=arrow(b,'types','>');b.focus=ri
  b:keypressed('right');check(lastSent()[1]=='cycle' and lastSent()[2]=='types' and lastSent()[3]=='1',tag..': Right steps the filter')
  b:keypressed('left');check(lastSent()[1]=='cycle' and lastSent()[3]=='-1',tag..': Left steps the filter back')
  check(b.modal.mode=='filters',tag..': stepping keeps the Filters dialog')
  -- Its description says Enter opens the list.
  check(b:describe(b.controls[ri])=='Energy type: All, left and right change it, Enter for the list',tag..': the cycle says Enter opens its list: '..b:describe(b.controls[ri]))
  local fi=arrow(b,'format','>')
  check(b:describe(b.controls[fi])=='Format: Standard, left and right change it',tag..': Format has no list to mention')

  -- The arrows still step on a click.
  local _,left=arrow(b,'types','<');click(b,left)
  check(lastSent()[1]=='cycle' and lastSent()[2]=='types' and lastSent()[3]=='-1' and b.modal.mode=='filters',tag..': a click on < steps back')
  local _,right=arrow(b,'types','>');click(b,right)
  check(lastSent()[1]=='cycle' and lastSent()[3]=='1' and b.modal.mode=='filters',tag..': a click on > steps on')

  -- Format's centre has no list: it stays inert, and Enter on Format still steps it.
  local fc=select(2,centreOf(b,'format'));local before=#sent;click(b,fc)
  check(#sent==before and b.modal.mode=='filters',tag..': the Format centre opens nothing')
  b.focus=arrow(b,'format','>');b:keypressed('return')
  check(lastSent()[1]=='format' and b.modal.mode=='filters',tag..': Enter on Format steps it')

  -- Enter on the focused cycle opens its list, with focus on the search field.
  b.choices={{value='old',label='Stale',selected=false}};b.optionLabel='Old'
  b.focus=arrow(b,'types','>');said={};local sentBefore=#sent
  b:keypressed('return')
  check(lastSent()[1]=='options' and lastSent()[2]=='types',tag..': Enter asks for the types list')
  for i=sentBefore+1,#sent do check(sent[i][1]~='cycle',tag..': Enter does not step the cycle') end
  check(b.modal and b.modal.mode=='choices',tag..': Enter opens the list')
  check(#b.choices==0 and b.optionLabel=='Energy type',tag..': the list opens empty under its own title, not the last one')
  local field=b.controls[b.focus]
  check(field and field.input and field.arg=='optionQuery',tag..': focus lands on the search field')
  check(#said==0,tag..': the list is announced once its rows arrive')
  b:sync(snapshot(nil,list(1,2,'',PAGE1)))
  check(last()=='Energy type. Page 1 of 2. Find an option: empty. Enter to edit.',tag..': opening says the list and the focused field: '..last())
  check(b.modal.mode=='choices' and b.controls[b.focus].arg=='optionQuery','The rows keep focus on the field')

  -- Its rows: the selected one draws blue with the chosen marker.
  local rows={}
  for _,c in ipairs(b.controls)do if c.action=='option-pick' then rows[#rows+1]=c end end
  check(#rows==7 and rows[1].label=='All' and rows[1].chosen and rows[1].colour==T.blue and rows[2].colour==T.red and not rows[2].chosen,tag..': the rows draw what is chosen')
  -- Blue is the mark: a chosen marker above a row would cover the row above it.
  local marked=0
  local chosen=Button.chosen
  Button.chosen=function(c,...) marked=marked+1;return chosen(c,...) end
  b:drawModal(setmetatable({},{__index=function() return {send=noop} end}))
  Button.chosen=chosen
  check(marked==0,tag..': the rows draw no chosen marker over each other')

  -- The search field edits the list's query.
  b:activate(b.focus,true)
  check(lastSent()[1]=='input' and lastSent()[2]=='optionQuery',tag..': the search field opens its editor')
  b.editing='';b:sync(snapshot(nil,list(1,1,'wa',{{'Water','Water'}})))
  check(b.fields.optionQuery=='wa' and #b.choices==1,tag..': the search narrows the rows')
  check(b:describe(b.controls[1])=='Find an option: wa. Enter to edit.',tag..': the field says its query')
  b:sync(snapshot(nil,list(1,2,'',PAGE1)))

  -- Arrows move through the rows.
  b.focus=1;b:keypressed('down')
  check(b.controls[b.focus].action=='option-pick' and b.controls[b.focus].arg=='',tag..': Down moves from the field to the first row')
  b:keypressed('down');check(b.controls[b.focus].arg=='Grass',tag..': Down moves to the next row')
  check(last()=='Grass',tag..': a row says its label')

  -- Picks: each toggles its value, announced with the filter's new state.
  b:keypressed('down');check(b.controls[b.focus].arg=='Fire')
  b:keypressed('return');check(lastSent()[1]=='option-pick' and lastSent()[2]=='Fire',tag..': Enter picks the row')
  b:sync(snapshot({value='Fire',index=3,selected='3'},list(1,2,'',{{'','All'},{'Grass','Grass'},{'Fire','Fire',true},PAGE1[4],PAGE1[5],PAGE1[6],PAGE1[7]})))
  check(last()=='Fire, selected. Energy type: Fire',tag..': a pick says the row and the filter: '..last())
  check(b.controls[b.focus].arg=='Fire',tag..': focus stays on the picked row')
  b:keypressed('down');check(b.controls[b.focus].arg=='Water')
  b:keypressed('space');check(lastSent()[1]=='option-pick' and lastSent()[2]=='Water',tag..': Space picks too')
  b:sync(snapshot({value='2 selected',index=3,selected='3,4'},list(1,2,'',{{'','All'},{'Grass','Grass'},{'Fire','Fire',true},{'Water','Water',true},PAGE1[5],PAGE1[6],PAGE1[7]})))
  check(last()=='Water, selected. Energy type: 2 selected',tag..': a second pick says both are chosen: '..last())
  b:keypressed('return')
  b:sync(snapshot({value='Fire',index=3,selected='3'},list(1,2,'',{{'','All'},{'Grass','Grass'},{'Fire','Fire',true},{'Water','Water'},PAGE1[5],PAGE1[6],PAGE1[7]})))
  check(last()=='Water, not selected. Energy type: Fire',tag..': picking a chosen row clears it: '..last())
  b:keypressed('return')
  b:sync(snapshot({value='2 selected',index=3,selected='3,4'},list(1,2,'',{{'','All'},{'Grass','Grass'},{'Fire','Fire',true},{'Water','Water',true},PAGE1[5],PAGE1[6],PAGE1[7]})))

  -- The pager: '>' turns the page, says it, and keeps focus on '>' though the page is shorter.
  local ni,next=find(b,function(c) return c.action=='option-page' and c.arg==1 end)
  check(next and not Controls.unfocusable(next) and b:describe(next)=='Next page, page 1 of 2',tag..': the list pager says its page')
  b.focus=ni;b:keypressed('return');check(lastSent()[1]=='option-page' and lastSent()[2]=='1',tag..': Enter on > turns the list page')
  b:sync(snapshot({value='2 selected',index=3,selected='3,4'},list(2,2,'',PAGE2)))
  check(last()=='Page 2 of 2',tag..': the page turn is announced: '..last())
  local focused=b.controls[b.focus]
  check(focused and focused.action=='option-page' and focused.arg==1,tag..': focus stays on the pager arrow')
  click(b,select(2,find(b,function(c) return c.action=='option-page' and c.arg==-1 end)))
  check(lastSent()[1]=='option-page' and lastSent()[2]=='-1',tag..': a click on < turns back')
  b:sync(snapshot({value='2 selected',index=3,selected='3,4'},list(1,2,'',{{'','All'},{'Grass','Grass'},{'Fire','Fire',true},{'Water','Water',true},PAGE1[5],PAGE1[6],PAGE1[7]})))

  -- All clears the selection.
  local ai=find(b,function(c) return c.action=='option-pick' and c.arg=='' end)
  b.focus=ai;b:keypressed('return');check(lastSent()[1]=='option-pick' and lastSent()[2]=='',tag..': All sends the empty pick')
  b:sync(snapshot(nil,list(1,2,'',PAGE1)))
  check(last()=='All, selected. Energy type: All',tag..': All says the filter is clear: '..last())

  -- Escape returns to the Filters dialog, focus back on the cycle that opened the list.
  said={};b:keypressed('escape')
  check(sentWith('options') and lastSent()[1]=='options' and lastSent()[2]=='',tag..': closing the list releases it')
  check(b.modal and b.modal.mode=='filters',tag..': Escape returns to Filters')
  local back=b.controls[b.focus]
  check(back and back.cycleKey=='types' and back.label=='>',tag..': a keyboard close refocuses the cycle')
  check(last():match('^Filters, Cards tab%.') and last():match('Energy type: All, left and right change it, Enter for the list$'),tag..': the return says the dialog and the cycle: '..last())

  -- A click on the centre opens the list too, with nothing focused; Back by pointer returns.
  b:sync(snapshot({value='2 selected',index=2,selected='2,3'}))
  local _,c2=centreOf(b,'types')
  check(c2.label=='2 selected' and c2.cycleText.value=='2 selected',tag..': the cycle centre shows the count')
  check(b:describe(b.controls[arrow(b,'types','>')])=='Energy type: 2 selected, left and right change it, Enter for the list',tag..': the cycle says the count')
  click(b,c2)
  check(lastSent()[1]=='options' and lastSent()[2]=='types' and b.modal.mode=='choices' and b.focus==0,tag..': a click on the centre opens the list')
  b:sync(snapshot({value='2 selected',index=2,selected='2,3'},list(1,2,'',PAGE1)))
  check(last()=='Energy type. Page 1 of 2.',tag..': a pointer open says the list: '..last())
  local _,backButton=find(b,function(c) return c.action=='close' end)
  click(b,backButton)
  check(lastSent()[1]=='options' and lastSent()[2]=='' and b.modal.mode=='filters' and b.focus==0,tag..': Back by pointer returns to Filters with nothing focused')

  -- Another filter's list: the Print tab's Set, a single value.
  b.filterPage=2;b:build()
  local si=arrow(b,'setId','>');check(si,tag..': the Print tab has Set')
  b.focus=si;b:keypressed('return')
  check(lastSent()[1]=='options' and lastSent()[2]=='setId' and b.optionLabel=='Set',tag..': Enter opens the Set list')
  b:sync(snapshot({value='2 selected',index=2,selected='2,3'},list(1,1,'',{{'','All',true},{'sv01','Scarlet & Violet'}},'setId','Set')))
  check(said[#said]=='Set. Page 1 of 1. Find an option: empty. Enter to edit.',tag..': the Set list announces: '..last())
  b:keypressed('escape');check(b.modal.mode=='filters' and b.filterPage==2 and b.controls[b.focus].cycleKey=='setId',tag..': Escape returns to the same tab and cycle')
  b:closeModal()
  print('PASS: '..tag..' option lists open by Enter and click, search, pick, page, mark, announce and return')
end

-- Rows the list did not ask for are not drawn: a P row for another key does not reopen anything,
-- and leaving the builder with a list open releases it.
do
  local b=Builder.new(callbacks())
  b:layout(1280,800);b:sync(snapshot(nil,list(1,1,'',PAGE1)));b:layout(1280,800)
  check(not b.modal,'A stale list row opens no dialog')
  b.filterPage=1;b:openModal('filters');b.focus=arrow(b,'types','>');b:keypressed('return')
  check(b.modal.mode=='choices','The list is open')
  b:open(true,'other')
  check(not b.modal,'Opening a deck closes the list')
end
print('PASS: option lists ignore stale rows')
