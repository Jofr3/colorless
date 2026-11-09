-- How far Settings' Interface Size grows the online lobby (UI-FU2). main.lua lays the lobby out in
-- the canvas divided by the largest step whose canvas holds the current step's minimum, and
-- online.lua takes its compact arrangement in any landscape canvas under 1280x800. The minimum
-- is the step's compact frame with room round it: the menu and waiting cards (500 tall), joining
-- and the info steps fit 853x533, so 150%; versus, the countdown, the deck picker and the set
-- match after them need 640 tall for your seat's deck preview and two rows of piles, so 125%.
local LobbySize={}
local minimums={menu={812,532},waiting={812,532},joining={812,452},info={812,472},seated={812,640}}
-- The width and height for the lobby's `step` (the deck picker opens on versus).
function LobbySize.minimum(step)
  local seated=step=='versus' or step=='countdown' or step=='starting'
  local m=seated and minimums.seated or minimums[step] or minimums.info
  return m[1],m[2]
end
return LobbySize
