-- Compare screen motion against the actual Balatro function, including clicks,
-- cursor easing, reduced motion, and inverse coordinates for moving hit targets.
package.path='frontend/lua/?.lua;'..package.path
local Room=require('ui.room')
local source=os.getenv('BALATRO_SOURCE') or '../balatro-source'
dofile(source..'/functions/common_events.lua')
local checks=0
local function near(a,b)
  assert(math.abs(a-b)<1e-9,tostring(a)..' != '..tostring(b))
  checks=checks+1
end
for _,size in ipairs({{1280,800},{480,850}}) do
  local w,h=unpack(size)
  for _,scenario in ipairs({{1/30,0},{1/60,50},{1/120,100},{0.09,1}}) do
    local dt,shake=unpack(scenario)
    local room=Room.new(w,h)
    G={SETTINGS={screenshake=shake},ARGS={},TIMERS={},
      ROOM={T={w=w/60,h=h/60},jiggle=0},ROOM_ORIG={x=0,y=0},
      CURSOR={T={}},CONTROLLER={cursor_position={},GAMEPAD={}},
      WINDOWTRANS={real_window_w=w,real_window_h=h},VIBRATION=0}
    for frame=1,180 do
      local time=frame*dt
      local mx,my=w*(0.5+0.5*math.sin(time)),h*(0.5+0.5*math.cos(time*2))
      local reduced=frame>=140 and frame<=160
      if frame==30 or frame==90 then
        room.jiggle=room.jiggle+0.5
        G.ROOM.jiggle=G.ROOM.jiggle+0.5
      end
      G.TIMERS.REAL=time
      G.SETTINGS.reduced_motion=reduced
      G.CURSOR.T.x,G.CURSOR.T.y=mx/60,my/60
      G.CONTROLLER.cursor_position.x,G.CONTROLLER.cursor_position.y=mx,my
      update_canvas_juice(dt)
      room:update(dt,time,mx,my,reduced,shake)
      near(room.x,G.ROOM.T.x*60)
      near(room.y,G.ROOM.T.y*60)
      near(room.r,G.ROOM.T.r)
      near(room.jiggle,G.ROOM.jiggle)
      near(room.cursorX,G.ARGS.eased_cursor_pos.x*60)
      near(room.cursorY,G.ARGS.eased_cursor_pos.y*60)
      -- Forward transform is Node:translate_container; unproject must undo it.
      local c,s=math.cos(room.r),math.sin(room.r)
      local x,y=mx-w/2+room.x,my-h/2+room.y
      local ux,uy=room:unproject(w/2+c*x-s*y,h/2+s*x+c*y)
      near(ux,mx); near(uy,my)
    end
  end
end
print('PASS: '..checks..' room-motion and input-coordinate comparisons against Balatro')
