-- Load the finished sprite directly. No startup shaders, Canvas readbacks or
-- texture reconstruction: the same asset works across graphics backends.
local Logo={}
function Logo.new()
  local texture=love.graphics.newImage('assets/branding/colorless-menu.png')
  -- Like Balatro's 2x textures: the PNG contains repeated logical pixels;
  -- linear filtering only softens their final display scaling/rotation.
  texture:setFilter('linear','linear')
  return texture
end
return Logo
