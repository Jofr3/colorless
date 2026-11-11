-- Compare uniforms with Game:draw itself, then check pointer coordinates against
-- perspective interpolation and the source shader's lens sampling equations.
package.path='frontend/lua/?.lua;'..package.path
love={graphics={setShader=function() end}}
local Screen=require('ui.screen')
local source=require('tests.support.balatro_source').required()
local file=assert(io.open(source..'/game.lua'))
local game=file:read('*a'); file:close()
local block=assert(game:match('(G%.SETTINGS%.GRAPHICS%.crt = G%.SETTINGS%.GRAPHICS%.crt%*0%.3.-G%.SETTINGS%.GRAPHICS%.crt = G%.SETTINGS%.GRAPHICS%.crt/0%.3)'))
local original=assert(loadstring(block))
local mainFile=assert(io.open(source..'/main.lua'))
local main=mainFile:read('*a'); mainFile:close()
assert(loadstring(assert(main:match('(function love.resize%(w, h%).-\nend)'))))()
love.system={getOS=function() return 'Linux' end}
love.graphics.newCanvas=function() return {setFilter=function() end} end
local checks=0
local function near(a,b)
  assert(math.abs(a-b)<1e-8,tostring(a)..' != '..tostring(b))
  checks=checks+1
end
for _,viewport in ipairs({{1280,800,60},{390,844,48.75},{1600,900,67.5}}) do
  local w,h=unpack(viewport)
  G={TILE_W=20,TILE_H=11.5,TILESIZE=20,ROOM_PADDING_W=1,ROOM_PADDING_H=0.7,
    window_prev={orig_scale=3.65,w=22*20*3.65,h=12.9*20*3.65,orig_ratio=22/12.9}}
  love.resize(w,h)
  local unit=Screen.unit(w,h)
  near(unit,G.TILESCALE*G.TILESIZE)
  local screen=Screen.new({},w,h,unit)
  for index,mouse in ipairs({{0,0},{w/2,h/2},{w,h}}) do
    local preferences=({{crt=0,bloom=0},{crt=70,bloom=0},{crt=100,bloom=1}})[index]
    local expected={}
    G={SETTINGS={GRAPHICS={crt=preferences.crt,bloom=preferences.bloom+1}},SHADERS={CRT={send=function(_,key,value) expected[key]=value end}},
      TIMERS={REAL=17.25},CANVAS={getPixelHeight=function() return h end},CANV_SCALE=1,
      ARGS={eased_cursor_pos={sx=mouse[1],sy=mouse[2]}},TILESCALE=unit/20,TILESIZE=20}
    original()
    local actual=Screen.values(h,unit,17.25,mouse[1],mouse[2],false,preferences)
    for key,value in pairs(expected) do
      if type(value)=='table' then
        for i,v in ipairs(value) do near(actual[key][i],v) end
      else near(actual[key],value) end
    end
    near(G.SETTINGS.GRAPHICS.crt,preferences.crt)
    for _,reduced in ipairs({false,true}) do
      screen:update(17.25,mouse[1],mouse[2],reduced,preferences)
      for _,triangle in ipairs({{1,2,3},{3,2,4}}) do
        for _,weights in ipairs({{0.2,0.3,0.5},{0.8,0.1,0.1},{0.01,0.98,0.01},{1/3,1/3,1/3}}) do
          local u,v,clipW=0,0,0
          for i,index in ipairs(triangle) do
            local p=screen.projected[index]
            u,v,clipW=u+weights[i]*p.u,v+weights[i]*p.v,clipW+weights[i]/p.q
          end
          local px,py=w/2+(u*w-w/2)/clipW,h/2+(v*h-h/2)/clipW
          local x,y=screen:unproject(px,py)
          local tx,ty=(u*2-1)*expected.scale_fac[1],(v*2-1)*expected.scale_fac[2]
          near(x,(tx+ty*ty*tx*(expected.distortion_fac[1]-1)+1)*w/2)
          near(y,(ty+tx*tx*ty*(expected.distortion_fac[2]-1)+1)*h/2)
        end
      end
      if reduced then
        near(screen.values.hovering,0); near(screen.values.noise_fac,0); near(screen.values.time,412)
      end
    end
    local x,y=screen:unproject(-10,-10)
    assert(x==-math.huge and y==-math.huge,'Outside screen must not hit UI')
  end
end

-- A canvas at the device pixel ratio: Balatro's CRT.fs, patched at load, measures its fringe and
-- centre distance in CSS pixels, so at density d every corner, every pointer mapping and the
-- scanline count are density 1's scaled by d.
local shaderFile=assert(io.open(source..'/resources/shaders/CRT.fs','rb'))
local code=shaderFile:read('*a'); shaderFile:close()
local patched=Screen.source(code)
local _,densities=patched:gsub('pixel_density','')
assert(densities==4,'The fringe twice, the centre and the declaration use pixel_density ('..densities..')')
assert(patched:gsub('pixel_density',''):len()<code:len()+40,'Nothing else changes')
assert(Screen.source('void main() {}')=='void main() {}','A source without the fringe comes back unchanged')
local patchedShader={hasUniform=function(_,name) return name=='pixel_density' end}
for _,viewport in ipairs({{1280,800},{390,844},{844,390}}) do
  local w,h=unpack(viewport)
  local unit=Screen.unit(w,h)
  local css=Screen.new(patchedShader,w,h,unit,1)
  for _,density in ipairs({1.25,1.5,2,3}) do
    local dw,dh=w*density,h*density
    near(Screen.unit(dw,dh),unit*density)
    local device=Screen.new(patchedShader,dw,dh,Screen.unit(dw,dh),density)
    near(Screen.values(dh,unit*density,12,0,0,false,nil,density).scanlines,h*0.75)
    for _,mouse in ipairs({{0,0},{w/2,h/2},{w*0.8,h*0.3}}) do
      css:update(17.25,mouse[1],mouse[2],false,{crt=70,bloom=0})
      device:update(17.25,mouse[1]*density,mouse[2]*density,false,{crt=70,bloom=0})
      for i=1,4 do
        local a,b=css.projected[i],device.projected[i]
        near(b.x,a.x*density); near(b.y,a.y*density); near(b.q,a.q)
      end
      for _,point in ipairs({{w*0.1,h*0.1},{w/2,h/2},{w*0.93,h*0.71}}) do
        local x,y=css:unproject(point[1],point[2])
        local dx,dy=device:unproject(point[1]*density,point[2]*density)
        near(dx,x*density); near(dy,y*density)
      end
    end
  end
end
print('PASS: '..checks..' source CRT uniform and distorted pointer comparisons, the same in CSS pixels at DPR 1.25-3')
