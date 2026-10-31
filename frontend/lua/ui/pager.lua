-- The '<' Page n/m '>' pagers: what they say, when they take keyboard focus, and, for the
-- collection pages and the lobby's deck picker, where their arrows sit and how the face draws.
local Button=require('ui.button')
local Pager={}
-- 'Page 3 of 11', as a page change is announced; `what` names the list ('Deck page 2 of 3').
function Pager.page(page,pages,what)
  return (what and what..' page ' or 'Page ')..(page or 1)..' of '..(pages or 1)
end
-- 'Previous page, page 1 of 3' for dir -1, 'Next page, ...' for dir 1.
function Pager.label(dir,page,pages)
  return (dir<0 and 'Previous page' or 'Next page')..', page '..(page or 1)..' of '..(pages or 1)
end
-- Gives a pager arrow its spoken label. With one page it does nothing, so Tab
-- skips it; it still draws and answers the pointer as before.
function Pager.arrow(control,dir,page,pages)
  control.speech=Pager.label(dir,page,pages)
  control.skipFocus=(pages or 1)<=1
  return control
end
-- Each page's pager is a `spec`: the face (the create_option_cycle centre with the page text) is
-- `w` wide and `h` tall at `face` pixels right of the page's anchor; the arrows are `arrow` wide,
-- as tall, 6 pixels either side of it, with `fontSize` when given. `emboss` and `textScale` pass
-- to Button.cycleFace and PageText:draw. The offsets are whole pixels, so anchor+offset lands
-- where each page's own sums did.
local GAP=6
-- Adds the '<' and '>' arrows for a pager anchored at (x,y): make(label,x,y,w,h,dir) adds a
-- control and returns it (the page keeps its own action, colour and disabled state), and Pager
-- gives each its spoken label and focus stop. Returns both.
function Pager.arrows(spec,x,y,page,pages,make)
  local left=Pager.arrow(make('<',x+(spec.face-GAP-spec.arrow),y,spec.arrow,spec.h,-1),-1,page,pages)
  local right=Pager.arrow(make('>',x+(spec.face+spec.w+GAP),y,spec.arrow,spec.h,1),1,page,pages)
  if spec.fontSize then left.fontSize,right.fontSize=spec.fontSize,spec.fontSize end
  return left,right
end
-- Draws the face of a pager anchored at (x,y) and its PageText `text`; it lights while `live` and
-- the pointer (mx,my) is over it.
function Pager.draw(spec,x,y,text,live,mx,my,time,reduced,roomWidth)
  local fx=x+spec.face
  local hovered=live and Button.hit({x=fx,y=y,w=spec.w,h=spec.h},mx or -1,my or -1)
  Button.cycleFace(fx,y,spec.w,spec.h,hovered,spec.emboss)
  text:draw(time,reduced,fx,y,spec.w,spec.h,roomWidth,spec.textScale)
end
return Pager
