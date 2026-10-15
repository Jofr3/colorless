-- Pokémon energy types in Balatro's palette, with pixel-cut glyphs drawn in
-- Lua (no trademarked symbols). Pips are used on card popups, under in-play
-- Pokémon for attached Energy, and inside attack buttons for costs.
local T=require('ui.theme')
local g=love.graphics
local Energy={}
local function hex(s) return {tonumber(s:sub(1,2),16)/255,tonumber(s:sub(3,4),16)/255,tonumber(s:sub(5,6),16)/255,1} end
Energy.colours={
  Grass=hex('4BC292'),Fire=hex('FE5F55'),Water=hex('009DFF'),Lightning=hex('F5B244'),
  Psychic=hex('8867A5'),Fighting=hex('CB724C'),Darkness=hex('3F4A6B'),Metal=hex('9BB6BD'),
  Fairy=hex('F06B9F'),Dragon=hex('B18F43'),Colorless=hex('EFEFEF'),Special=hex('D8D8D8'),
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
local function glyph(kind,x,y,r)
  local s=r/10
  g.push();g.translate(x,y);g.scale(s)
  if kind=='Fire' then g.polygon('fill',0,-7,4,-2,3,3,5,5,0,7,-5,5,-3,0,-1,2,1,-2)
  elseif kind=='Water' then g.polygon('fill',0,-7,4,-1,5,3,3,6,0,7,-3,6,-5,3,-4,-1)
  elseif kind=='Grass' then g.polygon('fill',0,-7,5,-4,6,1,3,6,0,7,-3,6,-6,1,-5,-4);g.setColor(0,0,0,0.25);g.rectangle('fill',-0.7,-5,1.4,11)
  elseif kind=='Lightning' then g.polygon('fill',2,-7,-4,1,-1,1,-2,7,4,-1,1,-1)
  elseif kind=='Psychic' then g.polygon('fill',-7,0,-3,-4,3,-4,7,0,3,4,-3,4);g.setColor(T.ink);disc(0,0,2.2)
  elseif kind=='Fighting' then g.rectangle('fill',-5,-5,10,10);g.setColor(0,0,0,0.25);g.rectangle('fill',-5,-1,10,1.5);g.rectangle('fill',-1,-5,1.5,10)
  elseif kind=='Darkness' then disc(0,0,6.5);g.setColor(Energy.colours.Darkness);disc(2.5,-1.5,5)
  elseif kind=='Metal' then g.polygon('fill',0,-7,6,-3.5,6,3.5,0,7,-6,3.5,-6,-3.5);g.setColor(0,0,0,0.25);g.polygon('fill',0,-3,3,-1.5,3,1.5,0,3,-3,1.5,-3,-1.5)
  elseif kind=='Fairy' then g.polygon('fill',0,-7,2,-2,7,0,2,2,0,7,-2,2,-7,0,-2,-2)
  elseif kind=='Dragon' then g.polygon('fill',0,-7,6,0,0,7,-6,0);g.setColor(0,0,0,0.25);g.polygon('fill',0,-3,3,0,0,3,-3,0)
  elseif kind=='Special' then g.polygon('fill',0,-7,2,-2,7,-2,3,1,5,7,0,3,-5,7,-3,1,-7,-2,-2,-2)
  else g.polygon('fill',0,-7,2,-2,7,-2,3,1,5,7,0,3,-5,7,-3,1,-7,-2,-2,-2) end
  g.pop()
end
-- A single pip. `r` is the radius in pixels; light types get ink glyphs.
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
  local dark=kind=='Colorless' or kind=='Metal' or kind=='Lightning' or kind=='Special'
  local gc=dark and T.ink or T.white
  g.setColor(gc[1],gc[2],gc[3],alpha*(dark and 0.85 or 1))
  glyph(kind,x,y,r*0.66)
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
