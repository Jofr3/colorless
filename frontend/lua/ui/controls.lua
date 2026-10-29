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
-- Whether Tab and the arrows pass over a control: a disabled one, an inert one,
-- or one that only answers the pointer (a pager with a single page).
function Controls.unfocusable(control)
  return control.disabled or control.inert or control.skipFocus or false
end
-- Whether control i draws its hover look: the pointer's control wins, and
-- keyboard focus shows only while the pointer is over none, so one control
-- looks active at a time (main parks the pointer on a key press).
function Controls.lit(hover,focus,i)
  return hover==i or (hover==0 and focus==i)
end
return Controls
