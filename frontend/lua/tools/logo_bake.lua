-- Authoring-only renderer. The menu loads its exported PNG directly; GPU
-- readback and mask cleanup must never be required during game startup.
local g=love.graphics
local Mask=require('ui.logo_mask')
local Shapes=require('tools.logo_shapes')
local Logo={}
-- Add a small tapered serif after cleanup so its intentional one-pixel apex
-- is not mistaken for an extraction spur. Existing strokes remain intact.
local function addPoint(mask,w,a,b,c)
  local function cross(p,q,x,y) return (q[1]-p[1])*(y-p[2])-(q[2]-p[2])*(x-p[1]) end
  for y=math.min(a[2],b[2],c[2]),math.max(a[2],b[2],c[2]) do
    for x=math.min(a[1],b[1],c[1]),math.max(a[1],b[1],c[1]) do
      local ab,bc,ca=cross(a,b,x,y),cross(b,c,x,y),cross(c,a,x,y)
      if (ab>=0 and bc>=0 and ca>=0) or (ab<=0 and bc<=0 and ca<=0) then mask[y*w+x+1]=true end
    end
  end
end
-- Local contour repairs on the approved 1024px authoring grid. Control points
-- follow intact parts of each edge; reflection paint must not define geometry.
local function repairContour(mask,w,points,side,lo,hi)
  for i=1,#points-1 do
    local a,b=points[i],points[i+1]
    for t=a[1],b[1] do
      local limit=math.floor(a[2]+(b[2]-a[2])*(t-a[1])/(b[1]-a[1])+0.5)
      -- A left-edge correction must not paint past the existing right edge
      -- where a narrow diagonal stroke ends inside this repair rectangle.
      local right=hi
      if side=='left' then
        right=lo-1
        for n=lo,hi do if mask[t*w+n+1] then right=n end end
      end
      for n=lo,hi do
        local x,y=t,n
        local solid=n<=limit
        if side=='left' then x,y=n,t;solid=n>=limit and n<=right end
        mask[y*w+x+1]=solid or nil
      end
    end
  end
end
local colourRepairs={
  {73,109,132,146}, -- C inner curve
  {313,265,343,293},{646,271,674,297}, -- L tips
  {549,199,568,229}, -- R inner leg
  {835,195,861,219},{938,195,965,219}, -- S waists
}
local function needsColourRepair(x,y,r,g,b)
  if x>=104 and x<=128 and y>=111 and y<=128 and r>b*1.05 and g>b*1.03 and b<0.87 then return true end
  local muddyCoral=r>g*1.15 and r>b*1.15 and (r<0.9 or g<0.57 or b<0.57)
  local muddyBlue=b>r*0.98 and b>g*1.04 and b<0.85
  if not (muddyCoral or muddyBlue) then return false end
  for _,box in ipairs(colourRepairs) do
    if x>=box[1] and y>=box[2] and x<=box[3] and y<=box[4] then return true end
  end
  return false
