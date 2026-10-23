local T = require('ui.theme')
local Button = {}
local g = love.graphics

-- The same four-step corner profile as UIElement:draw_pixellated_rect.
-- A single polygon avoids seams between corner strips when the room rotates.
local function panel(x,y,w,h,colour,r,progress,mode)
  r=r or 1.8 -- source res=0.6, at TILESCALE=3 (60 pixels per tile)
  g.setColor(colour)
  local sw,sh=w-4*r,h-4*r
  g.push(); g.translate(x,y)
  local vertices={
    sw/2,sh/2,0,4*r,r,4*r,r,2*r,2*r,2*r,2*r,r,4*r,r,4*r,0,
    sw,0,sw,r,sw+2*r,r,sw+2*r,2*r,sw+3*r,2*r,sw+3*r,4*r,w,4*r,
    w,sh,sw+3*r,sh,sw+3*r,sh+2*r,sw+2*r,sh+2*r,sw+2*r,sh+3*r,
    sw,sh+3*r,sw,h,4*r,h,4*r,sh+3*r,2*r,sh+3*r,2*r,sh+2*r,
    r,sh+2*r,r,sh,0,sh,0,4*r,
  }
  if progress then
    local edge=w*math.max(0,math.min(1,progress))
    for i=1,#vertices,2 do vertices[i]=math.min(vertices[i],edge)end
  end
  -- Original line vertices skip the fan centre AND the duplicated first
  -- perimeter point (k > 4), avoiding a zero-length closing edge in LÖVE.
  if mode=='line' then for _=1,4 do table.remove(vertices,1) end end
  g.polygon(mode or 'fill',vertices)
  g.pop()
end

Button.panel=panel
function Button.modalFrame(x,y,w,h) Button.panel(x,y,w,h,T.jokerGrey,2.4) end
function Button.outline(x,y,w,h,colour,r)
  panel(x,y,w,h,colour,r,nil,'line')
end

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

function Button.hoverColour(colour,active)
  -- engine/ui.lua draws G.C.UI.HOVER (00000055) over the face only.
  -- For opaque faces this is exactly a 2/3 RGB multiplier. Text, children,
  -- outlines and shadows are drawn separately and must not be tinted.
  return active and {colour[1]*2/3,colour[2]*2/3,colour[3]*2/3,colour[4]} or colour
end

function Button.cycleFace(x,y,w,h,hovered,emboss)
  -- create_option_cycle's non-clickable center: hover overlay on the face,
  -- emboss darken=.5 on hover (.3 otherwise), with no button drop shadow.
  local depth=hovered and 0.5 or 0.7
  Button.panel(x,y+(emboss or 6),w,h,{T.red[1]*depth,T.red[2]*depth,T.red[3]*depth,1})
  Button.panel(x,y,w,h,Button.hoverColour(T.red,hovered))
end

function Button.slider(x,y,w,fraction,label,hovered)
  -- create_slider: BLACK track, emboss=.05 tile; only the track has hover.
  -- The red fill is a child drawn AFTER the track's hover overlay. The value
  -- is a separate shadowed, non-interactive container (not a button).
  local c=T.panel -- G.C.BLACK
  local depth=hovered and 0.5 or 0.7
  Button.panel(x,y+3,w,24,{c[1]*depth,c[2]*depth,c[3]*depth,1})
  Button.panel(x,y,w,24,Button.hoverColour(c,hovered))
  if fraction>0 then
    local fill=w*math.min(1,fraction)
    Button.panel(x,y,fill,24,T.red,math.min(1.8,fill/8))
  end
  g.push();g.translate(x+w+8,y);g.scale(0.98)
  Button.panel(0,6.75,48,24,{0,0,0,0.3})
  g.pop()
  Button.panel(x+w+8,y,48,24,T.red)
  g.setFont(T.font(21));g.setColor(T.white)
  g.printf(label,x+w+8,y+(24-T.font(21):getHeight())/2,48,'center')
end

