-- Files the browser host writes into LÖVE's save directory for Lua to poll.
local Codec=require('ui.codec')
local files=require('ui.host_constants').mailboxes
local Mailbox={}
-- The text of the mailbox `name` (a key of host_constants.mailboxes), or nil until the page has
-- written it.
function Mailbox.read(name)
  local file=files[name] or error('unknown mailbox '..tostring(name))
  if love.filesystem.getInfo(file) then return (love.filesystem.read(file)) end
end
-- The art mailbox's {id,path} rows in order; its first row is a revision.
function Mailbox.artRows(raw)
  local list={}
  for _,f in ipairs(Codec.rows(raw or '')) do
    if #f==2 then list[#list+1]={id=f[1],path=f[2]} end
  end
  return list
end
-- Card id -> virtual image path; later rows win.
function Mailbox.artMap(raw)
  local art={}
  for _,row in ipairs(Mailbox.artRows(raw)) do art[row.id]=row.path end
  return art
end
return Mailbox
