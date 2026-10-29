-- What the '<' Page n/m '>' pagers say, and when they take keyboard focus.
-- Each page still draws its own pager; this keeps the spoken labels in one place.
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
return Pager
