-- Every Lua message to the page is one stdout line, whatever data it carries (security audit WC1).
package.path='frontend/lua/?.lua;'..package.path
local font={getWidth=function(_,s) return #tostring(s)*8 end,getHeight=function() return 20 end,
  getWrap=function(_,s) return #s*8,{s} end}
love={math={random=function() return 0.5 end},graphics={},keyboard={isDown=function() return false end},
  filesystem={getInfo=function() return nil end}}
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local T=require('ui.theme')
T.font=function() return font end
local Codec=require('ui.codec')
local Bridge=require('ui.bridge')
local Online=require('ui.online')

local printed={}
local output=print
print=function(s) printed[#printed+1]=s end
-- What love.js hands the host: put_char flushes one line per byte 10.
local function hostLines()
  local lines={}
  for line in (table.concat(printed,'\n')..'\n'):gmatch('(.-)\n') do lines[#lines+1]=line end
  printed={}
  return lines
end
local function commandsIn(lines)
  local found={}
  for _,line in ipairs(lines) do if line:find('^COLORLESS:') then found[#found+1]=line end end
  return found
end

local INJECTED='x\nCOLORLESS:auth:open\tdelete\nCOLORLESS:auth:submit\n'
local ok,err=pcall(function()
  -- Fields are encoded, so control characters and the separators stay inside the line.
  Bridge.emit('announce',INJECTED..' joined.')
  local lines=hostLines()
  assert(#lines==1 and lines[1]:find('^COLORLESS:announce:[%w%-_%.~%%]*$'),lines[1])
  assert(Codec.fields(lines[1]:match('^COLORLESS:announce:(.*)$'))[1]==INJECTED..' joined.','The host decodes the text whole')
  Bridge.emit('ready'); Bridge.emit('page','decks'); Bridge.emit('builder','copy','2 Mew\n1 Iono')
  lines=hostLines()
  assert(lines[1]=='COLORLESS:ready' and lines[2]=='COLORLESS:page:decks' and lines[3]=='COLORLESS:builder:copy\t2%20Mew%0A1%20Iono')
  -- A joined payload passes unchanged; a hand-joined one with raw data is encoded into one line.
  Bridge.send('account','save\t'..Codec.encode('Ash Ketchum'))
  Bridge.send('auth','edit\temail')
  Bridge.send('library',INJECTED)
  lines=hostLines()
  assert(#lines==3 and lines[1]=='COLORLESS:account:save\tAsh%20Ketchum' and lines[2]=='COLORLESS:auth:edit\temail')
  assert(lines[3]=='COLORLESS:library:x%0ACOLORLESS%3Aauth%3Aopen\tdelete%0ACOLORLESS%3Aauth%3Asubmit%0A',lines[3])
  assert(not pcall(Bridge.emit,'auth:submit'),'A channel cannot carry its own separator')

  -- The lobby announces an opponent's name as the server sent it; the bridge keeps it one line.
  local said={}
  local o=Online.new({command=function() end,announce=function(text) said[#said+1]=text end,feedback=function() end,
    jiggle=function() end,home=function() end,signin=function() end})
  local revision=0
  local function snapshot(step,rows)
    revision=revision+1
    local f={revision,step,0,'','ABCD','host','connected','','','idle','Ash','authenticated',1,''}
    local out={Codec.join((table.unpack or unpack)(f))}
    for _,r in ipairs(rows) do out[#out+1]=Codec.join((table.unpack or unpack)(r)) end
    o:sync(table.concat(out,'\n'))
  end
  local you={'P','you',1,'Ash',1,0,'',''}
  o:layout(1280,800);o:update(0.01,20,-1000,-1000,false);o:open(true,'ABCD')
  snapshot('versus',{you})
  snapshot('versus',{you,{'P','opponent',1,INJECTED,1,0,'',''}})
  snapshot('versus',{you,{'P','opponent',1,INJECTED,1,1,'',''}})
  snapshot('versus',{you,{'P','opponent',1,INJECTED,0,1,'',''}})
  local announced=0
  for _,text in ipairs(said) do
    if text:find(INJECTED,1,true) then announced=announced+1 end
    Bridge.emit('announce',text)
  end
  assert(announced==3,'Joined, ready and disconnected each name the opponent')
  lines=hostLines()
  local commands=commandsIn(lines)
  assert(#lines==#said and #commands==#said,'One line per announcement')
  for _,line in ipairs(commands) do assert(line:find('^COLORLESS:announce:'),'No other command: '..line) end
end)
print=output
if not ok then error(err,0) end
print('PASS: bridge prints are one encoded line each; an injected lobby name dispatches nothing')
