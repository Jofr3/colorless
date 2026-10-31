-- Helpers that more than one part of the table uses (ui/simulator.lua and its sim_* mixins).
local Shared={}
function Shared.popupOffset(popup)
  return popup and popup.motion.VT.y*popup.travel or 0
end
return Shared
