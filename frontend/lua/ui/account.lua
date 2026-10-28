local Codec=require('ui.codec')
local H=require('ui.wire_fields').account.header
local Account={}
Account.__index=Account
function Account.new()
  return setmetatable({status='loading',busy=false,message='',name='',email='',draftName=''},Account)
end
function Account:sync(raw)
  if not raw or self.raw==raw then return false end
  local f=Codec.fields(raw)
  if #f<H.email then return false end
  self.raw=raw
  local reset=self.id~=f[H.id] or f[H.message]=='Saved.'
  local resetName=reset or self.draftName==self.name
  self.status,self.busy,self.message=f[H.status],f[H.busy]=='1',f[H.message]
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
function Account:input(raw)
  if not raw or raw==self.inputRaw then return false end
  self.inputRaw=raw
  local f=Codec.fields(raw)
  if #f<6 or self.status~='authenticated' then return false end
  self.draftName=f[3]; self.editing=f[6]=='input'
  self.selectionStart=tonumber(f[4]) or 0; self.selectionEnd=tonumber(f[5]) or 0
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
