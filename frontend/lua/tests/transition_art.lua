package.path='frontend/lua/?.lua;'..package.path
local files={}
love={math={random=math.random},filesystem={getInfo=function(path)return files[path]~=nil end,read=function(path)return files[path]end}}
local Art=require('ui.transition_art')
local Codec=require('ui.codec')
local function publish(ids)
  local rows={'1'}
  for _,id in ipairs(ids)do
    local path='cached '..id..'.png';files[path]='png'
    rows[#rows+1]=Codec.encode(id)..'\t'..Codec.encode(path)
  end
  files['__art.txt']=table.concat(rows,'\n')
end
-- The host downloads the eight scans after ready: until the first arrives there is no artwork
-- at all, and the wipe shows the card back.
assert(Art.pick()==nil and Art.fallback()==nil,'No artwork before the scans arrive')
-- The fallback lists only the scans written so far.
local scans={'sv01-030','sv01-033','sv01-036','sv01-038','sv01-042','sv01-046','sv01-047','sv01-052'}
local function scan(id) return 'assets/transition_cards/'..id..'.png' end
files[scan('sv01-042')]='png'
for _=1,3 do assert(Art.pick().path==scan('sv01-042'),'Only the scan that arrived is drawn')end
for _,id in ipairs(scans) do files[scan(id)]='png' end
-- The empty-cache fallback also exhausts its pool before repeating.
local fallback={}
for _=1,8 do local c=Art.pick();assert(not fallback[c.id]);fallback[c.id]=true;assert(c.path:match('^assets/transition_cards/'))end
-- Exercise multiple complete bags of the full shared cache, not just eight.
local ids={};for i=1,64 do ids[i]='card-'..i end
publish(ids)
local previous
for _=1,4 do
  local seen={}
  for _=1,64 do
    local c=Art.pick()
    assert(c.path=='cached '..c.id..'.png' and files[c.path])
    assert(not seen[c.id],'A cached card repeated before the bag was exhausted')
    assert(c.id~=previous,'Bag boundaries must not immediately repeat')
    seen[c.id]=true;previous=c.id
  end
end
-- Duplicate/stale entries cannot bias selection or produce missing artwork.
publish({'one','two','two','missing'})
files['cached missing.png']=nil
local a,b=Art.pick(),Art.pick()
assert(a.id~=b.id and (a.id=='one' or a.id=='two') and (b.id=='one' or b.id=='two'))
-- Newly loaded cards join immediately and an evicted entry stops participating.
publish({'one','two','new'})
assert(Art.pick().id=='new')
publish({'single'})
for _=1,3 do assert(Art.pick().id=='single')end
files['cached single.png']=nil
assert(Art.pick().path:match('^assets/transition_cards/'))
files['__art.txt']=nil
assert(Art.pick().path:match('^assets/transition_cards/'))
-- A single prepared disk-cache card outranks the 64-image working cache.
publish({'working'})
files['prepared.png']='png'
files['__transition_art.txt']='42\tpersistent-card\tprepared.png'
local ready=Art.pick()
assert(ready.id=='persistent-card' and ready.path=='prepared.png' and ready.token==42)
files['prepared.png']=nil
assert(Art.pick().id=='working','Missing prepared art must fall back to the working cache')
files['__transition_art.txt']=''
assert(Art.pick().id=='working','An acknowledged/empty mailbox must not select stale artwork')
print('PASS: cached artwork selection, 64-card shuffle cycles, new arrivals, eviction, duplicates, and the fallback of the scans that arrived')
