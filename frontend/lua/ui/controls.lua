-- Keyboard focus helpers shared by the screens' control lists.
local Controls={}
-- Left, up and Shift+Tab move focus backwards.
function Controls.backward(key)
  return key=='left' or key=='up' or (key=='tab' and love.keyboard.isDown('lshift','rshift'))
end
-- Steps focus by dir (wrapping over 1..count) until skip(index) is false, at
-- most count times. Returns the new focus and whether it is focusable.
function Controls.cycle(focus,dir,count,skip)
  for _=1,count do
    focus=(focus-1+dir)%count+1
    if not skip(focus) then return focus,true end
  end
  return focus,false
end
return Controls
