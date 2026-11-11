local TextRecord=require('ui.text_record')
local Auth={}
Auth.__index=Auth
function Auth.new(mode)
  return setmetatable({mode=mode or 'login',email='',password='',name='',editing='',selectionStart=0,selectionEnd=0},Auth)
end
function Auth:input(raw)
  local r=TextRecord.read(self,raw,'auth')
  if not r then return false end
  local before={email=self.email,password=self.password,name=self.name}
  self.editing=r.editing
  self.email,self.password,self.name=r.email,r.password,r.name
  self.selectionStart,self.selectionEnd=r.selectionStart,r.selectionEnd
  self.action,self.field=r.action,r.field
  -- Whether the field changed: opening a field publishes it unchanged.
  self.changed=before[self.field]~=nil and before[self.field]~=self[self.field]
  return true
end
return Auth
