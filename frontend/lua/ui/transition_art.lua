-- The browser stages one image from its persistent disk pool. The current
-- session's working cache and bundled art remain fallbacks while it loads.
local Codec=require('ui.codec')
local Mailbox=require('ui.mailbox')
local Art={}
local bundled={'sv01-030','sv01-033','sv01-036','sv01-038','sv01-042','sv01-046','sv01-047','sv01-052'}
local shown,last={},nil

local function fallbackPool()
  local pool={}
  for _,id in ipairs(bundled) do pool[#pool+1]={id=id,path='assets/transition_cards/'..id..'.png'} end
  return pool
end

local function draw(pool)
  local present,available={},{}
  for _,card in ipairs(pool) do
    present[card.id]=true
    if not shown[card.id] then available[#available+1]=card end
  end
  -- Bound the history to the live pool, including when the cache is cleared.
  for id in pairs(shown) do if not present[id] then shown[id]=nil end end
  if #available==0 then
    shown={}
    for _,card in ipairs(pool) do
      if #pool==1 or card.id~=last then available[#available+1]=card end
    end
  end
  local card=available[love.math.random(#available)]
  shown[card.id]=true;last=card.id
  return card
end

function Art.fallback() return draw(fallbackPool()) end

function Art.pick()
  local transition=Mailbox.read('transitionArt')
  if transition then
    local fields=Codec.fields(transition)
    local token,id,path=tonumber(fields[1]),fields[2],fields[3]
    if token and id and path and love.filesystem.getInfo(path) then
      return {id=id,path=path,token=token}
    end
  end
  local pool,ids={},{}
  for _,row in ipairs(Mailbox.artRows(Mailbox.read('art'))) do
    -- Ignore stale or duplicate entries rather than selecting artwork
    -- already evicted from WASM.
    if row.id~='' and not ids[row.id] and love.filesystem.getInfo(row.path) then
      ids[row.id]=true;pool[#pool+1]=row
    end
  end
  if #pool==0 then return Art.fallback() end
  return draw(pool)
end

return Art
