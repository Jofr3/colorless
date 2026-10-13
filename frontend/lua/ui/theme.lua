local T = {}
local function hex(s)
  return {tonumber(s:sub(1,2),16)/255, tonumber(s:sub(3,4),16)/255, tonumber(s:sub(5,6),16)/255, 1}
end
T.red, T.blue, T.green, T.gold = hex('FE5F55'), hex('009DFF'), hex('4BC292'), hex('F5B244')
T.orange, T.paleGreen, T.tray = hex('FDA200'), hex('56A887'), hex('4F6367')
-- Profile button: mix_colours(WHITE, GREY, 0.2).
T.profile = {0.2+0.8*95/255,0.2+0.8*115/255,0.2+0.8*119/255,1}
T.ink, T.panel, T.white, T.paper = hex('1E2B2D'), hex('374244'), hex('FFFFFF'), hex('F0EAD6')
T.fonts = {}
function T.font(size)
  if not T.fonts[size] then
    T.fonts[size] = love.graphics.newFont('assets/fonts/m6x11plus.ttf', size)
    T.fonts[size]:setFilter('nearest', 'nearest')
  end
  return T.fonts[size]
end
function T.text(text, size, x, y, width, colour, align)
  local g = love.graphics
  g.setFont(T.font(size))
  g.setColor(0,0,0,0.35)
  g.printf(text,x+2,y+3,width,align or 'center')
  g.setColor(colour or T.white)
  g.printf(text,x,y,width,align or 'center')
end
-- Stepped corners, as on Balatro's pixel UI panels.
function T.box(x,y,w,h,c,r)
  local g = love.graphics
  r = r or 6
  g.setColor(c)
  g.rectangle('fill',x+r,y,w-2*r,h)
  g.rectangle('fill',x,y+r,w,h-2*r)
  g.rectangle('fill',x+2,y+2,w-4,h-4)
end
return T
