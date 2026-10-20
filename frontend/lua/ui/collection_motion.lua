local D=require('ui.card_dimensions')
-- Balatro collection page callbacks create cards at the CardArea's horizontal
-- centre (a top-left coordinate), then CardArea:align_cards' `title` branch
-- fans them out. Our cards use centre coordinates; convert explicitly.
local Collection={}
-- Resting face bounds include the fan and 0.95 draw scale. Use these for
-- tray padding instead of the larger, upright logical card rectangles.
function Collection.bounds(count,scale,gap)
  local unit=D.W*scale/(D.TILE_W)
  local left,right,top,bottom=math.huge,-math.huge,math.huge,-math.huge
  for col=0,count-1 do
    local fan=(col-(count-1)/2)/count
    local angle=0.2*fan
    local x=(col-(count-1)/2)*(D.W*scale+gap)
    local y=0.475*D.H*scale+(math.abs(0.5*fan)-(count>1 and 0.2 or 0))*unit
    local hw=0.95*scale*(D.W*math.cos(angle)+D.H*math.abs(math.sin(angle)))/2
    local hh=0.95*scale*(D.H*math.cos(angle)+D.W*math.abs(math.sin(angle)))/2
    left=math.min(left,x-hw);right=math.max(right,x+hw)
    top=math.min(top,y-hh);bottom=math.max(bottom,y+hh)
  end
  return {width=right-left,top=top,height=bottom-top}
end
function Collection.target(card,time,reduced,roomWidth)
  local row=card.collection
  local unit=card.unit
  local left=(row.x-D.HALF_W*card.baseScale)/unit
  local bob=reduced and 0 or 0.03*math.sin(0.666*time+left)
  local sway=reduced and 0 or 0.02*math.sin(2*time+left)
  local parallax=(row.x-roomWidth/2)/(roomWidth/2)*1.5
  card.homeX=row.x+parallax/30*unit
  card.homeY=row.y+(bob+math.abs(0.5*row.fan)-(row.count>1 and 0.2 or 0))*unit
  card.motion.T.r=0.2*row.fan+sway
end
function Collection.place(card,x,top,count,column,center,time,reduced,roomWidth)
  card.collection={x=x,y=top+0.475*D.H*card.baseScale,count=count,fan=(column-(count-1)/2)/count}
  card.motion.T.scale=0.95
  Collection.target(card,time,reduced,roomWidth)
  local motion=card.motion
  motion.T.x=card.homeX/card.unit;motion.T.y=card.homeY/card.unit
  motion.VT.x=(reduced and card.homeX or center+D.HALF_W*card.baseScale)/card.unit
  motion.VT.y=(reduced and card.homeY or top+D.HALF_H*card.baseScale)/card.unit
  motion.VT.r=reduced and motion.T.r or 0
  motion.VT.scale=reduced and 0.95 or 1
  card.x,card.y,card.angle=motion.VT.x*card.unit,motion.VT.y*card.unit,motion.VT.r
end
return Collection
