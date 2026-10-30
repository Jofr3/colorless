-- How large the layout draws on the player's screen, for choices made by on-screen size (audit
-- LC4, QA11, PG8). main.lua's layout sets it before the pages lay out. Sizes are CSS pixels per
-- virtual pixel: of the base canvas (`scale`), of the collection panel (decks, builder, sandbox)
-- and of Settings.
local Display={scale=1,collection=1,popup=1,portrait=false,coarse=false}
-- The smallest secondary text on a phone held upright, in CSS pixels.
Display.MIN_TEXT_CSS=11
function Display.set(fields)
  for key,value in pairs(fields) do Display[key]=value end
end
-- A phone held upright: the portrait layout drawn smaller than its own size.
function Display.phone()
  return Display.portrait and Display.scale<1
end
-- A font size for secondary (non-button) text: `size` virtual pixels, raised on a phone held
-- upright to MIN_TEXT_CSS on screen at `cssPerUnit` (default: the base canvas).
function Display.text(size,cssPerUnit)
  if not Display.phone() then return size end
  return math.max(size,math.ceil(Display.MIN_TEXT_CSS/(cssPerUnit or Display.scale)))
end
-- The same for a DynaText scale (60 virtual pixels per unit).
function Display.dyna(scale,cssPerUnit)
  if not Display.phone() then return scale end
  return math.max(scale,Display.MIN_TEXT_CSS/(cssPerUnit or Display.scale)/60)
end
-- Virtual pixels that measure `css` CSS pixels on screen at `cssPerUnit`.
function Display.units(css,cssPerUnit)
  return css/(cssPerUnit or Display.scale)
end
return Display
