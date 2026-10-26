-- Table juice: ui/fx.lua's attention texts and sequencer, plus
-- ease_background_colour's three-colour ramp for background.fs.
local Base=require('ui.fx')
local Fx=setmetatable({},{__index=Base});Fx.__index=Fx
local function mix(a,b,t) return {a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t,1} end
function Fx.new(callbacks)
  local self=setmetatable(Base.new(callbacks),Fx)
  self:background('setup',true)
  return self
end
-- Background palettes: ease_background_colour(new_colour, special, tertiary).
-- Your turn uses the Small Blind green; the opponent's turn the won/grey blue;
-- game over fades to the boss red or the win blue.
local palettes={
  setup={base={80/255,132/255,110/255,1},contrast=1},
  you={base={80/255,132/255,110/255,1},contrast=1},
  opponent={base={79/255,99/255,103/255,1},contrast=1},
  loss={base={180/255,68/255,48/255,1},contrast=2,special={55/255,66/255,68/255,1}},
  win={base={0,157/255,1,1},contrast=2,special={55/255,66/255,68/255,1}},
}
function Fx:background(kind,instant)
  local p=palettes[kind] or palettes.you
  local target={
    mix(p.base,p.base,1),
    p.special and p.special or {p.base[1]*0.9,p.base[2]*0.9,p.base[3]*0.9,1},
    {p.base[1]*(p.special and 0.4 or 0.7),p.base[2]*(p.special and 0.4 or 0.7),p.base[3]*(p.special and 0.4 or 0.7),1},
    contrast=p.contrast,
  }
  target[1]={p.base[1]*1.3,p.base[2]*1.3,p.base[3]*1.3,1}
  self.bgTarget=target
  if instant or not self.bg then self.bg={mix(target[1],target[1],1),mix(target[2],target[2],1),mix(target[3],target[3],1),contrast=target.contrast} end
  self.bgKind=kind
end
function Fx:colours() return self.bg end
function Fx:update(dt,time,reduced,paused)
  Base.update(self,dt,time,reduced,paused)
  -- Background easing (ease_value over ~0.6s).
  if self.bg and self.bgTarget then
    local k=math.min(1,dt/0.6*1.6)
    for c=1,3 do for ch=1,3 do self.bg[c][ch]=self.bg[c][ch]+(self.bgTarget[c][ch]-self.bg[c][ch])*k end end
    self.bg.contrast=self.bg.contrast+(self.bgTarget.contrast-self.bg.contrast)*k
  end
end
return Fx
