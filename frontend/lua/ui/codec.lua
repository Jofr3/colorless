-- The browser/Lua mailbox wire format: rows split by '\n', fields by '\t',
-- each field percent-encoded UTF-8.
local Codec={}
local UTF8_CHAR='[%z\1-\127\194-\244][\128-\191]*'
Codec.UTF8_CHAR=UTF8_CHAR
function Codec.encode(value)
  return (tostring(value):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end))
end
function Codec.fields(raw)
  local fields={}
  for part in (raw..'\t'):gmatch('(.-)\t') do
    fields[#fields+1]=(part:gsub('%%(%x%x)',function(h) return string.char(tonumber(h,16)) end))
  end
  return fields
end
function Codec.rows(raw)
  local rows={}
  for line in raw:gmatch('[^\n]+') do rows[#rows+1]=Codec.fields(line) end
  return rows
end
function Codec.join(...)
  local fields={...}
  for i,v in ipairs(fields) do fields[i]=Codec.encode(v) end
  return table.concat(fields,'\t')
end
function Codec.command(send,...)
  send(Codec.join(...))
end
-- Comma-separated list, trimmed, empty entries dropped.
function Codec.list(csv)
  local list={}
  for part in tostring(csv or ''):gmatch('[^,]+') do
    part=part:match('^%s*(.-)%s*$')
    if part~='' then list[#list+1]=part end
  end
  return list
end
-- DOM selection offsets count UTF-16 units; LÖVE strings contain UTF-8 bytes.
function Codec.utf16Prefix(text,units)
  local parts={}
  for c in text:gmatch(UTF8_CHAR) do
    local length=#c==4 and 2 or 1
    if units<length then break end
    parts[#parts+1]=c; units=units-length
  end
  return table.concat(parts)
end
return Codec
