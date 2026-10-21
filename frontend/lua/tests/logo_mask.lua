package.path='frontend/lua/?.lua;'..package.path
local Mask=require('ui.logo_mask')
local w,h=40,32
local mask={}
local function at(x,y)return y*w+x+1 end
local function rect(x1,y1,x2,y2,value)
  for y=y1,y2 do for x=x1,x2 do mask[at(x,y)]=value end end
end
-- An O with a genuine counter, an extraction pinhole in its top stroke,
-- and a tiny detached highlight that must not acquire its own bevel.
rect(5,5,20,26,true);rect(10,10,15,21,nil)
mask[at(8,8)]=nil
mask[at(30,6)]=true;mask[at(31,6)]=true
-- A second letter one pixel away: closing must not bridge its ivory face.
rect(22,5,26,26,true)
local clean=Mask.clean(mask,w,h)
assert(clean[at(8,8)],'Repair the small extraction hole inside the stroke')
assert(not clean[at(30,6)] and not clean[at(31,6)],'Discard tiny detached fragments')
for y=10,21 do for x=10,15 do
  assert(not clean[at(x,y)],'Keep the real letter counter transparent')
end end
for y=5,26 do assert(not clean[at(21,y)],'Never join separate ivory faces') end
assert(clean[at(7,16)] and clean[at(18,16)] and clean[at(24,16)],'Retain each letter stroke')
print('PASS: repair face pinholes, remove fragments, preserve counters and separate letters')
