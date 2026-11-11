-- Game:draw's CRT settings, using globals.lua defaults (CRT 70, bloom 1).
-- The shader itself is copied unchanged from Balatro by build.mjs; Screen.source patches it at load.
local Screen = {}
Screen.__index = Screen

-- The canvas renders at the device pixel ratio, and CRT.fs measures two things in drawable
-- pixels that must stay the same size in CSS pixels: the RGB fringe's offset (0.8 px) and the
-- vertex pass's distance from the screen centre. Both are divided by pixel_density, which is 1
-- at one device pixel per CSS pixel, where they compute exactly Balatro's values. A source
-- without them comes back unchanged, and Screen then sends no pixel_density.
local FRINGE='1600./love_ScreenSize.x'
local CENTRE='vertex_position.xy/screen_scale - 0.5*love_ScreenSize.xy)'
local DECLARE='extern MY_HIGHP_OR_MEDIUMP number scanlines;'
local function literal(text) return (text:gsub('%p','%%%0')) end
function Screen.source(code)
  local patched,fringes=code:gsub(literal(FRINGE),'1600.*pixel_density/love_ScreenSize.x')
  local centres,declared
  patched,centres=patched:gsub(literal(CENTRE),'vertex_position.xy/screen_scale - 0.5*love_ScreenSize.xy/pixel_density)')
  patched,declared=patched:gsub(literal(DECLARE),'%0\nextern MY_HIGHP_OR_MEDIUMP number pixel_density;')
  if fringes~=2 or centres~=1 or declared~=1 then return code end
  return patched
end

-- Game:init_window + love.resize: 20x11.5 room, 1/0.7 tiles of padding.
-- This is the game's viewport scale, independent of our responsive UI layout.
function Screen.unit(w,h) return math.min(w/22,h/12.9) end

-- Below this many CSS pixels per layout pixel the scanlines follow the layout.
Screen.SMALL_LAYOUT=0.6
-- Writes the CRT uniforms into `values`, reusing its tables; returns it. `density`: device pixels
-- per CSS pixel; the scanline count follows the CSS height. `layoutScale`: CSS pixels per layout
-- pixel; on a layout drawn smaller than SMALL_LAYOUT (a phone held sideways) the count follows
-- the layout's height instead, so scanlines keep the size they have against the text at
-- 1280x800 rather than cutting through the rows of small glyphs.
function Screen.fill(values,height,unit,time,mx,my,reduced,preferences,density,layoutScale)
  local crt=(preferences and preferences.crt or 70)*0.3/100
  local distortion,scale,mouse=values.distortion_fac or {},values.scale_fac or {},values.mouse_screen_pos or {}
  distortion[1],distortion[2]=1+0.07*crt,1+0.1*crt
  scale[1],scale[2]=1-0.008*crt,1-0.008*crt
  mouse[1],mouse[2]=mx,my
  values.distortion_fac,values.scale_fac,values.mouse_screen_pos=distortion,scale,mouse
  values.feather_fac=0.01;values.bloom_fac=preferences and preferences.bloom or 0;values.glitch_intensity=0
  values.time=400+(reduced and 12 or time);values.noise_fac=reduced and 0 or 0.001*crt
  values.crt_intensity=0.16*crt;values.scanlines=height/(density or 1)*0.75
  if layoutScale and layoutScale<Screen.SMALL_LAYOUT then values.scanlines=values.scanlines/layoutScale end
  values.screen_scale=unit;values.hovering=reduced and 0 or 1
  return values
end
function Screen.values(height,unit,time,mx,my,reduced,preferences,density,layoutScale)
  return Screen.fill({},height,unit,time,mx,my,reduced,preferences,density,layoutScale)
end

-- `w`, `h` and `unit` in drawable pixels; `density`, device pixels per CSS pixel (default 1);
-- `layoutScale`, CSS pixels per layout pixel (default 1).
function Screen.new(shader,w,h,unit,density,layoutScale)
  local self=setmetatable({shader=shader,w=w,h=h,unit=unit,density=density or 1,layoutScale=layoutScale,values={},projected={}},Screen)
  -- Only a shader patched by Screen.source divides by pixel_density.
  self.patched=shader.hasUniform~=nil and shader:hasUniform('pixel_density')
  -- LÖVE Canvas vertices: TL, BL, TR, BR; indices 0,1,2,2,1,3.
  -- Verified against the running original love.js build's GPU buffers.
  self.vertices={{0,0,0,0},{0,h,0,1},{w,0,1,0},{w,h,1,1}}
  for i=1,4 do self.projected[i]={} end
  self:update(12,w/2,h/2,false)
  return self
end

-- Refills values and projected in place: an idle frame makes no garbage.
function Screen:update(time,mx,my,reduced,preferences)
  local values=Screen.fill(self.values,self.h,self.unit,time,mx,my,reduced,preferences,self.density,self.layoutScale)
  -- Everything but time and the mouse follows CRT, bloom and reduced motion (and this Screen's
  -- size); draw sends it all again only when one of them changes.
  if values.crt_intensity~=self.sentCrt or values.bloom_fac~=self.sentBloom or values.hovering~=self.sentHovering then
    self.sentCrt,self.sentBloom,self.sentHovering=values.crt_intensity,values.bloom_fac,values.hovering
    self.sendAll=true
  end
  for i,v in ipairs(self.vertices) do
    -- CRT.fs position(): reproduce its clip-space W for input mapping.
    local centre=self.patched and 2*self.density or 2
    local dx,dy=v[1]/self.unit-self.w/centre,v[2]/self.unit-self.h/centre
    local mid=self.unit*math.sqrt(dx*dx+dy*dy)/math.sqrt(self.w*self.w+self.h*self.h)
    local ox,oy=(v[1]-mx)/self.unit,(v[2]-my)/self.unit
    local weight=1+0.002*(-0.03-0.3*math.max(0,0.3-mid))*values.hovering*(ox*ox+oy*oy)/(2-mid)
    local p=self.projected[i]
    p.x,p.y=self.w/2+(v[1]-self.w/2)/weight,self.h/2+(v[2]-self.h/2)/weight
    p.u,p.v,p.q=v[3],v[4],1/weight
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
  local shader,values=self.shader,self.values
  if self.sendAll then
    for key,value in pairs(values) do shader:send(key,value) end
    if self.patched then shader:send('pixel_density',self.density) end
    self.sendAll=false
  else
    shader:send('time',values.time);shader:send('mouse_screen_pos',values.mouse_screen_pos)
  end
  g.clear(0,0,0,1)
  g.setShader(shader); g.setColor(1,1,1); g.draw(scene,0,0); g.setShader()
end

return Screen
