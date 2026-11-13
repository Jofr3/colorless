-- Balatro's stepped silhouette with the scan's local edge colours extended
-- into the rim. Preserve gradients instead of replacing them with one tint.
local g=love.graphics
local D=require('ui.card_dimensions')
local Frame={}
local DEFAULT={192/255,200/255,214/255}
local borders,order={},{}
-- Scans decoded while a batch of face rebuilds is open, by path. Every face
-- that shows the same file in one batch draws one decode; the batch releases
-- them when it closes, so no decoded image outlives it.
local held,batches={},0
function Frame.open() batches=batches+1 end
function Frame.close()
  batches=batches-1
  if batches>0 then return end
  for path,img in pairs(held) do img:release();held[path]=nil end
end
local function hold(path,source)
  local ok,img=pcall(g.newImage,source)
  if not ok then return nil end
  img:setFilter('linear','linear')
  if batches>0 then held[path]=img end
  return img
end

function Frame.border(path,fallback)
  fallback=fallback or DEFAULT
  if not path then return fallback end
  if borders[path] then return borders[path] end
  if not love.filesystem.getInfo(path) then return fallback end
  local ok,data=pcall(love.image.newImageData,path)
  if not ok then return fallback end
  local w,h=data:getDimensions()
  local found=false
  -- Neighbouring samples overlap, so read each edge pixel once.
  local seen,R,G,B,A={},{},{},{},{}
  local function pixel(x,y)
    local i=y*w+x
    if not seen[i] then seen[i]=true;R[i],G[i],B[i],A[i]=data:getPixel(x,y) end
    return R[i],G[i],B[i],A[i]
  end
  local function sample(horizontal,far,t)
    -- Rounded scan corners may be transparent or contain a white matte.
    -- Continue the nearest straight edge through our stepped corners.
    t=math.max(0.08,math.min(0.92,t))
    local along=math.floor(t*((horizontal and w or h)-1))
    local r,g,b,n=0,0,0,0
    for delta=-1,1 do
      for depth=0,1 do
        local x,y
        if horizontal then x=along+delta;y=far and h-1-depth or depth
        else x=far and w-1-depth or depth;y=along+delta end
        x=math.max(0,math.min(w-1,x));y=math.max(0,math.min(h-1,y))
        local pr,pg,pb,a=pixel(x,y)
        if a>=0.9 then r=r+pr;g=g+pg;b=b+pb;n=n+1 end
      end
    end
    if n==0 then return fallback end
    found=true
    return {r/n,g/n,b/n}
  end
  local border={top={},bottom={},left={},right={}}
  for x=1,D.ART_W do
    border.top[x]=sample(true,false,(x-0.5)/D.ART_W)
    border.bottom[x]=sample(true,true,(x-0.5)/D.ART_W)
  end
  for y=1,D.ART_H do
    border.left[y]=sample(false,false,(y-0.5)/D.ART_H)
    border.right[y]=sample(false,true,(y-0.5)/D.ART_H)
  end
  if batches>0 and not held[path] then hold(path,data) end
  data:release()
  if not found then return fallback end
  borders[path]=border;order[#order+1]=path
  -- Cache only small edge profiles, never decoded images or extra textures.
  if #order>64 then borders[table.remove(order,1)]=nil end
  return border
end

-- Draws the cached scan at path stretched to w×h. False when there is none,
-- so the caller can draw its placeholder face instead.
function Frame.scan(path,w,h)
  if not path or not love.filesystem.getInfo(path) then return false end
  local img=held[path] or hold(path,path)
  if not img then return false end
  g.setColor(1,1,1)
  g.draw(img,0,0,0,w/img:getWidth(),h/img:getHeight())
  if batches==0 then img:release() end
  return true
end

local function strip(colour,x,y,w,h)
  g.setColor(colour[1],colour[2],colour[3],1)
  g.rectangle('fill',x,y,w,h)
end

function Frame.draw(w,h,artwork,border)
  border=border or DEFAULT
  g.push('all')
  g.setShader()
  g.scale(w/D.W,h/D.H)
  g.setBlendMode('alpha','alphamultiply')
  -- Ordinary Enhancers.png corner, with its empty outer row/column removed:
  -- ...RRR  (. = transparent, R = rim, A = artwork)
  -- .RRAAA
  -- .RAAAA
  -- RAAAAA
  -- Keep this corner profile square when adapting the card's aspect ratio.
  local edge,shoulder,corner=0,1,3
  if border.top then
    -- Extend each local colour outwards. The inner portion sits behind the
    -- scan so transparent rounded corners keep the same continuous stock.
    for x=shoulder,D.W-shoulder-1 do
      local inset=(x<corner or x>=D.W-corner) and shoulder or edge
      local i=x-D.INSET+1
      strip(border.top[i],x,inset,1,corner-inset)
      strip(border.bottom[i],x,D.H-corner,1,corner-inset)
    end
    for y=corner,D.H-corner-1 do
      local i=y-D.INSET+1
      strip(border.left[i],edge,y,corner-edge,1)
      strip(border.right[i],D.W-corner,y,corner-edge,1)
    end
  else
    strip(border,corner,edge,D.W-2*corner,D.H-2*edge)
    strip(border,shoulder,shoulder,D.W-2*shoulder,D.H-2*shoulder)
    strip(border,edge,corner,D.W-2*edge,D.H-2*corner)
  end
  g.setColor(1,1,1,1)
  g.push()
  g.translate(D.INSET,D.INSET)
  artwork(D.ART_W,D.ART_H)
  g.pop()
  -- Apply the source alpha silhouette to the scan as well as the frame.
  g.setBlendMode('replace','premultiplied')
  g.setColor(0,0,0,0)
  for _,cut in ipairs({{0,corner,shoulder},{shoulder,shoulder,corner-shoulder}}) do
    local y,cw,ch=cut[1],cut[2],cut[3]
    g.rectangle('fill',0,y,cw,ch)
    g.rectangle('fill',D.W-cw,y,cw,ch)
    g.rectangle('fill',0,D.H-y-ch,cw,ch)
    g.rectangle('fill',D.W-cw,D.H-y-ch,cw,ch)
  end
  -- Copy the source's inner contour too: the first shoulder row has two
  -- rim pixels, followed by one. A constant-width outline misses this joint.
  g.setBlendMode('alpha','alphamultiply')
  for y=shoulder,corner-1 do
    local x=shoulder
    local width=y==shoulder and 2 or 1
    local i=x-D.INSET+1
    local j=D.ART_W-i+1
    strip(border.top and border.top[i] or border,x,y,width,1)
    strip(border.top and border.top[j] or border,D.W-x-width,y,width,1)
    strip(border.bottom and border.bottom[i] or border,x,D.H-y-1,width,1)
    strip(border.bottom and border.bottom[j] or border,D.W-x-width,D.H-y-1,width,1)
  end
  g.pop()
end

return Frame
