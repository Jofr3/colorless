-- A text proxy's record (src/host/textProxy.ts) by field name: `text` for one field, `auth` for
-- the sign-in form (ui/wire_fields.lua's input rows). `read` keeps the last raw record on
-- `owner.inputRaw` and answers nil for no record, a repeat, or one missing a field.
local Codec=require('ui.codec')
local W=require('ui.wire_fields').input
local TextRecord={}
function TextRecord.read(owner,raw,kind)
  if not raw or raw==owner.inputRaw then return nil end
  owner.inputRaw=raw
  local f=Codec.fields(raw);local record={}
  for name,column in pairs(W[kind or 'text']) do
    if f[column]==nil then return nil end
    record[name]=f[column]
  end
  record.selectionStart=tonumber(record.selectionStart) or 0
  record.selectionEnd=tonumber(record.selectionEnd) or 0
  return record
end
return TextRecord
