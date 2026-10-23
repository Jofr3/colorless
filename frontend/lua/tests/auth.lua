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
