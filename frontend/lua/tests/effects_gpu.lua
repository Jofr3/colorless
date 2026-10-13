-- Run through tests/build-effects.mjs and love.js in a browser. Compare actual
-- GPU pixels with the unmodified Game:draw CRT block and Canvas draw primitive.
local Screen=require('ui.screen')
local g=love.graphics
local original=assert(love.filesystem.load('reference.lua'))
local cases,index={},0
local shader
function love.errorhandler(message)
  print('GPU ERROR: '..tostring(message))
  print(debug.traceback())
  return function() end
end
function love.load()
  print('GPU START')
  shader=g.newShader('CRT.fs')
  for _,size in ipairs({{320,240},{390,844},{1280,800}}) do
    for _,cursor in ipairs({{0,0},{0.5,0.5},{1,1}}) do
      cases[#cases+1]={w=size[1],h=size[2],mx=size[1]*cursor[1],my=size[2]*cursor[2]}
    end
  end
end
local function compare(c)
  local w,h=c.w,c.h
  local unit=math.min(w/22,h/12.9)
  local scene=g.newCanvas(w,h)
  scene:setFilter('linear','linear')
  g.setCanvas(scene); g.clear(0.12,0.17,0.18,1)
  for y=0,h,17 do
    for x=0,w,19 do
      g.setColor(x/w,y/h,((x+y)%71)/71,1)
      g.rectangle('fill',x,y,15,13)
    end
  end
  g.setColor(1,1,1,1); g.print('BALATRO CRT / 0123456789',w/3,h/2)
  local expected,actual=g.newCanvas(w,h),g.newCanvas(w,h)
  G={SETTINGS={GRAPHICS={crt=70,bloom=1}},SHADERS={CRT=shader},
    TIMERS={REAL=25},CANVAS=scene,CANV_SCALE=1,
    ARGS={eased_cursor_pos={sx=c.mx,sy=c.my}},TILESCALE=unit/20,TILESIZE=20}
  g.setCanvas(expected); g.clear(0,0,0,1); g.setColor(1,1,1,1)
  original(); g.draw(scene,0,0); g.setShader()
  local screen=Screen.new(shader,w,h,unit)
  screen:update(25,c.mx,c.my,false)
  g.setCanvas(actual); screen:draw(scene); g.setCanvas()
  local a,b=expected:newImageData(),actual:newImageData()
  local sa,sb=a:getString(),b:getString()
  local changed,maxError=0,0
  if sa~=sb then
    for i=1,#sa,4 do
      local error=0
      for channel=0,3 do error=math.max(error,math.abs(sa:byte(i+channel)-sb:byte(i+channel))) end
      if error>0 then changed=changed+1; maxError=math.max(maxError,error) end
    end
  end
  print(string.format('GPU %dx%d cursor=%d,%d changed=%d/%d maxByteError=%d',w,h,c.mx,c.my,changed,w*h,maxError))
  scene:release(); expected:release(); actual:release(); a:release(); b:release()
  return changed
end
function love.update()
  if index>=#cases then return end
  index=index+1
  local changed=compare(cases[index])
  if changed>0 then cases.failed=true end
  if index==#cases then print(cases.failed and 'GPU FAIL' or 'GPU PASS') end
end
function love.draw() end
