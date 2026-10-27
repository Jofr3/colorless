package.path='frontend/lua/?.lua;'..package.path
love={graphics={},keyboard={isDown=function() return false end}}
local Settings=require('ui.settings')
local Preferences=require('ui.preferences')
local Account=require('ui.account')
local Codec=require('ui.codec')
local function snapshot(fields)
  local result={}; for _,v in ipairs(fields) do result[#result+1]=Codec.encode(v) end
  return table.concat(result,'\t')
end

-- The account mailbox's ninth field asks for a public name; an older host has none.
local account=Account.new()
assert(account:sync(snapshot({1,'authenticated',0,'','user-1','ash','ash@example.com',1})))
assert(not account.namePrompt and not account:shouldPrompt())
assert(account:sync(snapshot({2,'authenticated',0,'','user-1','ash','ash@example.com',1,1})))
assert(account.namePrompt and account:shouldPrompt())
assert(account:sync(snapshot({3,'authenticated',1,'','user-1','ash','ash@example.com',1,1})))
assert(not account:shouldPrompt(),'Not while a request is pending')
print('PASS: name prompt flag in the account mailbox')

local commands,closed,announced={},0,{}
local function settings()
  local popup=Settings.new(Preferences.new(),{
    account=function(cmd) commands[#commands+1]=cmd end,auth=function() end,feedback=function() end,
    announce=function(text) announced[#announced+1]=text end,close=function() closed=closed+1 end,
  },true,true,account)
  popup:layout(1280,800)
  return popup
end
local function item(popup,kind,action)
  for i,it in ipairs(popup.items) do
    if it.kind==kind and (action==nil or it.action==action) then return i,it end
  end
end

-- Signing in to an asked account in Settings opens the prompt, prefilled with the current name.
account:sync(snapshot({4,'anonymous',0,'','','','',0}))
local popup=settings(); popup.tab=Settings.tabs.account; popup:build()
popup:openAuth('login')
account:sync(snapshot({5,'authenticated',0,'','user-1','ash','ash@example.com',1,1}))
popup:accountChanged()
assert(not popup.auth and popup.prompt and not popup.prompt.standalone)
assert(account.draftName=='ash' and announced[#announced]:find('Current name: ash',1,true))
local nameIndex=item(popup,'name','edit')
assert(nameIndex==1 and popup.items[1].label=='Public name')
local saveIndex,save=item(popup,'action','save')
local keepIndex=item(popup,'action','keep')
assert(popup:disabled(save),'Save waits for a different name')
popup:activate(keepIndex); assert(commands[#commands]=='keep')
account.draftName='Ash K.'; popup:build(); assert(not popup:disabled(popup.items[saveIndex]))
popup:activate(saveIndex); assert(commands[#commands]=='save\tAsh%20K.')
-- The server's answer clears the flag: the prompt gives way to the account tab.
account:sync(snapshot({6,'authenticated',0,'Saved.','user-1','Ash K.','ash@example.com',1,0}))
popup:accountChanged()
assert(not popup.prompt and popup.tab==Settings.tabs.account and closed==0)
assert(announced[#announced]=='Name saved. Account settings.')
-- Answered, it never comes back, even on the next sync.
popup:accountChanged(); assert(not popup.prompt)
print('PASS: name prompt after sign-in, prefill, Keep, Save and the answered return')

-- Opened on its own (home or the lobby), Later closes Settings and is not asked again this session.
account=Account.new()
account:sync(snapshot({1,'authenticated',0,'','user-2','misty','misty@example.com',0,1}))
popup=settings(); popup:openNamePrompt(true)
assert(popup.prompt and popup.prompt.standalone and account.promptedId=='user-2')
assert(not account:shouldPrompt(),'Once a session')
popup:layout(480,850)
for _,it in ipairs(popup.items) do
  assert(it.x>=popup.x and it.x+it.w<=popup.x+popup.w)
  assert(it.y>=popup.y and it.y+it.h<=popup.y+popup.h)
end
local laterIndex=item(popup,'prompt-later')
assert(popup:describe(popup.items[laterIndex])=='Later. Asks again next time.')
popup:activate(laterIndex); assert(closed==1 and not popup.prompt)
-- Escape is Later too; from the account tab's prompt it returns to that tab.
account.promptedId=nil
popup=settings(); popup.tab=Settings.tabs.account; popup:build(); popup:accountChanged()
assert(popup.prompt and not popup.prompt.standalone)
popup:keypressed('escape'); assert(not popup.prompt and popup.tab==Settings.tabs.account and closed==1)
-- Signing out ends the prompt without closing Settings.
account.promptedId=nil; popup:openNamePrompt(false)
account:sync(snapshot({2,'anonymous',0,'','','','',0,0})); popup:accountChanged()
assert(not popup.prompt and closed==1)
-- A Game-tab refresh does not interrupt.
account=Account.new()
account:sync(snapshot({1,'authenticated',0,'','user-3','brock','brock@example.com',1,1}))
popup=settings(); popup:accountChanged(); assert(not popup.prompt and popup.tab==1)
print('PASS: standalone name prompt, Later, Escape, sign-out, once per session and portrait bounds')
