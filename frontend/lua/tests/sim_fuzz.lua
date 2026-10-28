-- Seeded fuzz of the table's snapshot parser: each case mutates a valid late-game, prompt or
-- setup snapshot (a row dropped or repeated, a field dropped, garbled or added) and runs sync and
-- three frames of update and draw, none of which may raise. A snapshot cut short is left out:
-- the host replaces a mailbox file whole, so Lua never reads half a row.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local Snapshots=require('support.snapshots')
local Simulator=require('ui.simulator')
local shader=Stub.shader()
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader}
local CASES=200
math.randomseed(20261028)
local rnd=math.random
local function split(s,sep) local out={};for part in (s..sep):gmatch('(.-)'..sep) do out[#out+1]=part end;return out end
local bases={}
for rev=1,3 do
  bases[#bases+1]=(Snapshots.snapshot({revision=rev}))
  bases[#bases+1]=(Snapshots.prompt(rev))
  bases[#bases+1]=(Snapshots.setup(rev,'m'..rev))
end
local KINDS={'row missing','row repeated','field missing','field garbled','field added'}
local GARBLE={'','x','-1','1e309','nan','%ZZ','true'}
local function mutate(raw,rev)
  local rows=split(raw,'\n')
  local kind=rnd(#KINDS)
  if kind==1 then table.remove(rows,rnd(2,#rows))
  elseif kind==2 then rows[#rows+1]=rows[rnd(2,#rows)]
  else
    local i=rnd(#rows);local f=split(rows[i],'\t')
    if kind==3 then table.remove(f,rnd(#f))
    elseif kind==4 then f[rnd(#f)]=GARBLE[rnd(#GARBLE)]
    else f[#f+1]='extra' end
    rows[i]=table.concat(f,'\t')
  end
  local header=split(rows[1],'\t');header[1]=tostring(rev);rows[1]=table.concat(header,'\t')
  return table.concat(rows,'\n'),KINDS[kind]
end
local t=10
local function frames(sim,n)
  for _=1,n do t=t+1/60;sim:update(1/60,t,640,400,false);sim:draw(shaders) end
end
for i=1,CASES do
  local sim=Simulator.new({command=function() end,announce=function() end,feedback=function() end,settings=function() end,jiggle=function() end})
  sim:layout(1280,800);sim:open(false)
  local base=bases[rnd(#bases)]
  sim:sync(base);frames(sim,2)
  local raw,kind=mutate(bases[rnd(#bases)],100+i)
  local ok,err=pcall(function() sim:sync(raw);frames(sim,3) end)
  if not ok then error(('case %d (%s) raised: %s'):format(i,kind,tostring(err)),0) end
end
print(('PASS: %d mutated table snapshots parse and draw'):format(CASES))
