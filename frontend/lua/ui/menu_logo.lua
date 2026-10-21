-- Load the finished sprite directly. No startup shaders, Canvas readbacks or
-- texture reconstruction: the same asset works across graphics backends.
local Logo={}
function Logo.new()
  local texture=love.graphics.newImage('assets/branding/colorless-menu.png')
  texture:setFilter('linear','linear')
  return texture
end
return Logo
