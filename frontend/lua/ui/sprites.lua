-- Balatro's stake chips (resources/textures/2x/chips.png, 58px cells) drawn
-- with the Sprite:draw_shader shadow convention: a 30% black copy projected
-- away from the room centre, then the sprite itself.
local g=love.graphics
local Sprites={}
Sprites.WHITE,Sprites.RED,Sprites.GREEN,Sprites.BLACK,Sprites.BLUE=1,2,3,4,5
Sprites.PURPLE,Sprites.ORANGE,Sprites.GOLD=6,7,8
local atlas,quads
local function load()
  if atlas then return true end
  if not love.filesystem.getInfo('assets/textures/2x/chips.png') then return false end
  atlas=g.newImage('assets/textures/2x/chips.png');atlas:setFilter('nearest','nearest')
  quads={}
  for i=0,9 do quads[i+1]=g.newQuad((i%5)*58,math.floor(i/5)*58,58,58,atlas:getDimensions()) end
  return true
end
-- Draw chip `index` centred at (x,y) with `size` pixels across. `flip` scales
-- the x axis (a spinning coin); `parallax` is the room-relative shadow offset.
function Sprites.chip(index,x,y,size,rotation,flip,parallax,shadowHeight,alpha)
  if not load() then return false end
  local q=quads[index] or quads[1]
  local s=size/58
  flip=flip or 1
  alpha=alpha or 1
  shadowHeight=shadowHeight or 0.1
  if shadowHeight>0 then
    g.setColor(0,0,0,0.3*alpha)
    g.draw(atlas,q,x-(parallax or 0)*shadowHeight*60,y+1.5*shadowHeight*60,rotation or 0,s*flip*(1-0.2*shadowHeight),s*(1-0.2*shadowHeight),29,29)
  end
  g.setColor(1,1,1,alpha)
  g.draw(atlas,q,x,y,rotation or 0,s*flip,s,29,29)
  return true
end
return Sprites
