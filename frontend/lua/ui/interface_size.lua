-- Settings' Interface Size (audit LQX2): 100%, 125% or 150%. A layer grows by shrinking the
-- virtual canvas it lays out in (main.lua): at factor f it lays out in the canvas divided by f and
-- is drawn f times larger, over the same part of the screen. Every page is hand-placed for its
-- canvas, so each layer names the smallest canvas its content still fits, and takes the largest
-- step up to the chosen one whose shrunken canvas is at least that big; a layer as big as the
-- canvas stays at 100%.
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
return Size
