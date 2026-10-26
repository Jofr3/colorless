-- Balatro's deck backs from Enhancers.png: the red back, or the blue one.
-- The atlas is decoded once and shared by every page that draws a back.
local CardBack={}
local g=love.graphics
local atlas,quads
function CardBack.draw(colour,w,h)
  if not atlas then
    atlas=g.newImage('assets/textures/2x/Enhancers.png')
    atlas:setFilter('nearest','nearest')
    quads={red=g.newQuad(0,0,142,190,atlas:getDimensions()),blue=g.newQuad(0,380,142,190,atlas:getDimensions())}
  end
  g.setColor(1,1,1)
  g.draw(atlas,colour=='blue' and quads.blue or quads.red,0,0,0,w/142,h/190)
end
return CardBack