end
local faceShader=[[
vec4 effect(vec4 colour, Image image, vec2 uv, vec2 screen) {
  vec4 p=Texel(image,uv);
  // Keep ivory and pastel reflections, excluding the painted taupe/teal edge.
  bool ivory=min(p.r,min(p.g,p.b))>0.79;
  bool blue=p.b>0.65 && p.g>0.55 && p.b>p.r*0.98 && p.b>p.g*1.04;
  bool coral=p.r>0.78 && p.g>0.35 && p.r>p.g*1.15 && p.r>p.b*1.15;
  return vec4(p.rgb,(ivory || blue || coral) && p.a>0.75 ? 1.0 : 0.0);
}
]]
local edgeShader=[[
extern vec2 pixel;
float mask(Image image, vec2 uv) { return step(0.5,Texel(image,uv).a); }
float expand(Image image, vec2 uv, float r) {
  vec2 d=pixel*r;
  float a=mask(image,uv);
  a=max(a,mask(image,uv+vec2(d.x,0.0)));
  a=max(a,mask(image,uv-vec2(d.x,0.0)));
  a=max(a,mask(image,uv+vec2(0.0,d.y)));
  a=max(a,mask(image,uv-vec2(0.0,d.y)));
  d*=0.7071;
  a=max(a,mask(image,uv+d)); a=max(a,mask(image,uv-d));
  a=max(a,mask(image,uv+vec2(d.x,-d.y)));
  a=max(a,mask(image,uv+vec2(-d.x,d.y)));
  // The eight perimeter samples leave notches around three-pixel-wide tips.
  // Complete the disk locally at the L/E terminals; preserve the approved
  // contour everywhere else. This only fills missing samples, never erodes.
  vec2 p=uv/pixel;
  bool pointedTip=(p.x>=278.0 && p.x<=312.0 && p.y>=48.0 && p.y<=90.0)
    || (p.x>=616.0 && p.x<=650.0 && p.y>=44.0 && p.y<=86.0)
    || (p.x>=738.0 && p.x<=776.0 && p.y>=63.0 && p.y<=104.0)
    || (p.x>=312.0 && p.x<=358.0 && p.y>=266.0 && p.y<=309.0)
    || (p.x>=647.0 && p.x<=689.0 && p.y>=273.0 && p.y<=314.0)
    || (p.x>=747.0 && p.x<=785.0 && p.y>=138.0 && p.y<=179.0);
  if(pointedTip) {
    for(int y=-9;y<=9;y++) for(int x=-9;x<=9;x++) {
      vec2 offset=vec2(float(x),float(y));
      if(dot(offset,offset)<=r*r) a=max(a,mask(image,uv+offset*pixel));
    }
  }
  return a;
}
float edge(Image image, vec2 uv, float radius, float depth) {
  vec2 offset=vec2(-0.28,1.0)*pixel*depth;
  return max(expand(image,uv,radius),max(expand(image,uv-offset*0.5,radius),expand(image,uv-offset,radius)));
}
vec4 effect(vec4 colour, Image image, vec2 uv, vec2 screen) {
  // Short translucent white rim: the original alpha falls from ~100 to 3.
  float halo=edge(image,uv,9.0,12.0)*0.01;
  halo=max(halo,edge(image,uv,8.0,12.0)*0.05);
  halo=max(halo,edge(image,uv,7.0,12.0)*0.12);
  halo=max(halo,edge(image,uv,6.0,12.0)*0.24);
  vec4 p=vec4(1.0,1.0,1.0,halo);
  // Bands sampled from textures/2x/balatro.png, including the lighter stripe
  // INSIDE the grey sidewall. The top edge is thin; depth projects down-left.
  p=mix(p,vec4(49.0/255.0,58.0/255.0,60.0/255.0,1.0),edge(image,uv,4.0,12.0));
  p=mix(p,vec4(67.0/255.0,81.0/255.0,83.0/255.0,1.0),edge(image,uv,4.0,10.0));
  p=mix(p,vec4(91.0/255.0,117.0/255.0,123.0/255.0,1.0),edge(image,uv,6.0,7.0));
  p=mix(p,vec4(79.0/255.0,99.0/255.0,103.0/255.0,1.0),edge(image,uv,4.0,7.0));
  p=mix(p,vec4(203.0/255.0,187.0/255.0,167.0/255.0,1.0),edge(image,uv,1.0,4.0));
  p=mix(p,vec4(230.0/255.0,221.0/255.0,211.0/255.0,1.0),edge(image,uv,0.5,2.0));
  p=mix(p,vec4(1.0),expand(image,uv,0.5));
  vec4 face=Texel(image,uv);
  if(face.a>0.5) p=vec4(face.rgb/max(face.a,0.001),1.0);
  return p*colour;
}
]]
function Logo.new(inspectFace)
  local source=g.newImage('assets/branding/colorless.png')
  source:setFilter('linear','linear')
  local sw,sh=source:getDimensions()
  -- Keep the approved resolution, face colours and bevel dimensions.
  local w,h=1024,math.floor(1024*sh/sw+0.5)
  local face,result=g.newCanvas(w,h),g.newCanvas(w,h)
  local extract,bevel=g.newShader(faceShader),g.newShader(edgeShader)
  local previous=g.getCanvas()
  g.push('all');g.origin();g.setColor(1,1,1)
  g.setBlendMode('alpha','alphamultiply')
  g.setCanvas(face);g.clear(0,0,0,0);g.setShader(extract)
  g.draw(source,0,0,0,w/sw,h/sh)
  g.setCanvas(previous);g.pop()
  local pixels=face:newImageData()
  local mask={}
  for y=0,h-1 do for x=0,w-1 do
    local _,_,_,a=pixels:getPixel(x,y)
    if a>0.5 then mask[y*w+x+1]=true end
  end end
  local clean=Mask.clean(mask,w,h,32)
  clean=Mask.trimSpurs(clean,w,h)
  -- Two source-paint defects are larger than isolated pixels. Reconnect the
  -- C's existing contour on this fixed 1024px authoring grid: the coral fleck
  -- below its base must not extrude, and the upper counter's taupe notch must
  -- not become a tooth in every bevel band. Everything outside these small
  -- spans keeps the extracted outline.
  for x=65,88 do
    local bottom=math.floor(276+(x-64)*5/25)
    for y=bottom+1,290 do clean[y*w+x+1]=nil end
  end
  for x=105,122 do
    local bottom=math.floor(119+(x-104)*5/18)
    for y=110,bottom do clean[y*w+x+1]=true end
  end
  -- Follow-up corrections at the user's marked C shoulder, L tips, R leg
  -- and S waists. Keep all other contours, spacing and bevel widths intact.
  repairContour(clean,w,{{116,60},{122,56},{130,53},{140,51},{146,51}},'left',46,66)
  repairContour(clean,w,{{74,138},{77,133},{82,128},{90,122},{100,119}},'bottom',110,145)
  repairContour(clean,w,{{314,271},{320,274},{326,277},{332,280},{336,281},{339,281},{342,279}},'bottom',263,294)
  repairContour(clean,w,{{647,276},{653,279},{659,282},{665,285},{669,285},{673,282}},'bottom',268,298)
  repairContour(clean,w,{{195,550},{202,553},{211,555},{220,557},{232,559}},'left',545,562)
  repairContour(clean,w,{{190,827},{198,837},{206,846},{214,852},{222,856},{230,860}},'left',820,865)
  repairContour(clean,w,{{190,931},{198,940},{206,948},{214,954},{222,959},{230,963}},'left',924,968)
  -- Subtle pointed terminals: both L tops and feet, plus the E's upper hooks.
  addPoint(clean,w,{284,75},{296,74},{300,61})
  addPoint(clean,w,{624,72},{634,70},{638,56})
  addPoint(clean,w,{326,275},{342,270},{343,289})
  addPoint(clean,w,{658,280},{673,273},{675,294})
  addPoint(clean,w,{747,89},{756,88},{760,75})
  addPoint(clean,w,{759,163},{768,162},{774,149})
  local repaired=love.image.newImageData(w,h,'rgba8')
  repaired:mapPixel(function(x,y)
    if not clean[y*w+x+1] then return 0,0,0,0 end
    local r,gc,b,a=pixels:getPixel(x,y)
    if a>0.5 and not needsColourRepair(x,y,r/a,gc/a,b/a) then return r/a,gc/a,b/a,1 end
    -- Fill extraction pinholes from the nearest valid face colour, keeping
    -- the existing reflection pattern instead of introducing a new palette.
    local best=math.huge
    for dy=-12,12 do for dx=-12,12 do
      local nx,ny=x+dx,y+dy
      local distance=dx*dx+dy*dy
      if nx>=0 and nx<w and ny>=0 and ny<h and distance<best and mask[ny*w+nx+1] and clean[ny*w+nx+1] then
        local nr,ng,nb,na=pixels:getPixel(nx,ny)
        if not needsColourRepair(x,y,nr/na,ng/na,nb/na) then
          r,gc,b,a=nr,ng,nb,na;best=distance
        end
      end
    end end
    assert(best<math.huge,'Repaired face pixel has no nearby colour')
    return r/a,gc/a,b/a,1
  end)
  local shaped=Shapes.refine(repaired)
  if inspectFace then inspectFace(shaped) end
  local cleanFace=g.newImage(shaped)
  cleanFace:setFilter('nearest','nearest')
  pixels:release();repaired:release();shaped:release()
  g.push('all');g.origin();g.setColor(1,1,1)
  g.setBlendMode('alpha','alphamultiply')
  bevel:send('pixel',{1/w,1/h})
  g.setCanvas(result);g.clear(0,0,0,0);g.setShader(bevel)
  g.draw(cleanFace)
  g.setCanvas(previous);g.pop()
  -- Export ordinary straight-alpha PNG pixels, not Canvas premultiplied RGB.
  local readback=result:newImageData()
  -- WebGL's default Canvas can read back as rgba4. Copy normalized values
  -- into rgba8 explicitly: PNG encoders and ordinary textures support it.
  local baked=love.image.newImageData(w,h,'rgba8')
  local visible=0
  baked:mapPixel(function(x,y)
    local r,gc,b,a=readback:getPixel(x,y)
    if a==0 then return 0,0,0,0 end
    if a>0.5 then visible=visible+1 end
    return math.min(r/a,1),math.min(gc/a,1),math.min(b/a,1),a
  end)
  assert(visible>1000,'Refusing to export an empty logo')
  readback:release()
  local texture=g.newImage(baked)
  result:release()
  source:release();face:release();cleanFace:release();extract:release();bevel:release()
  texture:setFilter('linear','linear')
  return texture,baked
end
return Logo