-- Hand-drawn pixel glyphs: stepped edges throughout, including arrowheads.
-- Mirror each back glyph for its forward counterpart.
local dicePixels={
  '.WWWWWWWWWWWWWWW.',
  'WWWWWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWWW',
  'WWWPPPWWWWWPPPWWW',
  'WWWPPPWWWWWPPPWWW',
  'WWWPPPWWWWWPPPWWW',
  'WWWWWWWWWWWWWWWWW',
  'WWWWWWWPPPWWWWWWW',
  'WWWWWWWPPPWWWWWWW',
  'WWWWWWWPPPWWWWWWW',
  'WWWWWWWWWWWWWWWWW',
  'WWWPPPWWWWWPPPWWW',
  'WWWPPPWWWWWPPPWWW',
  'WWWPPPWWWWWPPPWWW',
  'WWWWWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWWW',
  '.WWWWWWWWWWWWWWW.',
}
local dicePalette={W=T.white,P=T.panel}
local historyPixels={
  rewind={
    '...............',
    '......#.......#',
    '.....##......##',
    '....###.....###',
    '...####....####',
    '..#####...#####',
    '.######..######',
    '#######.#######',
    '.######..######',
    '..#####...#####',
    '...####....####',
    '....###.....###',
    '.....##......##',
    '......#.......#',
    '...............',
  },
  undo={
    '...............',
    '...............',
    '##.............',
    '##...#####.....',
    '##.#########...',
    '#####.....###..',
    '####.......###.',
    '#######.....##.',
    '#######......##',
    '.............##',
    '.............##',
    '.............##',
    '...............',
    '...............',
    '...............',
  },
  restart={
    '...............',
    '##.............',
    '##...#####.....',
    '##.#########...',
    '#####.....###..',
    '####.......###.',
    '#######.....##.',
    '#######......##',
    '.............##',
    '.............##',
    '##...........##',
    '##...........##',
    '.##.........##.',
    '.###.......###.',
    '..###.....###..',
    '...#########...',
    '.....#####.....',
  },
}
local function historyIcon(icon)
  if icon=='fast_forward' or icon=='redo' then g.scale(-1,1) end
  local pixels=historyPixels[icon=='restart' and 'restart' or ((icon=='rewind' or icon=='fast_forward') and 'rewind' or 'undo')]
  for y,row in ipairs(pixels) do
    for x=1,#row do
      if row:sub(x,x)=='#' then g.rectangle('fill',x-8.5,y-#pixels/2-1,1,1) end
    end
  end
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
  local face=Button.hoverColour(colour,active or pressed)
  panel(0,0,b.w,b.h,face)
  g.pop()
  if b.icon=='dice' then
    local size=math.min(b.w,b.h)*0.5
    g.push();g.translate(b.w/2,b.h/2);g.scale(pressed and 0.985 or 1)
    g.scale(size/17);g.translate(-8.5,-8.5)
    -- Custom top-down sprite with stepped corners and five square pips.
    for _,shadow in ipairs({true,false}) do
      for y,row in ipairs(dicePixels) do
        for x=1,#row do
          local colour=dicePalette[row:sub(x,x)]
          if colour then
            if shadow then g.setColor(0,0,0,0.3) else g.setColor(colour) end
            g.rectangle('fill',x-1,y-1+(shadow and 1 or 0),1,1)
          end
        end
      end
    end
    g.pop();g.pop()
    return
  end
  if b.icon=='rewind' or b.icon=='fast_forward' or b.icon=='undo' or b.icon=='redo' or b.icon=='restart' then
    local scale=math.min(b.w,b.h)*0.48/(b.icon=='restart' and #historyPixels.restart or 15)*(pressed and 0.985 or 1)
    g.push('all');g.translate(b.w/2,b.h/2+1.5);g.scale(scale)
    g.setColor(0,0,0,0.3);historyIcon(b.icon);g.pop()
    g.push('all');g.translate(b.w/2,b.h/2);g.scale(scale)
    g.setColor(T.white);historyIcon(b.icon);g.pop()
    g.pop()
    return
  end
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
