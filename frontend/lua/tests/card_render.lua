-- Checks the LÖVE draw contract without a GPU: the screen-space inputs and the
-- shared geometry of each card layer. Catches the original resize/tilt mismatch.
package.path='frontend/lua/?.lua;'..package.path
local transform={scale=1,x=0,y=0}
local draws,activeShader={},nil
love={graphics={
  transformPoint=function(x,y) return x*transform.scale+transform.x,y*transform.scale+transform.y end,
  setShader=function(shader) activeShader=shader end,
  setColor=function() end,
  draw=function(_,x,y,r,sx,sy)
    local uniforms={}
    for key,value in pairs(activeShader and activeShader.values or {}) do uniforms[key]=value end
    draws[#draws+1]={x=x,y=y,r=r,sx=sx,sy=sy,uniforms=uniforms}
  end,
}}
local Card=require('ui.card')
local function near(a,b) assert(math.abs(a-b)<1e-9,tostring(a)..' != '..tostring(b)) end
local shaders={}
for _,name in ipairs({'dissolve','foil','holo','polychrome'}) do
  shaders[name]={values={},hasUniform=function() return true end,
    send=function(self,key,value) self.values[key]=value end}
end
local c=setmetatable({index=1,angle=0,ambientTilt=0.2,item={edition='foil'}},Card)
c:place(310,437,1.36,false)
c.hovered=true
for _,viewport in ipairs({{1,0,0},{0.72,179,0},{0.8125,0,76.7},{1.25,0,0}}) do
  transform.scale,transform.x,transform.y=unpack(viewport)
  for _,cursor in ipairs({{240,330},{380,330},{240,540},{380,540},{310,437}}) do
    local values,edition=c:shaderValues(20,cursor[1],cursor[2],false)
    near(values.mouse_screen_pos[1],cursor[1]*transform.scale+transform.x)
    near(values.mouse_screen_pos[2],cursor[2]*transform.scale+transform.y)
    near(values.screen_scale,c.unit*transform.scale)
    -- Normalized cursor-to-card offset must not change with screen size.
    near((values.mouse_screen_pos[1]-(c.x*transform.scale+transform.x))/values.screen_scale,
      (cursor[1]-c.x)/c.unit)
    near(values.hovering,1)
    near(edition[2],20)
  end
end
c.hovered=false
local idle=c:shaderValues(20,0,0,false)
near(idle.hovering,1) -- Balatro deforms cards even when not hovered.
near(c:shaderValues(20,0,0,true).hovering,0)
for _,edition in ipairs({'dissolve','foil','holo','polychrome'}) do
  c.item.edition=edition; draws={}
  c:draw(shaders,20,310,437,false,1280)
  assert(#draws==(edition=='dissolve' and 2 or 3))
  assert(draws[1].uniforms.shadow and draws[1].uniforms.hovering==0)
  assert(not draws[2].uniforms.shadow and draws[2].uniforms.hovering==1)
  if draws[3] then
    for _,key in ipairs({'x','y','r','sx','sy'}) do near(draws[2][key],draws[3][key]) end
    near(draws[2].uniforms.screen_scale,draws[3].uniforms.screen_scale)
    for i=1,2 do near(draws[2].uniforms.mouse_screen_pos[i],draws[3].uniforms.mouse_screen_pos[i]) end
  end
end
print('PASS: corner/centre cursor transforms at four viewport scales; idle/reduced tilt; all edition/shadow passes')
c:place(310,437,1.36,false)
c.hovered=false
local edge=c.x+142*c.baseScale/2
assert(c:hit(edge-0.01,c.y))
assert(not c:hit(edge+0.01,c.y))
c.hovered=true
assert(c:hit(edge+0.04*c.unit,c.y))
assert(not c:hit(edge+0.06*c.unit,c.y))
c.motion.VT.scale=0.95
assert(c:hit(edge,c.y)) -- Hover's initial squash must not repeatedly retrigger entry.
print('PASS: original hover hysteresis and zoom-independent hit bounds')
