local Codec=require('ui.codec')
local Auth={}
Auth.__index=Auth
function Auth.new(mode)
  return setmetatable({mode=mode or 'login',email='',password='',name='',editing='',selectionStart=0,selectionEnd=0},Auth)
end
function Auth:input(raw)
  if not raw or raw==self.raw then return false end
  self.raw=raw
  local f=Codec.fields(raw)
  if #f<9 then return false end
  local before={email=self.email,password=self.password,name=self.name}
  self.editing=f[2]
  self.email,self.password,self.name=f[3],f[4],f[5]
  self.selectionStart,self.selectionEnd=tonumber(f[6]) or 0,tonumber(f[7]) or 0
  self.action,self.field=f[8],f[9]
  -- Whether the field changed: opening a field publishes it unchanged.
  self.changed=before[self.field]~=nil and before[self.field]~=self[self.field]
  return true
end
return Auth
