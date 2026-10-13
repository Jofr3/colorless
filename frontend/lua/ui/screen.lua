-- Game:draw's CRT settings, using globals.lua defaults (CRT 70, bloom 1).
-- The shader itself is copied unchanged from Balatro by build.mjs.
local Screen = {}
Screen.__index = Screen

-- Game:init_window + love.resize: 20x11.5 room, 1/0.7 tiles of padding.
-- This is the game's viewport scale, independent of our responsive UI layout.
function Screen.unit(w,h) return math.min(w/22,h/12.9) end

function Screen.values(height,unit,time,mx,my,reduced,preferences)
  local crt=(preferences and preferences.crt or 70)*0.3/100
  return {
    distortion_fac={1+0.07*crt,1+0.1*crt},
    scale_fac={1-0.008*crt,1-0.008*crt},
    feather_fac=0.01,bloom_fac=preferences and preferences.bloom or 0,glitch_intensity=0,
    time=400+(reduced and 12 or time),noise_fac=reduced and 0 or 0.001*crt,
    crt_intensity=0.16*crt,scanlines=height*0.75,
    mouse_screen_pos={mx,my},screen_scale=unit,hovering=reduced and 0 or 1,
  }
end

function Screen.new(shader,w,h,unit)
  local self=setmetatable({shader=shader,w=w,h=h,unit=unit},Screen)
  -- LÖVE Canvas vertices: TL, BL, TR, BR; indices 0,1,2,2,1,3.
  -- Verified against the running original love.js build's GPU buffers.
  self.vertices={{0,0,0,0},{0,h,0,1},{w,0,1,0},{w,h,1,1}}
  self:update(12,w/2,h/2,false)
  return self
end

function Screen:update(time,mx,my,reduced,preferences)
  self.values=Screen.values(self.h,self.unit,time,mx,my,reduced,preferences)
  self.projected={}
  for i,v in ipairs(self.vertices) do
    -- CRT.fs position(): reproduce its clip-space W for input mapping.
    local dx,dy=v[1]/self.unit-self.w/2,v[2]/self.unit-self.h/2
    local mid=self.unit*math.sqrt(dx*dx+dy*dy)/math.sqrt(self.w*self.w+self.h*self.h)
    local ox,oy=(v[1]-mx)/self.unit,(v[2]-my)/self.unit
    local weight=1+0.002*(-0.03-0.3*math.max(0,0.3-mid))*self.values.hovering*(ox*ox+oy*oy)/(2-mid)
    self.projected[i]={x=self.w/2+(v[1]-self.w/2)/weight,
      y=self.h/2+(v[2]-self.h/2)/weight,u=v[3],v=v[4],q=1/weight}
  end
end

local function texturePoint(x,y,a,b,c)
  local d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y)
  local l=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/d
  local m=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/d
  local n=1-l-m
  if l < -1e-8 or m < -1e-8 or n < -1e-8 then return end
  local q=l*a.q+m*b.q+n*c.q
  return (l*a.u*a.q+m*b.u*b.q+n*c.u*c.q)/q,
    (l*a.v*a.q+m*b.v*b.q+n*c.v*c.q)/q
end

function Screen:unproject(x,y)
  local p=self.projected
  local u,v=texturePoint(x,y,p[1],p[2],p[3])
  if not u then u,v=texturePoint(x,y,p[3],p[2],p[4]) end
  if not u then return -math.huge,-math.huge end
  -- CRT.fs effect(): screen UV -> lens-distorted scene texture coordinates.
  local values=self.values
  local tx,ty=(2*u-1)*values.scale_fac[1],(2*v-1)*values.scale_fac[2]
  return (tx+ty*ty*tx*(values.distortion_fac[1]-1)+1)*self.w/2,
    (ty+tx*tx*ty*(values.distortion_fac[2]-1)+1)*self.h/2
end

function Screen:draw(scene)
  local g=love.graphics
  for key,value in pairs(self.values) do self.shader:send(key,value) end
  g.clear(0,0,0,1)
  g.setShader(self.shader); g.setColor(1,1,1); g.draw(scene,0,0); g.setShader()
end

return Screen
