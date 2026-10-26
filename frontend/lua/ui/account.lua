local Codec=require('ui.codec')
local Account={}
Account.__index=Account
function Account.new()
  return setmetatable({status='loading',busy=false,message='',name='',email='',draftName=''},Account)
end
function Account:sync(raw)
  if not raw or self.raw==raw then return false end
  local f=Codec.fields(raw)
  if #f<7 then return false end
  self.raw=raw
  local reset=self.id~=f[5] or f[4]=='Saved.'
  local resetName=reset or self.draftName==self.name
  self.status,self.busy,self.message=f[2],f[3]=='1',f[4]
  self.id,self.name,self.email=f[5],f[6],f[7]
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
