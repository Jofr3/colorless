package.path='frontend/lua/?.lua;'..package.path
love={graphics={},keyboard={isDown=function() return false end}}
local Settings=require('ui.settings')
local Preferences=require('ui.preferences')
local Account=require('ui.account')
local Codec=require('ui.codec')
local account=Account.new(); account.status='anonymous'
local commands={}
local popup=Settings.new(Preferences.new(),{
  auth=function(cmd) commands[#commands+1]=cmd end,feedback=function() end,announce=function() end,
  close=function() error('Auth Back must return to Settings') end,
},true,true,account)
popup:layout(1280,800); popup:openAuth('login')
assert(popup.h==560 and popup.auth.mode=='login')
popup:activate(3); assert(commands[#commands]=='edit\temail')
local function input(fields)
  local result={}; for _,v in ipairs(fields) do result[#result+1]=Codec.encode(v) end
  popup:authInput(table.concat(result,'\t'))
end
input({1,'','ash@example.com','','',15,15,'enter','email'})
assert(commands[#commands]=='edit\tpassword' and popup.auth.editing=='password')
input({2,'','ash@example.com','********','',8,8,'enter','password'})
assert(commands[#commands]=='submit')
popup:openAuth('register')
input({3,'','ash@example.com','********','',8,8,'enter','password'})
assert(commands[#commands]=='edit\tname')
input({4,'','ash@example.com','********','Ash',3,3,'enter','name'})
assert(commands[#commands]=='submit')
account.busy=true; popup:build()
local count=#commands; popup:activate(6); assert(#commands==count)
account.busy=false
popup:layout(480,850)
for _,item in ipairs(popup.items) do
  assert(item.x>=popup.x and item.x+item.w<=popup.x+popup.w)
  assert(item.y>=popup.y and item.y+item.h<=popup.y+popup.h)
end
popup:keypressed('escape'); assert(not popup.auth and popup.tab==4)
popup:openAuth('login'); account.status='authenticated'; popup:accountChanged()
assert(not popup.auth and popup.tab==4 and commands[#commands]=='close')
print('PASS: auth modal fields, Enter progression, busy guard, portrait bounds, Back and success return')

-- Deleting the account: the tab's button opens a form, whose button must be pressed twice.
local function openDelete(hasPassword)
  account.hasPassword=hasPassword; popup:layout(1280,800)
  for i,item in ipairs(popup.items) do if item.action=='delete' then popup:activate(i) end end
  assert(popup.auth and popup.auth.mode=='delete' and commands[#commands]=='open\tdelete')
end
local function confirm() return popup.items[popup.focus] end
openDelete(true)
assert(popup.items[1].field=='password' and popup.items[2].kind=='delete-confirm')
input({1,'','','********','',8,8,'enter','password'})
assert(confirm().kind=='delete-confirm' and commands[#commands]~='submit','Enter only moves to the button')
popup.time=10; popup:activate(popup.focus)
assert(popup.armed and confirm().label=='Press again to delete' and commands[#commands]~='submit')
popup.time=10.2; popup:activate(popup.focus)
assert(popup.armed and commands[#commands]~='submit','A double click does not delete')
popup.time=10.5; popup:activate(popup.focus)
assert(not popup.armed and commands[#commands]=='submit')
popup:activate(popup.focus); popup:update(0.1,13.6,-1,-1,true)
assert(not popup.armed and confirm().label=='Delete account','The armed button times out')
popup:activate(popup.focus); popup:keypressed('tab')
assert(not popup.armed,'Moving focus away disarms')
popup:layout(480,850)
for _,item in ipairs(popup.items) do
  assert(item.x>=popup.x and item.x+item.w<=popup.x+popup.w)
  assert(item.y>=popup.y and item.y+item.h<=popup.y+popup.h)
end
account.busy=true; popup:accountChanged()
assert(popup.auth and popup.items[2].label=='Please wait...','Still signed in keeps the form open')
account.busy=false; account.status='anonymous'; popup:accountChanged()
assert(not popup.auth and popup.tab==4 and commands[#commands]=='close')
account.status='authenticated'
account.email='ash@example.com'
openDelete(false)
-- An OAuth-only account types its email instead of a password; the form starts empty.
assert(popup.items[1].field=='email' and popup.items[1].label=='Type your email to confirm')
assert(popup.items[2].kind=='delete-confirm' and #popup.items==3,'An OAuth-only account has no password field')
assert(popup.auth.email=='' and popup.focus==1,'The confirmation is never prefilled')
popup:activate(1); assert(commands[#commands]=='edit\temail')
input({5,'','ash@example.com','','',15,15,'enter','email'})
assert(confirm().kind=='delete-confirm' and commands[#commands]~='submit','Enter only moves to the button')
popup.time=20; popup:activate(popup.focus); popup.time=20.5; popup:activate(popup.focus)
assert(commands[#commands]=='submit','Two presses still confirm')
popup:layout(480,850)
for _,item in ipairs(popup.items) do
  assert(item.x>=popup.x and item.x+item.w<=popup.x+popup.w)
  assert(item.y>=popup.y and item.y+item.h<=popup.y+popup.h)
end
popup:keypressed('escape'); assert(not popup.auth and popup.tab==4)
print('PASS: account deletion form, password step, press-twice lockout and timeout, busy and deleted return')

-- Signing out everywhere is one press on the account tab, sent as its own account command.
local sent={}
popup.callbacks.account=function(cmd) sent[#sent+1]=cmd end
for _,size in ipairs({{1280,800},{480,850}}) do
  popup:layout(size[1],size[2])
  local everywhere
  for i,item in ipairs(popup.items) do if item.action=='logout-all' then everywhere=i end end
  assert(everywhere and popup.items[everywhere].label=='Sign out everywhere')
  for _,item in ipairs(popup.items) do
    assert(item.x>=popup.x and item.x+item.w<=popup.x+popup.w)
    assert(item.y>=popup.y and item.y+item.h<=popup.y+popup.h)
  end
  -- The rows below the name field do not overlap, and the message line sits under the last one.
  local rows={}
  for _,item in ipairs(popup.items) do if item.action and item.action~='edit' then rows[#rows+1]=item end end
  table.sort(rows,function(a,b) return a.y<b.y end)
  for i=2,#rows do assert(rows[i].y>=rows[i-1].y+rows[i-1].h or rows[i].y==rows[i-1].y) end
  assert(rows[#rows].y+rows[#rows].h<=popup.y+488,'The message is drawn below the last button')
  popup:activate(everywhere)
end
assert(#sent==2 and sent[1]=='logout-all' and sent[2]=='logout-all')
account.busy=true; popup:build()
for i,item in ipairs(popup.items) do if item.action=='logout-all' then popup:activate(i) end end
assert(#sent==2,'Busy disables it')
account.busy=false
print('PASS: sign out everywhere button, layout in both orientations, busy guard')

-- A failed sign-in (audit PG9): focus moves to the first refused field, which opens for editing,
-- each refused field is outlined, typing in one clears its outline, and the message is 22 px.
do
  -- Settings holds love.graphics from its load: the calls it makes are added to that table.
  setmetatable(love.graphics,{__index=function() return function() end end})
  love.mouse={getPosition=function() return 0,0 end}
  local T=require('ui.theme')
  local font=T.font
  -- A font whose letters are 0.44 of its size wide, so a size change changes the wrap.
  T.font=function(size)
    local f={getHeight=function() return size end,getWidth=function(_,s) return #tostring(s)*size*0.44 end}
    function f.getWrap(_,s,w)
      local lines,line={},''
      for word in tostring(s):gmatch('%S+') do
        local next=line=='' and word or line..' '..word
        if #next*size*0.44>w and line~='' then lines[#lines+1]=line;line=word else line=next end
      end
      if line~='' then lines[#lines+1]=line end
      return w,lines
    end
    return f
  end
  local drawn={}
  local printf=love.graphics.printf
  love.graphics.printf=function(text,x,y,w) drawn[#drawn+1]={text=text,x=x,y=y,w=w,size=love.graphics.size} end
  local setFont=love.graphics.setFont
  love.graphics.setFont=function(f) love.graphics.size=f.getHeight() end
  local rects={}
  local Button=require('ui.button')
  local panel=Button.panel
  Button.panel=function(x,y,w,h,colour) rects[#rects+1]={x=x,y=y,w=w,h=h,colour=colour} end
  account.status='anonymous';account.email=''
  local said={}
  popup.callbacks.announce=function(text) said[#said+1]=text end
  popup.callbacks.auth=function(cmd) commands[#commands+1]=cmd end
  popup:layout(1280,800);popup:openAuth('register')
  local function item(field) for i,it in ipairs(popup.items) do if it.field==field then return it,i end end end
  assert(item('password').label=='Password (at least 8 characters)','Register keeps the password rule in its label')
  assert(popup:describe(item('password'))=='Password (at least 8 characters). Enter to edit.')
  popup:openAuth('login');assert(item('password').label=='Password','Sign-in asks for the password alone')
  popup:openAuth('register')
  local function fail(revision,message,invalid,failures)
    account:sync(table.concat({revision,'anonymous',0,Codec.encode(message),'','','',0,0,Codec.encode(invalid),failures},'\t'))
    popup:accountChanged()
  end
  commands={}
  fail(100,'Enter a valid email address. Passwords need at least 8 characters.','email password',1)
  local email,emailIndex=item('email')
  assert(popup.focus==emailIndex and popup.auth.editing=='email' and commands[#commands]=='edit\temail',
    'A failed submit opens the first refused field: '..tostring(commands[#commands]))
  assert(popup:describe(email)=='Email: . Needs fixing. Enter to edit.',popup:describe(email))
  local function outlined(it)
    for _,r in ipairs(rects) do if r.x<it.x and r.y<it.y and r.x+r.w>it.x+it.w and r.y+r.h>it.y+it.h and r.colour==T.red then return true end end
  end
  local function messageLines()
    local out={}
    for _,d in ipairs(drawn) do if d.text:find('Passwords need') or d.text:find('Wrong') then out[#out+1]=d end end
    return out
  end
  -- Landscape: one line at 22 px between the submit button and Google, in the shadowed pair.
  rects,drawn={},{};popup:draw()
  local submit,google
  for _,it in ipairs(popup.items) do if it.kind=='auth-submit' then submit=it elseif it.kind=='auth-google' then google=it end end
  assert(outlined(item('email')) and outlined(item('password')) and not outlined(item('name')),'Each refused field is outlined')
  local lines=messageLines()
  assert(#lines==2 and lines[2].size==22,'The message is 22 px')
  local wraps=select(2,T.font(22):getWrap(lines[2].text,lines[2].w))
  assert(#wraps==1 and lines[2].y>=submit.y+submit.h and lines[2].y+22<=google.y,'One line fits between the buttons')
  -- Portrait: two lines, a little smaller, between the buttons' faces with their shadow (QA7 bug
  -- 4: two 22 px lines ran into Continue with Google). A face lifts 1.8 at rest and its panel
  -- hangs 3 below its bounds; a line is its size tall, and the shadow 3 below it.
  local function between(d,size)
    local n=#select(2,T.font(size):getWrap(d.text,d.w))
    return d.y>=submit.y+submit.h+3 and d.y+n*size+3<=google.y-1.8,n
  end
  popup:layout(480,850);rects,drawn={},{};popup:draw()
  for _,it in ipairs(popup.items) do if it.kind=='auth-submit' then submit=it elseif it.kind=='auth-google' then google=it end end
  lines=messageLines()
  local fits,count=between(lines[2],lines[2].size)
  assert(count==2 and lines[2].size>=20,'Two problems wrap to two lines of at least 20 px in portrait')
  assert(fits,'Two lines and their shadow fit between the buttons\' faces')
  assert(outlined(item('email')),'The outline survives a layout')
  -- Typing in a refused field clears its outline, not the other's; opening it does not.
  input({200,'email','','','',0,0,'input','email'})
  assert(account.invalid.email and account.message~='','Opening a refused field keeps its mark and the message')
  input({201,'email','a','','',1,1,'input','email'})
  assert(not account.invalid.email and account.invalid.password,'Typing clears that field\'s mark alone')
  -- The same failure again opens the field again.
  popup.auth.editing='';commands={}
  fail(101,'Enter a valid email address. Passwords need at least 8 characters.','email password',2)
  assert(commands[#commands]=='edit\temail' and account.invalid.email,'A repeated failure marks and opens again')
  -- A failure with no field marks none and leaves focus.
  local focus=popup.focus;commands={}
  fail(102,'Wrong email or password.','',3);rects={};popup:draw()
  assert(#commands==0 and popup.focus==focus and not outlined(item('email')),'No field, no focus move')
  -- A message too long for two lines at 22 px shrinks to fit two.
  fail(103,'Enter a valid email address. Passwords need at least 8 characters. Names cannot have hidden characters.','email password name',4)
  drawn={};popup:draw()
  for _,d in ipairs(drawn) do if d.text:find('hidden characters') then lines={d} end end
  wraps=select(2,T.font(lines[1].size):getWrap(lines[1].text,lines[1].w))
  assert(lines[1].size<22 and lines[1].size>=16 and #wraps<=2,'A three-problem message fits two lines')
  assert(between(lines[1],lines[1].size),'and fits between the buttons\' faces')
  love.graphics.printf,love.graphics.setFont,Button.panel=printf,setFont,panel
  T.font=font
  setmetatable(love.graphics,nil)
end
print('PASS: a failed sign-in outlines and opens its first refused field, the message is 22 px, and register keeps its password rule')
