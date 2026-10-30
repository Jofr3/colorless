-- Larger targets without larger buttons (audit PG8, QA11, LC4): a control keeps its drawn face and
-- gets a larger invisible hit rectangle, `b.hitRect`, which Button.hit tests instead of the face.
-- It grows around the face to a minimum size, stays inside `bounds`, and never reaches another
-- control: two faces that both grow split the gap between them at its middle; anything else (a
-- control that does not grow, its existing hit rectangle, a card) stops it at its edge.
local HitArea={}
local function overlaps(a,b)
  return a.x<b.x+b.w and b.x<a.x+a.w and a.y<b.y+b.h and b.y<a.y+a.h
end
HitArea.overlaps=overlaps
-- Where face `a` must stop to keep clear of rectangle `o`: the side of `a` facing it across the
-- wider gap, the gap's middle and o's near edge. Nil when they already overlap.
local function separator(a,o)
  local best
  for _,s in ipairs({
    {side='right',gap=o.x-(a.x+a.w),middle=(a.x+a.w+o.x)/2,edge=o.x},
    {side='left',gap=a.x-(o.x+o.w),middle=(o.x+o.w+a.x)/2,edge=o.x+o.w},
    {side='bottom',gap=o.y-(a.y+a.h),middle=(a.y+a.h+o.y)/2,edge=o.y},
    {side='top',gap=a.y-(o.y+o.h),middle=(o.y+o.h+a.y)/2,edge=o.y+o.h},
  }) do
    if s.gap>=0 and (not best or s.gap>best.gap) then best=s end
  end
  return best
end
-- Moves rectangle r's `side` back to `at` at most, never into the face f.
local function clip(r,f,side,at)
  if side=='right' then r.r=math.max(f.x+f.w,math.min(r.r,at))
  elseif side=='left' then r.l=math.min(f.x,math.max(r.l,at))
  elseif side=='bottom' then r.b=math.max(f.y+f.h,math.min(r.b,at))
  else r.t=math.min(f.y,math.max(r.t,at)) end
end
local function rect(r) return {x=r.l,y=r.t,w=r.r-r.l,h=r.b-r.t} end
-- The rectangle `b` takes with nothing around it: minW x minH centred on the face (or hanging
-- from its top when b.hitGrow is 'down', for a control just under something), shifted back inside
-- `bounds` (what one side cannot take goes to the other).
local function target(b,minW,minH,bounds)
  local w,h=math.max(b.w,minW),math.max(b.h,minH)
  local r={l=b.x-(w-b.w)/2,t=b.hitGrow=='down' and b.y or b.y-(h-b.h)/2}
  r.r,r.b=r.l+w,r.t+h
  if bounds then
    local bl,bt=math.min(bounds.x,b.x),math.min(bounds.y,b.y)
    local br,bb=math.max(bounds.x+bounds.w,b.x+b.w),math.max(bounds.y+bounds.h,b.y+b.h)
    if r.l<bl then r.r=math.min(br,r.r+bl-r.l);r.l=bl end
    if r.r>br then r.l=math.max(bl,r.l-(r.r-br));r.r=br end
    if r.t<bt then r.b=math.min(bb,r.b+bt-r.t);r.t=bt end
    if r.b>bb then r.t=math.max(bt,r.t-(r.b-bb));r.b=bb end
  end
  return r
end
-- Gives every control in `list` smaller than minW x minH a hit rectangle. `others`: the controls
-- around them (the list's own members count too); `obstacles`: plain rectangles such as cards;
-- `bounds`: the region the hit areas stay in. A control that is large enough keeps its face.
function HitArea.inflate(list,minW,minH,others,obstacles,bounds)
  local grown,targets={},{}
  for _,b in ipairs(list) do
    if b.w<minW or b.h<minH then grown[#grown+1]=b;targets[b]=target(b,minW,minH,bounds) end
  end
  local around={}
  for _,o in ipairs(list) do around[#around+1]=o end
  for _,o in ipairs(others or {}) do around[#around+1]=o end
  for _,o in ipairs(obstacles or {}) do around[#around+1]=o end
  for _,b in ipairs(grown) do
    local t=targets[b]
    local r={l=t.l,t=t.t,r=t.r,b=t.b}
    for _,o in ipairs(around) do
      -- Two growing faces share the gap; anything else is a wall at its hit rectangle or face.
      local reach=targets[o] and rect(targets[o]) or o.hitRect or o
      if o~=b and overlaps(rect(r),reach) then
        local s=separator(b,targets[o] and o or reach)
        if s then clip(r,b,s.side,targets[o] and s.middle or s.edge) end
      end
    end
    b.hitRect=rect(r)
  end
end
return HitArea
