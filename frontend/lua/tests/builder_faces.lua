-- The builder's face cache and preloading: the pages either side draw their faces one per frame
-- as their scans arrive, a page turned to (or back to) adopts them without drawing any, the
-- cache stays within its limit and never releases a face a card holds.
package.path='frontend/lua/?.lua;'..package.path
local files={}
love={math={random=function()return 0.5 end},
 filesystem={getInfo=function(name)return files[name] and {} or nil end,read=function(name)return files[name] end},
 graphics={newFont=function(_,size)return {getWidth=function(_,value)return #value*size*0.5 end,setFilter=function()end}end},
 keyboard={isDown=function()return false end}}
local Card=require('ui.card')
local built=0
Card.rebuild=function(self)built=built+1;self.texture={release=function(t)t.released=true end}end
local FaceCache=require('ui.face_cache')
local Builder=require('ui.builder')
local function check(ok,message) if not ok then error(message,2) end end

-- The cache on its own.
do
  local made=0
  local function face() made=made+1;return {texture={release=function(t)t.released=true end}} end
  local cache=FaceCache.new(2)
  local a=cache:acquire('a',face)
  check(cache:acquire('a',face)==a and made==1 and a.users==2,'A key is drawn once and shared')
  local b=cache:acquire('b',face);local c=cache:acquire('c',face)
  check(cache.count==3 and not a.texture.released,'Faces in use outlive the limit')
  cache:release(b)
  check(cache.count==2 and b.texture.released and not cache:has('b'),'A freed face past the limit is released')
  cache:release(c);cache:release(a);cache:release(a)
  check(cache.count==2 and not a.texture.released and not c.texture.released,'Free faces within the limit stay')
  cache:touch('a');cache:acquire('d',face)
  check(c.texture.released and cache:has('a'),'The least recently used free face goes first')
  cache:trim(0)
  check(cache.count==1 and a.texture.released and cache:has('d'),'Trimming to nothing keeps only held faces')
end
print('PASS: the face cache shares, keeps and releases faces by use')

local b=Builder.new({command=function()end,feedback=function()end,announce=function()end})
local function ids(page)
  local list={}
  for i=1,8 do list[i]='p'..page..'-'..i end
  return list
end
local function row(tag,id) return tag..'\t'..id..'\t'..id..'\tPokémon\tBasic\t0\t4\t60\tH\t1\t4\t0\t' end
local revision=0
-- The builder's snapshot on `page`, with the pages either side as nearby rows.
local function show(page)
  revision=revision+1
  local lines={table.concat({revision,'ready','Deck','standard','','','0',page,'40','320','0','','','','','0','0','0'},'\t')}
  for _,id in ipairs(ids(page)) do lines[#lines+1]=row('C',id) end
  for _,near in ipairs({page+1,page-1,page+2,page-2}) do
    if near>=1 then for _,id in ipairs(ids(near)) do lines[#lines+1]=row('N',id) end end
  end
  b:sync(table.concat(lines,'\n'))
end
local staged={}
local artRevision=0
local function stage(list,suffix)
  for _,id in ipairs(list) do staged[id]=id..(suffix or '')..'.png' end
  artRevision=artRevision+1
  local lines={tostring(artRevision)}
  for id,path in pairs(staged) do lines[#lines+1]=id..'\t'..path end
  files['__art.txt']=table.concat(lines,'\n')
end
local time=0
local function frame() time=time+1/60;b:update(1/60,time,0,0,true) end

b:layout(1280,800);show(1)
check(#b.cards==8 and #b.nearby==16,'Page 1 shows 8 cards and knows 16 nearby')
local before=built
for _=1,5 do frame() end
check(built==before,'Nearby cards without a scan are not drawn ahead')

-- Scans arrive for this page and the next two: this page repaints at once, the others one a frame.
stage(ids(1));stage(ids(2));stage(ids(3))
before=built;frame()
check(built==before+8+1,'This page repaints in the frame its scans land, plus one nearby face')
for _=1,15 do
  local was=built;frame()
  check(built<=was+1,'Never more than one nearby face a frame')
end
check(built==before+8+16,'Both nearby pages are drawn ahead')
for _=1,5 do frame() end
check(built==before+8+16,'Once drawn, a nearby face is not drawn again')

-- Turning a page adopts its faces; turning back adopts the first page's.
before=built;show(2)
check(built==before,'Turning to a drawn-ahead page draws nothing')
for i,c in ipairs(b.cards) do
  check(c.item.id=='p2-'..i and c.face.key:find('p2%-'..i..'%.png'),'Page 2 shows its own scans')
  check(c.texture==c.face.texture and not c.texture.released,'Each card holds its cached face')
end
show(1)
check(built==before,'Turning back draws nothing')

-- A long walk keeps the cache within its limit and never frees a face on screen.
for page=1,12 do stage(ids(page+2)) show(page) for _=1,40 do frame() end end
check(b.faces.count<=56,'The cache keeps at most 56 faces, has '..b.faces.count)
for _,c in ipairs(b.cards) do check(not c.texture.released,'A shown face is never released') end
before=built;show(11)
check(built==before,'The previous page is still drawn ahead after a long walk')

-- A replaced scan repaints its card and hands the old face back.
local card=b.cards[1];local old=card.face
stage({card.item.id},'-new');frame()
check(card.face~=old and old.users==0 and card.face.key:find('%-new%.png'),'A new scan repaints the card')

-- Leaving the page keeps only the faces cards hold.
b:releaseFaces()
check(b.faces.count==#b.cards,'Leaving frees every face no card holds, '..b.faces.count..' left')
print('PASS: nearby pages draw ahead one face a frame, page turns adopt them, the cache stays bounded')
