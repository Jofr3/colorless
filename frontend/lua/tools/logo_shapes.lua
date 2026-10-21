-- Shape-only authoring pass. Transform each cleaned face and its reflections
-- together before rebuilding the bevel, so the rim keeps a consistent depth.
local Shapes={}
local glyphs={
  -- x bounds, top, baseline, stem/centre pivot, height, cap tilt,
  -- horizontal scale and lean at cap, shoulder, waist, bowl, baseline.
  {name='C',left=0,right=144,top=94,base=281,pivot=93,height=1.03,tilt=-2,
    width={1.04,1,.96,.98,1.04},lean={-2,0,-1,1,-2}},
  {name='O',left=145,right=247,top=93,base=279,pivot=199,height=1.03,tilt=3,
    width={.94,1,.97,.98,.94},lean={1,0,-1,0,2}},
  {name='L',left=248,right=349,top=61,base=300,pivot=270,height=1,tilt=1,
    width={1,.90,.88,.94,1.06},lean={-1,-1,0,-1,-2}},
  {name='O',left=350,right=464,top=88,base=281,pivot=409,height=.99,tilt=-2,
    width={1,.98,.96,.98,.96},lean={-1,1,1,0,-1}},
  {name='R',left=465,right=587,top=81,base=309,pivot=490,height=.99,tilt=5,
    width={.94,.96,.98,1.02,1.07},lean={0,1,0,-1,-2}},
  {name='L',left=588,right=682,top=56,base=305,pivot=608,height=1,tilt=-1,
    width={1,.92,.87,.95,1.04},lean={0,1,0,0,-1}},
  {name='E',left=683,right=781,top=75,base=308,pivot=704,height=1,tilt=-3,
    width={1,.96,.90,.98,1.03},lean={-1,0,0,0,0}},
  {name='S',left=782,right=885,top=97,base=279,pivot=835,height=1.02,tilt=4,
    width={.96,1,.86,1.02,.97},lean={1,1,-2,0,-1}},
  {name='S',left=886,right=1023,top=97,base=279,pivot=936,height=1,tilt=-3,
    width={.98,.96,.88,1,.96},lean={-1,-1,1,0,1}},
}
local function profile(values,t)
  t=math.max(0,math.min(1,t))*4
  local i=math.min(4,math.floor(t)+1)
  return values[i]+(values[i+1]-values[i])*(t-i+1)
end
function Shapes.refine(face)
  local w,h=face:getDimensions()
  local result=love.image.newImageData(w,h,'rgba8')
  local occupied={}
  for _,glyph in ipairs(glyphs) do
    local span=glyph.right-glyph.left
    for y=math.max(0,glyph.top-16),math.min(h-1,glyph.base+16) do
      for x=math.max(0,glyph.left-12),math.min(w-1,glyph.right+12) do
        -- Inverse sampling retains continuous strokes when a waist narrows or
        -- a terminal extends. Solve the small cap-tilt coupling locally.
        local sy=glyph.base+(y-glyph.base)/glyph.height
        local sx
        for _=1,3 do
          local t=(sy-glyph.top)/(glyph.base-glyph.top)
          sx=glyph.pivot+(x-glyph.pivot-profile(glyph.lean,t))/profile(glyph.width,t)
          sy=glyph.base+(y-glyph.base-glyph.tilt*(sx-glyph.pivot)/span)/glyph.height
        end
        sx,sy=math.floor(sx+.5),math.floor(sy+.5)
        if sx>=glyph.left and sx<=glyph.right and sy>=0 and sy<h then
          local r,g,b,a=face:getPixel(sx,sy)
          if a>.5 then result:setPixel(x,y,r,g,b,a);occupied[y*w+x+1]=true end
        end
      end
    end
  end
  -- Nearest-pixel remapping can detach a single pixel at an acute endpoint.
  -- Keep diagonal connections (intentional points), discard detached flecks,
  -- and refuse an export if a letter was split or two ivory faces were joined.
  local visited,letters={},0
  for start in pairs(occupied) do
    if not visited[start] then
      local queue,head={start},1
      visited[start]=true
      while head<=#queue do
        local p=queue[head];head=head+1
        local x,y=(p-1)%w,math.floor((p-1)/w)
        for dy=-1,1 do for dx=-1,1 do
          local nx,ny=x+dx,y+dy
          local n=ny*w+nx+1
          if nx>=0 and nx<w and ny>=0 and ny<h and occupied[n] and not visited[n] then
            visited[n]=true;queue[#queue+1]=n
          end
        end end
      end
      if #queue<8 then
        for _,p in ipairs(queue) do result:setPixel((p-1)%w,math.floor((p-1)/w),0,0,0,0) end
      else letters=letters+1 end
    end
  end
  assert(letters==#glyphs,'Shape refinement must retain nine separate, continuous letter faces')
  return result
end
return Shapes
