-- The viewport mailbox (host.js syncViewport): the canvas's CSS width and height, the system
-- reduced-motion flag, then its device-pixel width and height, the CSS size times the device
-- pixel ratio, then 1 when the primary pointer is coarse (a touch screen: a phone or tablet that
-- can be turned). A host that sends no device size means one device pixel per CSS pixel; one
-- that sends no pointer flag, a fine pointer.
local Viewport={}
-- The most device pixels drawn a frame (a 2560x1600 laptop). Past about 4 MP an integrated GPU
-- (Intel HD 630) drops to 31-37 fps, so a denser screen renders at the highest pixel ratio within
-- it, and the browser scales the canvas up; never under one pixel per CSS pixel, which is as main
-- drew before full-density rendering.
Viewport.PIXEL_BUDGET=2560*1600
-- Nil for a malformed record. `limit`, the GPU's largest texture side: a device size wider or
-- taller renders at the largest size that fits, at the same aspect, and the browser scales it up.
function Viewport.parse(raw,limit)
  local w,h,reduced,pw,ph,coarse=(raw or ''):match('^(%d+) (%d+) (%d) ?(%d*) ?(%d*) ?(%d?)')
  w,h=tonumber(w),tonumber(h)
  if not w or not h or w<1 or h<1 then return nil end
  pw,ph=tonumber(pw),tonumber(ph)
  if not pw or not ph or pw<1 or ph<1 then pw,ph=w,h end
  if pw*ph>Viewport.PIXEL_BUDGET then
    local ratio=math.max(1,math.sqrt(Viewport.PIXEL_BUDGET/(w*h)))
    if ratio<ph/h then pw,ph=math.floor(w*ratio),math.floor(h*ratio) end
  end
  if limit and (pw>limit or ph>limit) then
    local fit=math.min(limit/pw,limit/ph)
    pw,ph=math.max(1,math.floor(pw*fit)),math.max(1,math.floor(ph*fit))
  end
  -- Device pixels per CSS pixel, from the height: the CRT's scanline count follows it.
  return {w=w,h=h,reduced=reduced=='1',pixelWidth=pw,pixelHeight=ph,density=ph/h,coarse=coarse=='1'}
end
return Viewport
