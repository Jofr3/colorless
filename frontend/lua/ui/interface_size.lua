-- Settings' Interface Size: 100%, 125% or 150%. A layer grows by shrinking the virtual canvas it
-- lays out in (main.lua): at factor f it lays out in the canvas divided by f and is drawn f times
-- larger, over the same part of the screen. Every page is hand-placed for its canvas, so each
-- layer names the smallest canvas its content still fits, and takes the largest step up to the
-- chosen one whose shrunken canvas is at least that big; a layer as big as the canvas stays at
-- 100%.
local Size={}
Size.steps={1,1.25,1.5}
Size.labels={'100%','125%','150%'}
-- `choice`: the preference (0, 1 or 2); `w`, `h`: the layer's canvas at 100%; `minW`, `minH`: the
-- smallest canvas its content fits.
function Size.factor(choice,w,h,minW,minH)
  local best=1
  for i=2,math.min(#Size.steps,(choice or 0)+1) do
    local step=Size.steps[i]
    if w/step>=minW and h/step>=minH then best=step end
  end
  return best
end
-- The table's text overlays grow by the chosen step where it fits: the largest scale from
-- `factor` down by STEP for which `fits(scale)` holds, else 1 (100%, never smaller).
Size.STEP=0.05
function Size.grow(factor,fits)
  local scale=factor or 1
  while scale>1+1e-9 do
    if fits(scale) then return scale end
    scale=scale-Size.STEP
  end
  return 1
end
-- Whether two x, y, w, h rectangles overlap.
function Size.overlaps(a,b) return a.x<b.x+b.w and b.x<a.x+a.w and a.y<b.y+b.h and b.y<a.y+a.h end
return Size
