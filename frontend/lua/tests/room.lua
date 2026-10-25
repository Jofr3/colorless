-- Compare screen motion against the actual Balatro function, including clicks,
-- cursor easing, reduced motion, and inverse coordinates for moving hit targets.
package.path='frontend/lua/?.lua;'..package.path
local Room=require('ui.room')
local source=require('tests.support.balatro_source').required()
dofile(source..'/functions/common_events.lua')
local checks=0
local function near(a,b)
  assert(math.abs(a-b)<1e-9,tostring(a)..' != '..tostring(b))
  checks=checks+1
end
for _,size in ipairs({{1280,800,60},{1280,800,1280/22},{480,850,480/22},{1920,1080,1080/12.9}}) do
  local w,h,unit=unpack(size)
  for _,scenario in ipairs({{1/30,0},{1/60,50},{1/120,100},{0.09,1}}) do
    local dt,shake=unpack(scenario)
    local room=Room.new(w,h,unit)
    G={SETTINGS={screenshake=shake},ARGS={},TIMERS={},
      ROOM={T={w=w/unit,h=h/unit},jiggle=0},ROOM_ORIG={x=0,y=0},
      CURSOR={T={}},CONTROLLER={cursor_position={},GAMEPAD={}},
      WINDOWTRANS={real_window_w=w,real_window_h=h},VIBRATION=0}
    for frame=1,180 do
      local time=frame*dt
      local mx,my=w*(0.5+0.5*math.sin(time)),h*(0.5+0.5*math.cos(time*2))
      local reduced=frame>=140 and frame<=160
      if frame==30 or frame==90 then
        local impulse=frame==30 and 0.5 or 3
        room.jiggle=room.jiggle+impulse
        G.ROOM.jiggle=G.ROOM.jiggle+impulse
      end
      G.TIMERS.REAL=time
      G.SETTINGS.reduced_motion=reduced
      G.CURSOR.T.x,G.CURSOR.T.y=mx/unit,my/unit
      G.CONTROLLER.cursor_position.x,G.CONTROLLER.cursor_position.y=mx,my
      update_canvas_juice(dt)
      room:update(dt,time,mx,my,reduced,shake)
      near(room.x,G.ROOM.T.x*unit)
      near(room.y,G.ROOM.T.y*unit)
      near(room.r,G.ROOM.T.r)
      near(room.jiggle,G.ROOM.jiggle)
      near(room.cursorX,G.ARGS.eased_cursor_pos.x*unit)
      near(room.cursorY,G.ARGS.eased_cursor_pos.y*unit)
      -- Forward transform is Node:translate_container; unproject must undo it.
      local c,s=math.cos(room.r),math.sin(room.r)
      local x,y=mx-w/2+room.x,my-h/2+room.y
      local ux,uy=room:unproject(w/2+c*x-s*y,h/2+s*x+c*y)
      near(ux,mx); near(uy,my)
    end
  end
end
print('PASS: '..checks..' room-motion and input-coordinate comparisons against Balatro')
