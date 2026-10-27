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
