-- Pokémon energy types in Balatro's palette, with pixel-cut glyphs drawn in
-- Lua. Pips are used on card popups, under in-play
-- Pokémon for attached Energy, and inside attack buttons for costs.
local T=require('ui.theme')
local g=love.graphics
local Energy={}
local GLYPH_INK={0.025,0.035,0.04,1}
local function hex(s) return {tonumber(s:sub(1,2),16)/255,tonumber(s:sub(3,4),16)/255,tonumber(s:sub(5,6),16)/255,1} end
Energy.colours={
  Grass=hex('4BC292'),Fire=hex('FE5F55'),Water=hex('009DFF'),Lightning=hex('F5B244'),
  Psychic=hex('8867A5'),Fighting=hex('CB724C'),Darkness=hex('3F4A6B'),Metal=hex('9BB6BD'),
  Fairy=hex('F06B9F'),Dragon=hex('B18F43'),Colorless=hex('EFEFEF'),Special=hex('D8D8D8'),Free=hex('EFEFEF'),
}
Energy.letters={Grass='G',Fire='R',Water='W',Lightning='L',Psychic='P',Fighting='F',Darkness='D',Metal='M',Fairy='Y',Dragon='N',Colorless='C',Special='S'}
Energy.order={'Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Fairy','Dragon','Colorless'}
function Energy.colour(kind) return Energy.colours[kind] or Energy.colours.Colorless end
function Energy.normalise(kind)
  kind=tostring(kind or '')
  if kind=='' then return 'Colorless' end
  if Energy.colours[kind] then return kind end
  local lower=kind:lower()
  for name in pairs(Energy.colours) do if name:lower()==lower then return name end end
  if lower=='electric' then return 'Lightning' end
  if lower=='dark' then return 'Darkness' end
  if lower=='steel' then return 'Metal' end
  if lower=='normal' then return 'Colorless' end
  return 'Special'
end
-- Octagonal "pixel circle" so pips sit in the same vocabulary as the stepped panels.
local function disc(x,y,r)
  local k=r*0.4142
  g.polygon('fill',x-k,y-r,x+k,y-r,x+r,y-k,x+r,y+k,x+k,y+r,x-k,y+r,x-r,y+k,x-r,y-k)
