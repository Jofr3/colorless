-- Checks the LÖVE draw contract without a GPU: the screen-space inputs and the
-- shared geometry of each card layer. Catches the original resize/tilt mismatch.
package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
local transform={scale=1,x=0,y=0}
local draws,activeShader={},nil
love={graphics={
  transformPoint=function(x,y) return x*transform.scale+transform.x,y*transform.scale+transform.y end,
  setShader=function(shader) activeShader=shader end,
  setColor=function() end,
  draw=function(_,x,y,r,sx,sy)
    local uniforms={}
    for key,value in pairs(activeShader and activeShader.values or {}) do uniforms[key]=value end
    draws[#draws+1]={x=x,y=y,r=r,sx=sx,sy=sy,uniforms=uniforms,shader=activeShader}
  end,
}}
local Card=require('ui.card')
local function near(a,b) assert(math.abs(a-b)<1e-9,tostring(a)..' != '..tostring(b)) end
local shaders={}
for _,name in ipairs({'dissolve','played','foil','holo','polychrome'}) do
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
-- An edition with no compiled shader (or none at all) draws the ordinary face alone.
for _,edition in ipairs({'negative',false}) do
  c.item.edition=edition or nil; draws={}
  local ok,err=pcall(c.draw,c,shaders,20,310,437,false,1280)
  assert(ok,tostring(err))
  assert(#draws==2 and draws[2].shader==shaders.dissolve,'A missing edition shader falls back to the ordinary face')
end
print('PASS: a missing edition shader falls back to the ordinary face')
-- The greyed effect replaces the face and suppresses shadows, using the same
-- geometry/uniforms so transparency follows the tilted card's actual pixels.
c.item.edition='dissolve';draws={}
c:draw(shaders,20,310,437,false,1280)
local normal=draws[2]
c.greyed=true;draws={}
c:draw(shaders,20,310,437,false,1280)
assert(#draws==1 and draws[1].shader==shaders.played,'Greyed cards use one played shader pass')
assert(not draws[1].uniforms.shadow and draws[1].uniforms.hovering==1)
for _,key in ipairs({'x','y','r','sx','sy'}) do near(draws[1][key],normal[key]) end
near(draws[1].uniforms.played[2],20)
draws={};c:draw(shaders,20,310,437,true,1280)
assert(draws[1].uniforms.hovering==0,'Greyed cards respect reduced motion')
c.greyed=false;draws={};c:draw(shaders,20,310,437,false,1280)
assert(#draws==2 and draws[2].shader==shaders.dissolve,'Available cards restore their normal face and shadow')
print('PASS: Balatro greyed-card pass, shared geometry, reduced motion and availability restore')
c:place(310,437,1.36,false)
c.hovered=false
local edge=c.x+D.W*c.baseScale/2
assert(c:hit(edge-0.01,c.y))
assert(not c:hit(edge+0.01,c.y))
c.hovered=true
assert(c:hit(edge+0.04*c.unit,c.y))
assert(not c:hit(edge+0.06*c.unit,c.y))
c.motion.VT.scale=0.95
assert(c:hit(edge,c.y)) -- Hover's initial squash must not repeatedly retrigger entry.
print('PASS: original hover hysteresis and zoom-independent hit bounds')

-- Exercise texture creation through the final draw, so a second stretch in
-- either the frame or tile-space renderer cannot reintroduce uneven padding.
local Frame=require('ui.card_frame')
local g=love.graphics
local bake,stack={sx=1,sy=1,x=0,y=0},{}
g.push=function() stack[#stack+1]={sx=bake.sx,sy=bake.sy,x=bake.x,y=bake.y} end
g.pop=function() bake=table.remove(stack) end
g.scale=function(x,y) bake.sx,bake.sy=bake.sx*x,bake.sy*(y or x) end
g.translate=function(x,y) bake.x,bake.y=bake.x+x*bake.sx,bake.y+y*bake.sy end
g.setBlendMode=function() end
g.rectangle=function() end
g.setCanvas=function() end
g.clear=function() end
g.newCanvas=function(w,h) return {w=w,h=h,setFilter=function() end,release=function() end} end
for _,resolution in ipairs({1,2}) do
  local art
  local card=Card.new({resolution=resolution,edition='dissolve',drawFace=function(w,h)
    Frame.draw(w,h,function(aw,ah)
      art={x=bake.x,y=bake.y,w=aw*bake.sx,h=ah*bake.sy}
    end)
  end},1)
  near(art.w/art.h,600/825)
  for _,scale in ipairs({0.135,0.74,1.6}) do
    card:place(310,437,scale,false)
    draws={};card:draw(shaders,20,0,0,true,1280)
    local face=draws[2]
    near(face.sx,face.sy)
    local left,top=art.x*face.sx,art.y*face.sy
    local right=(card.texture.w-art.x-art.w)*face.sx
    local bottom=(card.texture.h-art.y-art.h)*face.sy
    near(left,0);near(top,0);near(right,0);near(bottom,0)
    near(card.texture.w*face.sx,D.W*scale)
    near(card.texture.h*face.sy,D.H*scale)
  end
end
print('PASS: original scan proportions, the scan filling the card edge to edge and uniform rendering at both texture resolutions and three display scales')

-- Border gradients must remain local: a silver card can have different
-- colours at the top, bottom and either side. Ignore interior art/corners.
local decodes,releases=0,0
local rims={yellow={1,0.82,0.05},dark={0.08,0.09,0.1}}
love.filesystem={getInfo=function(path) return path~='missing' end}
love.image={newImageData=function(path)
  decodes=decodes+1
  if path=='broken' then error('Invalid image') end
  return {
    getDimensions=function() return 256,352 end,
    getPixel=function(_,x,y)
      if path=='transparent' or (x<20 and y<20) then return 1,1,1,0 end
      if x<6 or x>249 or y<8 or y>343 then
        if path=='silver' then
          local c=0.9-0.5*y/351
          if x>249 then c=c*0.8 end
          return c,c,c,1
        end
        local rim=rims[path]
        return rim[1],rim[2],rim[3],1
      end
      return 1,0,0,1 -- bright interior must not influence the edge
    end,
    release=function() releases=releases+1 end,
  }
end}
for _,name in ipairs({'yellow','dark'}) do
  local border=Frame.border(name)
  for _,side in ipairs({'top','bottom','left','right'}) do
    for _,colour in ipairs(border[side]) do
      for i=1,3 do near(colour[i],rims[name][i]) end
    end
  end
  local count=decodes
  assert(Frame.border(name)==border and decodes==count,'Reuse cached profile')
end
local silver=Frame.border('silver')
assert(silver.top[64][1]>silver.bottom[64][1]+0.4,'Keep the top-to-bottom gradient')
assert(silver.left[88][1]>silver.right[88][1]+0.1,'Sample the sides independently')
assert(silver.left[30][1]>silver.left[145][1]+0.2,'Keep changes along each side')
local painted,current={},nil
g.setColor=function(r,g,b,a) current={r,g,b,a or 1} end
g.rectangle=function(_,x,y,w,h) painted[#painted+1]={x=x,y=y,w=w,h=h,c=current} end
Frame.draw(D.W,D.H,function() end,silver)
local sideSeen,topSeen=false,false
for _,rect in ipairs(painted) do
  if rect.x==0 and rect.y==90 then near(rect.c[1],silver.left[90-D.INSET+1][1]);sideSeen=true end
  if rect.x==68 and rect.y==0 then near(rect.c[1],silver.top[68-D.INSET+1][1]);topSeen=true end
end
assert(sideSeen and topSeen,'Draw the local profiles on their corresponding edges')
-- The wrapper bounds must be opaque along all four straight sides.
local pixels={}
for _,rect in ipairs(painted) do
  for y=rect.y,rect.y+rect.h-1 do
    for x=rect.x,rect.x+rect.w-1 do pixels[x..':'..y]=rect.c[4] end
  end
end
for x=3,D.W-4 do
  assert(pixels[x..':0']==1 and pixels[x..':'..(D.H-1)]==1,'Top/bottom touch wrapper')
end
for y=3,D.H-4 do
  assert(pixels['0:'..y]==1 and pixels[(D.W-1)..':'..y]==1,'Left/right touch wrapper')
end
local afterArt,cuts=false,{}
local blend
g.setBlendMode=function(mode) blend=mode end
g.rectangle=function(_,x,y,w,h)
  if afterArt then
    for py=y,y+h-1 do
      for px=x,x+w-1 do
        cuts[px..':'..py]={alpha=current[4],blend=blend}
      end
    end
  end
end
Frame.draw(D.W,D.H,function() afterArt=true end,silver)
for _,corner in ipairs({{0,0,1,1},{D.W-1,0,-1,1},{0,D.H-1,1,-1},{D.W-1,D.H-1,-1,-1}}) do
  local x,y,dx,dy=unpack(corner)
  local function pixel(px,py) return cuts[(x+px*dx)..':'..(y+py*dy)] end
  for _,p in ipairs({{1,0},{2,0},{0,2}}) do
    local cut=pixel(unpack(p))
    assert(cut and cut.alpha==0 and cut.blend=='replace','Match Balatro corner alpha')
  end
  for _,p in ipairs({{1,1},{2,1},{1,2}}) do
    local rim=pixel(unpack(p))
    assert(rim and rim.alpha==1,'Keep whole opaque rim pixels inside the steps')
  end
  for _,p in ipairs({{3,1},{2,2},{1,3}}) do
    assert(not pixel(unpack(p)),'Preserve artwork inside the corner steps')
  end
end
print('PASS: Balatro corner alpha and stepped inner rim at all four corners')
assert(releases==3,'Decoded scan pixels must be released')
local fallback={0.2,0.3,0.4}
for _,path in ipairs({'missing','broken','transparent'}) do
  assert(Frame.border(path,fallback)==fallback,'Missing profile uses the face stock')
end
assert(Frame.border(nil,fallback)==fallback)
print('PASS: yellow/dark rims and local silver gradients; interior/corner rejection; cached profiles, released pixels and fallbacks')
