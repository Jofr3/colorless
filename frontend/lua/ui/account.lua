local Codec=require('ui.codec')
local TextRecord=require('ui.text_record')
local H=require('ui.wire_fields').account.header
local Account={}
Account.__index=Account
function Account.new()
  return setmetatable({status='loading',busy=false,message='',name='',email='',draftName='',invalid={}},Account)
end
function Account:sync(raw)
  if not raw or self.raw==raw then return false end
  local f=Codec.fields(raw)
  if #f<H.email then return false end
  self.raw=raw
  local reset=self.id~=f[H.id] or f[H.message]=='Saved.'
  local resetName=reset or self.draftName==self.name
  local previous=self.message
  self.status,self.busy,self.message=f[H.status],f[H.busy]=='1',f[H.message]
  -- A failed submit marks the fields it refused anew, a repeat of the last one too, and its
  -- message is said again. Other snapshots keep the marks typing has cleared, until the host
  -- clears them all. A host without the fields marks nothing.
  local failures,invalid=tonumber(f[H.failures]) or self.failures or 0,f[H.invalid] or ''
  self.refused=failures~=(self.failures or 0)
  self.failures=failures
  if self.refused or not invalid:find('%S') then
    self.invalid={}
    for field in invalid:gmatch('%S+') do self.invalid[field]=true end
  end
  -- What main.lua says: a new message, or any failed submit's.
  self.fresh=self.message~='' and (self.message~=previous or self.refused)
  self.id,self.name,self.email=f[H.id],f[H.displayName],f[H.email]
  -- Whether deleting the account asks for its password (an OAuth-only account has none).
  self.hasPassword=f[H.hasPassword]=='1'
  -- Whether to ask the account, once, to choose its public name (its name may be its email's
  -- local part or its Google name). A host without the field never asks.
  self.namePrompt=f[H.namePrompt]=='1'
  self.savedRemaining=self.message=='Saved.' and 3 or nil
  if resetName then self.draftName=self.name end
  if self.status~='authenticated' then self.editing=false end
  return true
end
-- Typing in a refused field takes its mark away.
function Account:clearInvalid(field) self.invalid[field]=nil end
function Account:input(raw)
  local r=TextRecord.read(self,raw)
  if not r or self.status~='authenticated' then return false end
  self.draftName=r.value; self.editing=r.action=='input'
  self.selectionStart=r.selectionStart; self.selectionEnd=r.selectionEnd
  self.message=''
  return true
end
-- Whether to show the "choose your public name" prompt now: the server asks for it, and this
-- session has not shown it to this account already (Later asks again on the next visit).
function Account:shouldPrompt()
  return self.status=='authenticated' and self.namePrompt and not self.busy and self.promptedId~=self.id
end
function Account:canSave()
  local trimmed=self.draftName:match('^%s*(.-)%s*$')
  return not self.busy and trimmed~='' and trimmed~=self.name
end
function Account:update(dt)
  if not self.savedRemaining then return end
  self.savedRemaining=self.savedRemaining-dt
  if self.savedRemaining<=0 then
    if self.message=='Saved.' then self.message='' end
    self.savedRemaining=nil
  end
end
function Account:command(action)
  if action=='save' then
    return 'save\t'..Codec.encode(self.draftName)
  end
  if action=='edit' then self.editing=true; return 'edit\t'..Codec.encode(self.draftName) end
  return action
end
return Account
