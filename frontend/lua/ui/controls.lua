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
-- Where Tab's ring starts: after the controls listed first that the page reaches last
-- (`ringLast`, a Back drawn before the page's content), so Tab lands on the primary region.
function Controls.first(controls)
  local first=1
  while controls[first] and controls[first].ringLast do first=first+1 end
  return first
end
-- Tab and Shift+Tab: the next or previous control in list order, as cycle steps. With nothing
-- focused Tab lands on `first` (default 1) and Shift+Tab on the control before it, the last
-- when first is 1, so the ring reads first..count, then 1..first-1.
function Controls.ring(focus,dir,count,skip,first)
  first=first or 1
  if focus<1 then focus=dir>0 and first-1 or first end
  return Controls.cycle(focus,dir,count,skip)
end
local ARROWS={left={-1,0},right={1,0},up={0,-1},down={0,1}}
-- A box seen along an arrow: its span along the arrow (a0 < a1, increasing in the arrow's
-- direction) and its span across it.
local function along(b,d)
  local a0,a1,b0,b1
  if d[1]~=0 then a0,a1,b0,b1=b.x,b.x+b.w,b.y,b.y+b.h else a0,a1,b0,b1=b.y,b.y+b.h,b.x,b.x+b.w end
  if d[1]+d[2]<0 then a0,a1=-a1,-a0 end
  return a0,a1,b0,b1
end
-- Android's FocusFinder rules, written along the arrow: a candidate lies further that way, its
-- near edge past the source's middle (FocusFinder takes any near edge past the source's, but a
-- fanned card row sets its outer cards a few pixels lower, which made them "below"); one in the
-- beam (overlapping across the arrow) beats one outside it unless that one is nearer than
-- the beam one's far edge (always, sideways); else the nearer by 13 x gap² + offset² wins.
local function better(s,c,best,sideways)
  local cBeam=c.b1>s.b0 and c.b0<s.b1
  local bestBeam=best.b1>s.b0 and best.b0<s.b1
  if cBeam~=bestBeam then
    local beam,other=cBeam and c or best,cBeam and best or c
    local wins=other.a0<s.a1 or sideways or math.max(0,beam.a0-s.a1)<math.max(1,other.a1-s.a1)
    if wins then return cBeam end
  end
  return c.weight<best.weight
end
-- Arrow keys by layout: the nearest control in the arrow's direction, by better() above; a
-- control hanging under its pile (`arrowSkip`) is left to Tab. Nothing that way keeps focus
-- where it is. With nothing focused Right and Down land where Tab would, Left and Up where
-- Shift+Tab would. Returns the new focus and whether it moved.
function Controls.grid(focus,key,controls,skip,first)
  local d=ARROWS[key]
  if not d then return focus,false end
  skip=skip or function(i) return Controls.unfocusable(controls[i]) end
  local from=controls[focus]
  if not from then return Controls.ring(0,(key=='left' or key=='up') and -1 or 1,#controls,skip,first) end
  local s={};s.a0,s.a1,s.b0,s.b1=along(from,d)
  local best,bestIndex
  for i,b in ipairs(controls) do
    if i~=focus and not b.arrowSkip and not skip(i) then
      local c={};c.a0,c.a1,c.b0,c.b1=along(b,d)
      if c.a0>(s.a0+s.a1)/2 and s.a1<c.a1 then
        local gap=math.max(0,c.a0-s.a1)
        local offset=(c.b0+c.b1)/2-(s.b0+s.b1)/2
        c.weight=13*gap*gap+offset*offset
        if not best or better(s,c,best,d[1]~=0) then best,bestIndex=c,i end
      end
    end
  end
  if best then return bestIndex,true end
  return focus,false
end
function Controls.arrow(key) return ARROWS[key]~=nil end
-- A page's focus keys: Tab and Shift+Tab by ring, arrows by grid.
function Controls.move(focus,key,controls,skip,first)
  skip=skip or function(i) return Controls.unfocusable(controls[i]) end
  if key=='tab' then return Controls.ring(focus,Controls.backward(key) and -1 or 1,#controls,skip,first) end
  return Controls.grid(focus,key,controls,skip,first)
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
