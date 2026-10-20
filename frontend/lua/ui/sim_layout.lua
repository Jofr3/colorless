local D=require('ui.card_dimensions')
-- Table geometry in board pixels (one Balatro tile = 60px). Desktop keeps the
-- run screen's proportions: a 4.5-tile HUD column, the hand along the bottom
-- edge, the deck at the bottom right, and the opponent's hand peeking in from
-- the top edge like Balatro's off-screen discard pile.
local Layout={}
local FULL=60*D.TILE_W/D.W -- card baseScale giving CARD_W = 2.049 tiles (123px)
Layout.FULL=FULL
-- Wells hug their cards like a CardArea's area_uibox: the card bounds (or the
-- bench's five slots / the prize grid) plus a 0.13-tile pad on every side.
local PAD=8
local function tight(z,slots,width)
  local w,h=D.W*z.scale,D.H*z.scale
  if width then
    z.well={x=z.x-width/2,y=z.y-h/2-PAD,w=width,h=h+2*PAD}
  elseif z.cols then
    local rows=math.ceil(6/z.cols)
    local gw,gh=(z.cols-1)*z.dx+w,(rows-1)*z.dy+h
    z.well={x=z.x-w/2-PAD,y=z.y-h/2-PAD,w=gw+2*PAD,h=gh+2*PAD}
  else
    local gw=(slots and (slots-1)*z.spacing or 0)+w
    z.well={x=z.x-gw/2-PAD,y=z.y-h/2-PAD,w=gw+2*PAD,h=h+2*PAD}
  end
  return z
end
function Layout.desktop()
  local L={portrait=false,w=1280,h=800,unit=60}
  -- The HUD column overflows the room top and bottom like Balatro's (minh 30
  -- tiles), so only its two side lines show.
  L.hud={x=10,y=-400,w=280,h=1600}
  L.table={x=300,y=0,w=980,h=800,cx=786}
  -- Four 144px rows (opponent's row, the two Actives facing each other in the
  -- middle, your row) between three columns: piles on the left, the benches in
  -- the centre, prizes/deck on the right. The hand fans along the bottom edge.
  -- One card size on the table and in the hand (Balatro never mixes card
  -- sizes); only the prize grids are miniatures. Rows are sized from the card
  -- so the four rows plus the hand fill the room's height.
  -- 0.74 is the largest card whose four rows and hand still fit 800px.
  local CARD=0.74
  local cardH=D.H*CARD
  local rowH=cardH+2*PAD
  local top,gap=4,6
  local function rowC(i) return top+(i-1)*(rowH+gap)+rowH/2 end
  local rowsEnd=top+4*rowH+3*gap
  local leftC,midC,rightC=376,786,1200
  -- Prize miniatures: the largest 2x3 grid that fits the side columns.
  local PRIZE=0.4
  local pdx,pdy=D.W*PRIZE+8,D.H*PRIZE+8
  -- Bench cards pack tightly at the centre of a wide well.
  -- 28px between bench cards leaves room for attached cards to peek out.
  local benchSpacing=D.W*CARD+28
  local benchW=660
  -- Prize grids share an edge with their owner's bench: the opponent's top
  -- edge with the top bench, yours with the bottom bench's lower edge.
  local prizeH=2*pdy+D.H*PRIZE+2*PAD
  local oppPrizeTop=rowC(1)-rowH/2
  local youPrizeTop=rowC(4)+rowH/2-prizeH
  L.zones={
    opp_hand={x=midC,y=-70,scale=CARD,span=420,hidden=true},
    opp_discard=tight({x=leftC,y=rowC(1),scale=CARD}),
    opp_bench=tight({x=midC,y=rowC(1),scale=CARD,spacing=benchSpacing,slots=5},5,benchW),
    opp_prizes=tight({x=rightC-pdx/2,y=oppPrizeTop+PAD+D.HALF_H*PRIZE,scale=PRIZE,cols=2,dx=pdx,dy=pdy}),
    opp_deck=tight({x=leftC,y=rowC(2),scale=CARD}),
    opp_active=tight({x=midC,y=rowC(2),scale=CARD}),
    stadium=tight({x=541,y=(rowC(2)+rowC(3))/2,scale=CARD}),
    you_active=tight({x=midC,y=rowC(3),scale=CARD}),
    played=tight({x=1000,y=rowC(3),scale=CARD,spacing=22},nil,176),
    you_deck=tight({x=rightC,y=rowC(3),scale=CARD}),
    you_prizes=tight({x=leftC-pdx/2,y=youPrizeTop+PAD+D.HALF_H*PRIZE,scale=PRIZE,cols=2,dx=pdx,dy=pdy}),
    you_bench=tight({x=midC,y=rowC(4),scale=CARD,spacing=benchSpacing,slots=5},5,benchW),
    you_discard=tight({x=rightC,y=rowC(4),scale=CARD}),
    you_hand={x=midC,y=rowsEnd+4+cardH/2,scale=CARD,span=520},
    playmat={x=midC,y=(rowC(2)+rowC(3))/2,well={x=448,y=rowC(2)-rowH/2,w=676,h=2*rowH+gap}},
  }
  L.zones.you_bench.y=L.zones.you_bench.y-6 -- cards ride a little high in the well
  L.cluster={x=308,y=rowsEnd+6,w=164,h=136}
  L.message={x=300,y=772,w=760,h=26}
  L.banner={x=midC,y=(rowC(2)+rowC(3))/2}
  return L
