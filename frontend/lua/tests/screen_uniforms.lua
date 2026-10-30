-- The CRT pass (ui/screen.lua, audit LC7): an idle frame refills the screen's tables in place,
-- making no garbage, and sends the CRT shader only its time and mouse position; the other ten
-- uniforms go once per Screen (each layout makes one) and again when CRT, bloom or reduced motion
-- change. Every value sent is still Screen.values', which screen.lua checks against Balatro.
package.path='frontend/lua/?.lua;'..package.path
local sent={}
love={graphics=setmetatable({},{__index=function() return function() end end})}
local Screen=require('ui.screen')
local function check(ok,message) if not ok then error(message,2) end end
local shader={send=function(_,key,value)
  if type(value)=='table' then value={value[1],value[2]} end
  sent[#sent+1]={key,value}
end}
local function sentKeys()
  local keys={}
  for _,s in ipairs(sent) do keys[#keys+1]=s[1] end
  table.sort(keys)
  return table.concat(keys,' ')
end
local function matches(expected)
  for _,s in ipairs(sent) do
    local want=expected[s[1]]
    if type(want)=='table' then
      check(s[2][1]==want[1] and s[2][2]==want[2],s[1]..' is sent as Screen.values has it')
    else check(s[2]==want,s[1]..' is sent as Screen.values has it') end
  end
end
local ALL='bloom_fac crt_intensity distortion_fac feather_fac glitch_intensity hovering mouse_screen_pos noise_fac scale_fac scanlines screen_scale time'
local w,h=1280,800
local unit=Screen.unit(w,h)
local prefs={crt=70,bloom=0}
local screen=Screen.new(shader,w,h,unit)
local function frame(time,mx,my,reduced)
  sent={}
  screen:update(time,mx,my,reduced,prefs)
  screen:draw({})
  matches(Screen.values(h,unit,time,mx,my,reduced,prefs))
end
frame(13,100,200,false)
check(sentKeys()==ALL,'The first frame sends every uniform: '..sentKeys())
frame(13.1,110,190,false)
check(sentKeys()=='mouse_screen_pos time','Later frames send only time and mouse: '..sentKeys())
prefs.crt=40
frame(13.2,110,190,false)
check(sentKeys()==ALL,'A CRT change sends every uniform again')
frame(13.3,110,190,false)
check(sentKeys()=='mouse_screen_pos time','then only time and mouse')
prefs.bloom=1
frame(13.4,110,190,false)
check(sentKeys()==ALL,'A bloom change sends every uniform again')
frame(13.5,110,190,true)
check(sentKeys()==ALL,'Reduced motion (no noise, no tilt) sends every uniform again')
frame(13.6,120,190,true)
check(sentKeys()=='mouse_screen_pos time','then only time and mouse')
-- The projected corners pointer input reads are the same as from a fresh Screen.
local fresh=Screen.new(shader,w,h,unit)
fresh:update(13.6,120,190,true,prefs)
for i=1,4 do
  for _,k in ipairs({'x','y','u','v','q'}) do check(fresh.projected[i][k]==screen.projected[i][k],'Corner '..i..' '..k..' matches') end
end
check(screen:unproject(640,400)==fresh:unproject(640,400),'Pointer mapping matches')
-- An idle frame's update makes no garbage.
for _=1,10 do screen:update(14,300,300,false,prefs) end
collectgarbage('collect');collectgarbage('stop')
local before=collectgarbage('count')
for i=1,1000 do screen:update(14+i/60,300+i%7,300,false,prefs) end
local kb=collectgarbage('count')-before
collectgarbage('restart')
check(kb<1,('1000 updates made %.2f KB of garbage'):format(kb))
print(('PASS: CRT uniforms sent once per change, time and mouse per frame; update garbage %.2f KB/1000'):format(kb))
