-- UTF-8 strings are percent-encoded across the browser/Lua mailbox boundary.
local Account={}
Account.__index=Account
function Account.encode(value)
  return (tostring(value):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end))
end
function Account.fields(raw)
  local fields={}
  for part in (raw..'\t'):gmatch('(.-)\t') do
    fields[#fields+1]=(part:gsub('%%(%x%x)',function(h) return string.char(tonumber(h,16)) end))
  end
  return fields
end
function Account.new()
  return setmetatable({status='loading',busy=false,message='',name='',email='',draftName=''},Account)
end
-- DOM selection offsets count UTF-16 units; LÖVE strings contain UTF-8 bytes.
function Account.prefix(text,units)
  local parts={}
  for c in text:gmatch('[%z\1-\127\194-\244][\128-\191]*') do
    local length=#c==4 and 2 or 1
    if units<length then break end
    parts[#parts+1]=c; units=units-length
  end
  return table.concat(parts)
end
function Account:sync(raw)
  if not raw or self.raw==raw then return false end
  local f=Account.fields(raw)
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
  local f=Account.fields(raw)
  if #f<5 or self.status~='authenticated' then return false end
  self.draftName=f[3]; self.editing=f[2]~='done'
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
    return 'save\t'..Account.encode(self.draftName)
  end
  if action=='edit' then self.editing=true; return 'edit\t'..Account.encode(self.draftName) end
  return action
end
return Account