end
function Layout.portrait()
  local L={portrait=true,w=480,h=850,unit=60}
  L.hud={x=8,y=8,w=464,h=118}
  L.table={x=0,y=130,w=480,h=600,cx=240}
  local CARD=0.42
  L.zones={
    opp_hand={x=240,y=118,scale=0.3,span=200,hidden=true},
    opp_bench=tight({x=240,y=190,scale=CARD,spacing=64,slots=5},5),
    opp_prizes=tight({x=28,y=160,scale=0.135,cols=2,dx=24,dy=27}),
    opp_deck=tight({x=430,y=190,scale=CARD}),
    opp_discard={x=462,y=224,scale=CARD,well={x=446,y=190,w=32,h=50},tiny=true},
    stadium=tight({x=56,y=334,scale=CARD}),
    you_active=tight({x=300,y=334,scale=CARD}),
    opp_active=tight({x=170,y=334,scale=CARD}),
    played=tight({x=422,y=334,scale=CARD,spacing=12},nil,96),
    you_prizes=tight({x=28,y=450,scale=0.135,cols=2,dx=24,dy=27}),
    you_bench=tight({x=240,y=480,scale=CARD,spacing=64,slots=5},5),
    you_deck=tight({x=430,y=480,scale=CARD}),
    you_discard={x=462,y=514,scale=CARD,well={x=446,y=480,w=32,h=50},tiny=true},
    you_hand={x=240,y=690,scale=0.72,span=330},
    playmat={x=240,y=334,well={x=100,y=250,w=280,h=170}},
  }
  L.cluster={x=8,y=780,w=464,h=62,horizontal=true}
  L.message={x=8,y=556,w=464,h=24}
  L.banner={x=240,y=250}
  return L
end
function Layout.for_size(w,h)
  return (w<600) and Layout.portrait() or Layout.desktop()
end
-- Hand fan: CardArea:align_cards for type 'hand'. Cards spread across the span
-- (narrowing when few), rotate by 0.2*(k - n/2 - 0.5)/n, and sit on a shallow arc.
function Layout.hand(zone,count,index)
  local n=math.max(count,1)
  local maxCards=math.max(n,7)
  local spread=zone.span
  local t=(n>1) and ((index)/(math.max(maxCards-1,1))-0.5*(n-maxCards)/math.max(maxCards-1,1)) or 0.5
  local x=zone.x-spread/2+spread*t
  if n==1 then x=zone.x end
  local k=index+1
  local rotation=0.2*(-n/2-0.5+k)/n
  local arc=(math.abs(0.5*(-n/2+k-0.5)/n)-0.2)*60*zone.scale
  return x,zone.y+arc,rotation
end
function Layout.bench(zone,count,index)
  local n=math.max(count,1)
  local spacing=math.min(zone.spacing,zone.well.w/math.max(n,1))
  return zone.x+(index-(n-1)/2)*spacing,zone.y
end
function Layout.benchIndex(zone,count,x)
  local n=math.max(count,1)
  local spacing=math.min(zone.spacing,zone.well.w/math.max(n,1))
  return math.max(0,math.min(n,math.floor((x-zone.x)/spacing+(n-1)/2+0.5)))
end
function Layout.prize(zone,index)
  return zone.x+(index%zone.cols)*zone.dx,zone.y+math.floor(index/zone.cols)*zone.dy
end
function Layout.played(zone,count,index)
  local spacing=math.min(zone.spacing,(zone.well.w-16-D.W*zone.scale)/math.max(1,count-1))
  return zone.x+(index-(count-1)/2)*spacing,zone.y
end
-- Preserve the room needed for attached Energy and Tools while sorting a Bench.
function Layout.benchPositions(zone,items)
  local cardW=D.W*zone.scale
  local total,gaps=#items*cardW,{}
  for i=2,#items do
    local gap=8+(#(items[i-1].energyCards or {})>0 and 26 or 0)+(#(items[i].toolCards or {})>0 and 26 or 0)
    gaps[i]=gap;total=total+gap
  end
  local x=zone.x-total/2+cardW/2
  local positions={}
  for i,item in ipairs(items) do
    if i>1 then x=x+cardW+gaps[i] end
    positions[item.index]=x
  end
  return positions
end
function Layout.inside(rect,x,y)
  return rect and x>=rect.x and x<=rect.x+rect.w and y>=rect.y and y<=rect.y+rect.h
end
return Layout
