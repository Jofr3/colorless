-- Files the browser host writes into LÖVE's save directory for Lua to poll.
local Codec=require('ui.codec')
local files=require('ui.host_constants').mailboxes
local Mailbox={}
-- File -> revision from the host's revision list; nil until the host writes one, and then every
-- read goes to its file.
local revisions,revisionsRaw
local cached={}
-- Reads the host's revision list; call once per frame before the mailboxes. A mailbox whose
-- revision has not moved since its last read is answered from memory. True when the page wrote
-- any mailbox since the last poll.
function Mailbox.poll()
  local file=files.revisions
  local raw=love.filesystem.getInfo(file) and (love.filesystem.read(file)) or nil
  if raw==revisionsRaw then return false end
  revisionsRaw=raw
  revisions=raw and {} or nil
  for name,revision in (raw or ''):gmatch('([^\t\n]+)\t([^\n]+)') do revisions[name]=revision end
  return true
end
local function readFile(file)
  if love.filesystem.getInfo(file) then return (love.filesystem.read(file)) end
end
-- The text of the mailbox `name` (a key of host_constants.mailboxes), or nil until the page has
-- written it.
function Mailbox.read(name)
  local file=files[name] or error('unknown mailbox '..tostring(name))
  if not revisions then return readFile(file) end
  local revision=revisions[file]
  if not revision then return nil end
  local hit=cached[file]
  if hit and hit.revision==revision then return hit.text end
  local text=readFile(file)
  cached[file]={revision=revision,text=text}
  return text
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
