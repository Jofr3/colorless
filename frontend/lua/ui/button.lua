local T = require('ui.theme')
local Button = {}
local g = love.graphics

-- The same four-step corner profile as UIElement:draw_pixellated_rect.
-- A single polygon avoids seams between corner strips when the room rotates.
local function panel(x,y,w,h,colour,r)
  r=r or 1.8 -- source res=0.6, at TILESCALE=3 (60 pixels per tile)
  g.setColor(colour)
  local sw,sh=w-4*r,h-4*r
  g.push(); g.translate(x,y)
  g.polygon('fill',{
    sw/2,sh/2,0,4*r,r,4*r,r,2*r,2*r,2*r,2*r,r,4*r,r,4*r,0,
    sw,0,sw,r,sw+2*r,r,sw+2*r,2*r,sw+3*r,2*r,sw+3*r,4*r,w,4*r,
    w,sh,sw+3*r,sh,sw+3*r,sh+2*r,sw+2*r,sh+2*r,sw+2*r,sh+3*r,
    sw,sh+3*r,sw,h,4*r,h,4*r,sh+3*r,2*r,sh+3*r,2*r,sh+2*r,
    r,sh+2*r,r,sh,0,sh,0,4*r,
  })
  g.pop()
end

Button.panel=panel

function Button.chosen(b,time,pressed,roomWidth)
  -- UIElement:draw_self + get_chosen_triangle_from_rect, in screen pixels
  -- (TILESIZE=20, TILESCALE=3). The marker bobs upward, with a gap below it.
  local sx=((b.x+b.w/2-roomWidth/2)/(roomWidth/2))*1.5
  local sy=-1.5
  local distance=pressed and 0 or 1.5
  local layer=0.4-(pressed and 1.5 or 0)
  local lx,ly=layer*sx/20,layer*sy/20
  local bob=math.min(1.2*math.sin(time*9)+0.2,0)*3
  local function triangle(scale,shadow)
    g.push()
    g.translate(b.x+b.w/2+lx*60,b.y+b.h/2+ly*60)
    g.scale(scale)
    local x=lx*3-(shadow and sx*distance*0.5*3 or 0)
    local y=-b.h/2+ly*3+bob-(shadow and sy*distance*0.5*3 or 0)
    g.polygon('fill',x-9,y-24,x,y-6.6,x+9,y-24)
    g.pop()
  end
  g.setColor(0,0,0,0.3); triangle(0.98,true)
  g.setColor(T.red); triangle(1,false)
end

function Button.tray(x,y,w,h)
  -- Main menu row: emboss=0.1 tile, but no shadow=true.
  local c=T.tray
  panel(x,y+6,w,h,{c[1]*0.7,c[2]*0.7,c[3]*0.7,1})
  panel(x,y,w,h,c)
end

function Button.hit(b,x,y)
  return x>=b.x and x<=b.x+b.w and y>=b.y and y<=b.y+b.h
end

function Button.draw(b,active,pressed,focused,roomWidth)
  local colour=b.colour
  -- UIBox_button sets shadow=true, NOT emboss. UIElement:draw_self projects
  -- the shadow by 1.5, scales it to .98 and offsets the face by .4 parallax.
  -- Moveable:calculate_parrallax uses horizontal room position; y stays -1.5.
  local sx=((b.x+b.w/2-(roomWidth or 1280)/2)/((roomWidth or 1280)/2))*1.5
  local sy=-1.5
  local distance=pressed and 0 or 1.5
  local layer=0.4-(pressed and 1.5 or 0)
  g.push()
  g.translate(b.x+layer*sx*3,b.y+layer*sy*3)
  g.push()
  g.scale(0.98)
  panel(-sx*distance*3,-sy*distance*3,b.w,b.h,{0,0,0,0.3})
  g.pop()
  g.push()
  g.scale(pressed and 0.985 or 1)
  local face=(active or pressed) and {colour[1]*2/3,colour[2]*2/3,colour[3]*2/3,1} or colour
  panel(0,0,b.w,b.h,face)
  g.pop()
  local fontSize=b.fontSize or 27
  local label=b.displayLabel or (b.uppercase and b.label:upper() or b.label)
  local textY=(b.h-T.font(fontSize):getHeight())/2
  g.setFont(T.font(fontSize))
  g.setColor(0,0,0,0.3)
  g.push(); g.translate(b.w/2,b.h/2); g.scale(0.97); g.translate(-b.w/2,-b.h/2)
  g.printf(label,-sx*0.5*3,textY-sy*0.5*3,b.w,'center')
  g.pop()
  g.setColor(T.white)
  g.printf(label,0,textY,b.w,'center')
  g.pop()
end
return Button
