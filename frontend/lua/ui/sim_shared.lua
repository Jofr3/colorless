-- Helpers that more than one part of the table uses (ui/simulator.lua and its sim_* mixins).
local Size=require('ui.interface_size')
local Shared={}
function Shared.popupOffset(popup)
  return popup and popup.motion.VT.y*popup.travel or 0
end
function Shared.groupLabel(group)
  local labels={attach='Attach',evolve='Evolve',tool='Attach',rareCandy='Rare Candy',ability='Ability'}
  return labels[group] or (group:gsub('^%l',string.upper))
end
-- Whether `box` covers no visible control's face that one of the `bases`, the same text at 100%,
-- leaves clear (audit FU1): grown text keeps off the controls it cleared.
function Shared.clears(controls,box,...)
  for _,b in ipairs(controls) do
    if not b.invisible then
      local face={x=b.x,y=b.y-2,w=b.w,h=b.h+5}
      if Size.overlaps(box,face) then
        local covered=false
        for i=1,select('#',...) do covered=covered or Size.overlaps((select(i,...)),face) end
        if not covered then return false end
      end
    end
  end
  return true
end
-- Public cards keep their uid across a hot-seat flip; hidden ones are positional.
function Shared.cardKey(item) return 'card:'..(item.hidden and item.owner..':'..item.id or item.id) end
return Shared
