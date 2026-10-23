-- Wheel and trackpad scrolls arrive as bursts of events; turn at most one
-- page per DELAY so a single flick doesn't skip past several pages.
local WheelPager={DELAY=0.25}
function WheelPager.ready(owner)
  local now=love.timer and love.timer.getTime() or os.clock()
  if owner.wheelPagedAt and now-owner.wheelPagedAt<WheelPager.DELAY then return false end
  owner.wheelPagedAt=now
  return true
end
return WheelPager