end
local function glyph(kind,x,y,r,foreground,background,alpha)
  local s=r/10
  g.push();g.translate(x,y);g.scale(s)
  local function ink(c) g.setColor(c[1],c[2],c[3],alpha) end
  ink(foreground)
  -- Broad silhouettes and negative-space details remain legible at cost-icon size.
  if kind=='Fire' then
    g.polygon('fill',1,-9,3,-7,4,-4,3,0,6,-1,8,-4,8,0,6,4,3,7,0,8,-4,7,-7,4,-8,0,-6,2,-6,-2,-3,-6,-4,-2,-2,0,-2,-3,1,-6)
    ink(background);g.polygon('fill',1,-1,2,2,1,3,3,2,3,5,1,7,-2,6,-3,4,-1,2,0,0)
  elseif kind=='Water' then
    g.polygon('fill',8,-7,3,-6,1,-4,1,-2,3,1,4,4,3,6,1,8,-3,8,-6,6,-8,3,-8,0,-6,-3,-2,-5,3,-6)
    ink(background);g.polygon('fill',-4,5,-2,5,0,6,0,7,-2,7,-4,6)
  elseif kind=='Grass' then
    g.polygon('fill',4,-9,7,-3,8,2,6,6,2,7,0,7,0,9,-2,9,-2,7,-6,5,-8,2,-7,-2,-4,-5)
    ink(background);g.polygon('fill',-2,7,-2,2,-1,-2,3,-7,1,-2,0,2,0,7)
    g.polygon('fill',-1,2,-4,0,-6,0,-4,-1,0,1)
    g.polygon('fill',0,0,3,-3,5,-3,3,-1,0,2)
    g.polygon('fill',-1,5,2,3,5,3,2,4,0,6)
  elseif kind=='Lightning' then
    g.polygon('fill',2,-9,-1,-2,7,-4,-3,9,0,1,-8,3)
  elseif kind=='Psychic' then
    g.polygon('fill',-9,0,-6,-4,-3,-6,0,-7,3,-6,6,-4,9,0,6,4,3,6,0,7,-3,6,-6,4)
    ink(background);g.polygon('fill',-7,0,-4,-4,0,-5,4,-4,7,0,4,4,0,5,-4,4)
    ink(foreground);disc(0,0,4)
    ink(background);disc(-1,-1,2)
  elseif kind=='Fighting' then
    g.rectangle('fill',-8,-6,3,6);g.rectangle('fill',-4,-8,3,8)
    g.rectangle('fill',0,-8,3,8);g.rectangle('fill',4,-6,3,6)
    g.polygon('fill',-8,1,0,1,0,3,-3,4,-3,6,-6,7,-8,5)
    g.polygon('fill',2,1,7,1,7,6,4,7,4,9,-3,9,-5,8,-1,6,-1,4,2,3)
  elseif kind=='Darkness' then
    disc(0,0,8)
    ink(background);disc(0,-5,3.5)
  elseif kind=='Metal' then
    g.polygon('fill',-4,-3,4,-3,0,4)
    g.polygon('fill',-2,-7,-5,-7,-8,-3,-6,1,-4,1,-6,-3,-4,-5,-1,-5)
    g.polygon('fill',2,-7,5,-7,8,-3,6,1,4,1,6,-3,4,-5,1,-5)
    g.polygon('fill',-4,3,-2,6,2,6,4,3,5,5,3,8,-3,8,-5,5)
  elseif kind=='Fairy' then
    g.polygon('fill',0,-8,3,-3,8,-5,5,1,2,3,0,8,-2,3,-5,1,-8,-5,-3,-3)
    ink(background);g.polygon('fill',0,-3,2,0,0,3,-2,0)
  elseif kind=='Dragon' then
    g.polygon('fill',5,-6,1,-8,-3,-8,-6,-6,-8,-2,-8,2,-6,6,-2,8,3,8,7,6,8,4,-3,-5,-1,2,2,4,-2,3,-4,0,-5,-3,-4,-5,-1,-6,2,-6)
    ink(background);g.polygon('fill',0,0,4,3,2,3)
  elseif kind=='Special' then
    g.polygon('fill',0,-8,3,-3,8,0,3,3,0,8,-3,3,-8,0,-3,-3)
    ink(background);g.polygon('fill',0,-3,3,0,0,3,-3,0)
  else
    -- LÖVE fills convex polygons: render the concave star as triangles so its
    -- six points do not collapse into overlapping wedges in the live renderer.
    local points={0,-8.5,1.8,-3.1,7.4,-4.25,3.6,0,7.4,4.25,1.8,3.1,
      0,8.5,-1.8,3.1,-7.4,4.25,-3.6,0,-7.4,-4.25,-1.8,-3.1}
    for i=1,#points,2 do
      local nextIndex=(i+1)%#points+1
      g.polygon('fill',0,0,points[i],points[i+1],points[nextIndex],points[nextIndex+1])
    end
  end
  g.pop()
end
-- A single pip. `r` is the radius in pixels; dark silhouettes identify each type.
function Energy.pip(x,y,r,kind,alpha)
  kind=Energy.normalise(kind)
  local c=Energy.colour(kind)
  alpha=alpha or 1
  -- Ink ring and drop shadow, a light rim so the disc stands off dark panels
  -- and card art alike, then the glyph at full contrast.
  g.setColor(T.ink[1],T.ink[2],T.ink[3],alpha)
  disc(x,y+1.5,r+1.6)
  disc(x,y,r+1.6)
  g.setColor(1,1,1,alpha*0.55)
  disc(x,y,r+0.6)
  g.setColor(c[1],c[2],c[3],alpha)
  disc(x,y,r)
  -- A free cost is an empty pip: the same rim and shadow, without an Energy glyph.
  if kind~='Free' then glyph(kind,x,y,r,GLYPH_INK,c,alpha) end
end
-- A row of pips centred on (x,y); returns its width.
function Energy.row(types,x,y,r,gap,alpha,align)
  local n=#types
  if n==0 then return 0 end
  local step=2*r+(gap or 3)
  local width=n*step-(gap or 3)
  local start=align=='left' and x+r or align=='right' and x-width+r or x-width/2+r
  for i,kind in ipairs(types) do Energy.pip(start+(i-1)*step,y,r,kind,alpha) end
  return width
end
function Energy.split(csv)
  local list={}
  for part in tostring(csv or ''):gmatch('[^,]+') do
    part=part:match('^%s*(.-)%s*$')
    if part~='' then list[#list+1]=part end
  end
  return list
end
return Energy
