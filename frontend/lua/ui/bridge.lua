-- Lua's only way to the page. love.js hands the host one stdout line per '\n', and the host runs
-- every line that starts with COLORLESS: as a command, so each message is one line:
-- 'COLORLESS:<channel>' or 'COLORLESS:<channel>:<payload>', the payload being the mailbox wire's
-- fields (Codec.join: percent-encoded, TAB-joined). No data byte can end the line and start
-- another command. scripts/lua-bridge-guard.ts keeps every other print out of the frontend.
local Codec=require('ui.codec')
local Bridge={}
local function line(channel,payload)
  assert(type(channel)=='string' and channel:match('^[a-z][a-z%-]*$'),'Bridge channels are lowercase words')
  print('COLORLESS:'..channel..(payload and ':'..payload or ''))
end
-- Sends `...` as fields, each one encoded.
function Bridge.emit(channel,...)
  if select('#',...)==0 then line(channel) else line(channel,Codec.join(...)) end
end
-- Sends a payload already joined as fields, as the screens' command callbacks get it. Any byte
-- outside the encoded alphabet is encoded here too, so a payload joined by hand stays one line.
function Bridge.send(channel,payload)
  line(channel,(tostring(payload):gsub('[^%w%-_%.~%%\t]',function(c) return string.format('%%%02X',c:byte()) end)))
end
return Bridge
