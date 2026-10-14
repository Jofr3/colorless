-- Shared by Settings, the deck collection and its management dialogs.
local Motion=require('ui.motion')
local Modal={}
function Modal.motion(reduced)
  local motion=Motion.new(0,reduced and 0 or 10)
  motion.T.y=0
  return motion
end
function Modal.backdrop(w,h)
  -- Draw in framebuffer coordinates so letterboxing and room motion never
  -- leave an undimmed strip around a modal. CRT is applied afterward.
  love.graphics.setColor(95/255,115/255,119/255,0.7)
  love.graphics.rectangle('fill',0,0,w,h)
end
return Modal
