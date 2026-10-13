local Account=require('ui.account')
local Auth={}
Auth.__index=Auth
function Auth.new(mode)
  return setmetatable({mode=mode or 'login',email='',password='',name='',editing='',selectionStart=0,selectionEnd=0},Auth)
end
function Auth:input(raw)
  if not raw or raw==self.raw then return false end
  self.raw=raw
  local f=Account.fields(raw)
  if #f<9 then return false end
  self.editing=f[2]
  self.email,self.password,self.name=f[3],f[4],f[5]
  self.selectionStart,self.selectionEnd=tonumber(f[6]) or 0,tonumber(f[7]) or 0
  self.action,self.field=f[8],f[9]
  return true
end
return Auth
