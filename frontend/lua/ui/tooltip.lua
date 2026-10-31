-- A short name beside an icon-only control (audit SM12). The table's hot-seat history row draws
-- pixel icons only, so after DELAY seconds on one, under the pointer or keyboard focus, its spoken
-- label shows in the card popup's frame beside it. It is only drawn: it takes no clicks, never
-- covers its control, stays on the board and goes as soon as the pointer or focus moves on. With
-- motion it grows in over GROW seconds; under reduced motion it appears whole.
local T=require('ui.theme')
local Popup=require('ui.popup')
local Dyna=require('ui.dynatext')
local Display=require('ui.display')
local g=love.graphics
local Tooltip={DELAY=0.4,GROW=0.12}
Tooltip.__index=Tooltip
-- Spacing from the button's drawn face (lifted 1.8 at rest, its panel 3 below its bounds) and the
-- board's edge; the frame's shade hangs SHADE below its box.
local GAP,MARGIN,SHADE,LIFT,BELOW=6,4,4,2,3
local PAD_X,PAD_Y=10,6
function Tooltip.new() return setmetatable({held=0},Tooltip) end
-- `control` is what the pointer or keyboard focus rests on this frame, nil for none. A new
-- control starts the wait again.
function Tooltip:update(dt,control,reduced)
  local key=control and control.label
  if key~=self.key then self.key,self.held=key,0 elseif control then self.held=self.held+dt end
  self.control,self.reduced=control,reduced
end
-- The label's DynaText scale: about 22 virtual pixels, at least 12 CSS pixels on screen.
function Tooltip.scale() return math.max(0.36,12/Display.scale/60) end
-- Where a w x h box goes beside control b on the board: centred above it, else below, else to
-- its right, else to its left, kept MARGIN inside the board.
function Tooltip.place(b,w,h,boardW,boardH)
  local x=math.max(MARGIN,math.min(boardW-MARGIN-w,b.x+b.w/2-w/2))
  local above=b.y-LIFT-GAP-SHADE-h
  if above>=MARGIN then return x,above end
  local below=b.y+b.h+BELOW+GAP
  if below+h+SHADE<=boardH-MARGIN then return x,below end
  local y=math.max(MARGIN,math.min(boardH-MARGIN-SHADE-h,b.y+b.h/2-h/2))
  if b.x+b.w+GAP+w<=boardW-MARGIN then return b.x+b.w+GAP,y end
  return math.max(MARGIN,b.x-GAP-w),y
end
-- The box drawn now (x, y, w, h without the shade, its label and its growth), or nil.
function Tooltip:box(boardW,boardH)
  local b=self.control
  if not b or self.held<Tooltip.DELAY then return nil end
  local scale=Tooltip.scale()
  local tw,th=Dyna.measure(b.label,scale)
  local w,h=tw+2*PAD_X,th+2*PAD_Y
  local x,y=Tooltip.place(b,w,h,boardW,boardH)
  local grow=self.reduced and 1 or math.min(1,(self.held-Tooltip.DELAY)/Tooltip.GROW)
  return {x=x,y=y,w=w,h=h,label=b.label,textScale=scale,scale=0.85+0.15*grow}
end
function Tooltip:draw(boardW,boardH,roomWidth)
  local box=self:box(boardW,boardH)
  if not box then return end
  local cx,cy=box.x+box.w/2,box.y+box.h/2
  g.push();g.translate(cx,cy);g.scale(box.scale);g.translate(-cx,-cy)
  Popup.frame(box.x,box.y,box.w,box.h)
  Dyna.static(box.label,box.textScale,box.x+PAD_X,box.y,box.w-2*PAD_X,box.h,T.white,{roomWidth=roomWidth})
  g.pop()
end
return Tooltip
