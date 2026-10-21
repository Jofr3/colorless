-- Clean the extracted face on its final pixel grid. Work per connected letter
-- so repairing pinholes cannot join adjacent ivory faces or fill O/R counters.
local Mask={}
-- Remove hairline spurs attached to otherwise solid faces. Opening on a
-- three-pixel square keeps stroke width and cannot fill counters or join faces.
function Mask.trimSpurs(mask,w,h)
  local interior,clean={},{}
  for y=1,h-2 do for x=1,w-2 do
    local solid=true
    for dy=-1,1 do for dx=-1,1 do
      if not mask[(y+dy)*w+x+dx+1] then solid=false end
    end end
    if solid then interior[y*w+x+1]=true end
  end end
  for y=1,h-2 do for x=1,w-2 do
    local p=y*w+x+1
    if mask[p] then
      for dy=-1,1 do for dx=-1,1 do
        if interior[(y+dy)*w+x+dx+1] then clean[p]=true end
      end end
    end
  end end
  return clean
end
function Mask.clean(mask,w,h,minArea)
  local labels,nextLabel={},0
  for start=1,w*h do
    if mask[start] and not labels[start] then
      nextLabel=nextLabel+1
      local queue,head={start},1
      labels[start]=nextLabel
      while head<=#queue do
        local p=queue[head];head=head+1
        local x=(p-1)%w
        local neighbours={x>0 and p-1 or 0,x<w-1 and p+1 or 0,p-w,p+w}
        for _,n in ipairs(neighbours) do
          if n>0 and n<=w*h and mask[n] and not labels[n] then
            labels[n]=nextLabel;queue[#queue+1]=n
          end
        end
      end
      if #queue<(minArea or 8) then
        for _,p in ipairs(queue) do labels[p]=0 end
      end
    end
  end
  -- Closing repairs one-pixel cuts/pinholes. Conflicting labels leave a gap
  -- between separate letters rather than fusing their faces.
  local expanded={}
  for y=1,h-2 do for x=1,w-2 do
    local label,conflict=0,false
    for dy=-1,1 do for dx=-1,1 do
      local n=labels[(y+dy)*w+x+dx+1] or 0
      if n>0 then
        if label>0 and n~=label then conflict=true end
        label=n
      end
    end end
    expanded[y*w+x+1]=not conflict and label or 0
  end end
  local clean={}
  for y=2,h-3 do for x=2,w-3 do
    local p=y*w+x+1
    local label=expanded[p] or 0
    local solid=label>0
    if solid then
      for dy=-1,1 do for dx=-1,1 do
        if expanded[(y+dy)*w+x+dx+1]~=label then solid=false end
      end end
    end
    if solid then clean[p]=true end
  end end
  return clean
end
return Mask
