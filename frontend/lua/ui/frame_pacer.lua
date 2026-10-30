-- Decides which animation frames run update and draw, so the app runs at most `cap` frames a
-- second whatever the display's refresh rate (main.lua's love.run asks on every frame and pumps
-- events either way). Time owed since the last run frame is paid one cap interval per run; a
-- frame runs once it is nearer the next due time than the frame after it would be (half a
-- frame early), so a display at the cap, or a little faster, or a jittery one runs every frame,
-- and a faster one runs the frames closest to the cap's own beat.
local Pacer={}
Pacer.__index=Pacer
-- The most a run may leave owed, in cap intervals. Early: a run that came early never makes the
-- next one wait more than a quarter interval longer. Late: less than the half frame a display
-- at twice the cap runs early by, so a display a hair slower than that (119.88 Hz under 60) keeps
-- running every other frame instead of slipping an extra one in every few seconds, and a stall
-- (a hidden tab, a slow frame) is dropped rather than paid back with a burst of frames.
local EARLY_CARRY,LATE_CARRY=0.25,0.2
function Pacer.new() return setmetatable({owed=0},Pacer) end
-- `elapsed`: seconds since the previous animation frame. True when this frame runs.
function Pacer:due(elapsed,cap)
  local interval=1/cap
  -- A smoothed frame length, so one late frame does not move the half-frame margin much.
  self.frame=self.frame and self.frame*0.9+elapsed*0.1 or elapsed
  self.owed=self.owed+elapsed
  if self.owed+math.min(self.frame,interval)/2<interval then return false end
  self.owed=self.owed-interval
  if self.owed<-interval*EARLY_CARRY then self.owed=-interval*EARLY_CARRY
  elseif self.owed>interval*LATE_CARRY then self.owed=interval*LATE_CARRY end
  return true
end
return Pacer
