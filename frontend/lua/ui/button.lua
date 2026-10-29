local T = require('ui.theme')
local Fit = require('ui.text_fit')
local Button = {}
local g = love.graphics

-- The same four-step corner profile as UIElement:draw_pixellated_rect.
-- A single polygon avoids seams between corner strips when the room rotates.
-- Vertex arrays are refilled on every call; g.polygon copies them.
local fan,outline={},{}
local function panel(x,y,w,h,colour,r,progress,mode)
  r=r or 1.8 -- source res=0.6, at TILESCALE=3 (60 pixels per tile)
  g.setColor(colour)
  local sw,sh=w-4*r,h-4*r
  g.push(); g.translate(x,y)
  local v=fan
  v[1],v[2],v[3],v[4],v[5],v[6],v[7],v[8],v[9],v[10],v[11],v[12],v[13],v[14],v[15],v[16]=
    sw/2,sh/2,0,4*r,r,4*r,r,2*r,2*r,2*r,2*r,r,4*r,r,4*r,0
  v[17],v[18],v[19],v[20],v[21],v[22],v[23],v[24],v[25],v[26],v[27],v[28],v[29],v[30]=
    sw,0,sw,r,sw+2*r,r,sw+2*r,2*r,sw+3*r,2*r,sw+3*r,4*r,w,4*r
  v[31],v[32],v[33],v[34],v[35],v[36],v[37],v[38],v[39],v[40]=
    w,sh,sw+3*r,sh,sw+3*r,sh+2*r,sw+2*r,sh+2*r,sw+2*r,sh+3*r
  v[41],v[42],v[43],v[44],v[45],v[46],v[47],v[48],v[49],v[50],v[51],v[52]=
    sw,sh+3*r,sw,h,4*r,h,4*r,sh+3*r,2*r,sh+3*r,2*r,sh+2*r
  v[53],v[54],v[55],v[56],v[57],v[58],v[59],v[60]=
    r,sh+2*r,r,sh,0,sh,0,4*r
  if progress then
    local edge=w*math.max(0,math.min(1,progress))
    for i=1,#v,2 do v[i]=math.min(v[i],edge)end
  end
  -- Original line vertices skip the fan centre AND the duplicated first
  -- perimeter point (k > 4), avoiding a zero-length closing edge in LÖVE.
  if mode=='line' then
    for i=5,#v do outline[i-4]=v[i] end
    v=outline
  end
  g.polygon(mode or 'fill',v)
  g.pop()
end

Button.panel=panel
local SHADOW={0,0,0,0.3}
function Button.modalFrame(x,y,w,h) Button.panel(x,y,w,h,T.jokerGrey,2.4) end
-- create_UIBox_generic_options: the dark emboss below, the JOKER_GREY border
-- and the L_BLACK interior.
local EMBOSS={0.525,0.546,0.585,1}
function Button.modalFrameRaised(x,y,w,h)
  Button.panel(x,y+6,w,h,EMBOSS,2.4)
  Button.modalFrame(x,y,w,h)
  Button.panel(x+4,y+4,w-8,h-8,T.tray,2.4)
end
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

local TRAY_SHADE={T.tray[1]*0.7,T.tray[2]*0.7,T.tray[3]*0.7,1}
function Button.tray(x,y,w,h)
  -- Main menu row: emboss=0.1 tile, but no shadow=true.
  local c=T.tray
  panel(x,y+6,w,h,TRAY_SHADE)
  panel(x,y,w,h,c)
end

-- An error or warning line: red text, fitted to w and centred, on an ink
-- pill reaching 12 px past it. Red on the grey tray is too faint to read; on
-- ink it is about 5:1.
function Button.errorLine(text,size,x,y,w)
  text,size=Fit.fit(text,size,w)
  local font=T.font(size)
  local tw,th=font:getWidth(text)+24,font:getHeight()+8
  Button.panel(x+(w-tw)/2,y-4,tw,th,T.ink)
  T.text(text,size,x,y,w,T.red)
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

-- colour's RGB times k, opaque, in a table reused by every call.
local shaded={}
function Button.shade(colour,k)
  shaded[1],shaded[2],shaded[3],shaded[4]=colour[1]*k,colour[2]*k,colour[3]*k,1
  return shaded
end

function Button.cycleFace(x,y,w,h,hovered,emboss)
  -- create_option_cycle's non-clickable center: hover overlay on the face,
  -- emboss darken=.5 on hover (.3 otherwise), with no button drop shadow.
  local depth=hovered and 0.5 or 0.7
  Button.panel(x,y+(emboss or 6),w,h,Button.shade(T.red,depth))
  Button.panel(x,y,w,h,Button.hoverColour(T.red,hovered))
end

function Button.slider(x,y,w,fraction,label,hovered)
  -- create_slider: BLACK track, emboss=.05 tile; only the track has hover.
  -- The red fill is a child drawn AFTER the track's hover overlay. The value
  -- is a separate shadowed, non-interactive container (not a button).
  local c=T.panel -- G.C.BLACK
  local depth=hovered and 0.5 or 0.7
  Button.panel(x,y+3,w,24,Button.shade(c,depth))
  Button.panel(x,y,w,24,Button.hoverColour(c,hovered))
  if fraction>0 then
    local fill=w*math.min(1,fraction)
    Button.panel(x,y,fill,24,T.red,math.min(1.8,fill/8))
  end
  g.push();g.translate(x+w+8,y);g.scale(0.98)
  Button.panel(0,6.75,48,24,SHADOW)
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
-- Each glyph colour's horizontal runs of cells, as {x,y,w} rectangles, built
-- on first use: one rectangle per run instead of one per pixel. A run covers
-- exactly the cells it replaces, so the rasterised pixels do not change.
local runs={}
local function pixelRuns(key,rows,char,ox,oy)
  if runs[key] then return runs[key] end
  local list={}
  for y,row in ipairs(rows) do
    local x=1
    while x<=#row do
      if row:sub(x,x)==char then
        local last=x
        while row:sub(last+1,last+1)==char do last=last+1 end
        list[#list+1]={x-1+ox,y-1+oy,last-x+1}
        x=last+1
      else x=x+1 end
    end
  end
  runs[key]=list
  return list
end
local function fillRuns(list,dy)
  for _,r in ipairs(list) do g.rectangle('fill',r[1],r[2]+dy,r[3],1) end
end
local function historyIcon(icon)
  if icon=='fast_forward' or icon=='redo' then g.scale(-1,1) end
  local name=icon=='restart' and 'restart' or ((icon=='rewind' or icon=='fast_forward') and 'rewind' or 'undo')
  local pixels=historyPixels[name]
  fillRuns(pixelRuns(name,pixels,'#',-7.5,-#pixels/2),0)
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
  panel(-sx*distance*3,-sy*distance*3,b.w,b.h,SHADOW)
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
    local white,pips=pixelRuns('diceW',dicePixels,'W',0,0),pixelRuns('diceP',dicePixels,'P',0,0)
    g.setColor(0,0,0,0.3);fillRuns(white,1);fillRuns(pips,1)
    g.setColor(dicePalette.W);fillRuns(white,0)
    g.setColor(dicePalette.P);fillRuns(pips,0)
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
