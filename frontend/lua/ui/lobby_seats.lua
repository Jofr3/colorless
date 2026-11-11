-- The lobby's versus seats, as create_UIBox_blind_choice draws them: the opponent's above the VS
-- and yours below, each a dark body with a seat-coloured name banner, its connection dot and
-- state, juiced as players join and ready; yours grows your chosen deck's titled pile. Its
-- functions are Online methods (online.lua installs them).
local D=require('ui.card_dimensions')
local T=require('ui.theme')
local Button=require('ui.button')
local Dyna=require('ui.dynatext')
local Pile=require('ui.deck_pile')
local CardBack=require('ui.card_back')
local DeckGrid=require('ui.deck_grid')
local Limits=require('ui.limits')
local g=love.graphics
local Seats={methods={}}
local Online=Seats.methods
local function darken(c,t) return {c[1]*(1-t),c[2]*(1-t),c[3]*(1-t),c[4] or 1} end
local function mix(a,b,t) return {a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t,1} end
-- Your deck preview: the picker's titled pile, centred in the seat.
function Online:deckBox(p)
  local scale=self:pickerScale()
  if self.compact then
    -- In the compact arrangement the pile shrinks to the seat's free height: its name 100 below
    -- the seat's top as at 1280x800 (32 above the stack, which rises 15 per unit of scale over
    -- the card's half height), its count 8 above Choose deck. The count keeps the size it has on
    -- screen at 100%: its em is a fixed `em` pixels of this smaller canvas, 0.83 of it tall,
    -- under a row 0.08 + 0.95 half card + 0.06 tiles below the centre.
    local tile=D.W/D.TILE_W
    local full=math.min(0.82,((800-72-260)/2-84)/D.H) -- the preview's scale at 1280x800
    local em=0.3*tile*full*self.width/1280
    local row=(0.14+0.95*D.TILE_H/2)*tile
    scale=math.min(scale,(p.h-240-0.83*em)/(D.HALF_H+15+row))
    return {cx=p.x+p.w/2,cy=p.y+132+(D.HALF_H+15)*scale,scale=scale,counterScale=em/(tile*scale)}
  end
  return {cx=p.x+p.w/2,cy=p.y+144+D.HALF_H*scale,scale=scale}
end
-- Your chosen deck's pile, drawn as in the picker.
function Online:makePiles()
  local you,opp=self.seats.you,self.seats.opponent
  local shown=(self.step=='versus' or self.step=='countdown') and not self.picker
  local key=shown and table.concat({self.width,self.height,you and you.hasDeck and 1 or 0,you and you.deckId or '',you and you.deckName or '',opp and opp.present and 1 or 0},'|') or ''
  if key==self.pileKey then return end
  self.pileKey=key
  for _,pile in pairs(self.piles) do pile.texture:release() end
  self.piles={}
  if not shown then return end
  if you and you.hasDeck then
    local deck=you.deckId~='' and self:deck(you.deckId) or nil
    local item={count=deck and deck.count or Limits.deckSize,name=you.deckName~='' and you.deckName or deck and deck.name or ''}
    item.drawFace=function(w,h) CardBack.draw(nil,w,h) end
    local box=self:deckBox(self.panels.you)
    local pile=Pile.new(item,1);pile:place(box.cx,box.cy,box.scale,false,self.width);pile.counterScale=box.counterScale
    self.piles.you=pile
  end
end
local function juiced(m,x,y,w,h)
  g.push();g.translate(x+w/2,y+h/2);g.rotate(m.VT.r);g.scale(m.VT.scale);g.translate(-x-w/2,-y-h/2)
end
-- create_UIBox_blind_choice: dark body, seat-coloured name banner, state pill.
function Online:drawSeat(tag)
  local p,seat=self.panels[tag],self.seats[tag] or {}
  local colour=tag=='you' and T.blue or T.red
  juiced(self.juice[tag],p.x,p.y,p.w,p.h)
  Button.panel(p.x,p.y,p.w,p.h,mix(T.panel,T.tray,0.5),2.4)
  g.setLineWidth(1.5);Button.outline(p.x,p.y,p.w,p.h,T.tray,2.4)
  local bh=self.portrait and 40 or 44
  local bw=p.w-24
  Button.panel(p.x+12,p.y+15,bw,bh,darken(colour,0.55))
  Button.panel(p.x+12,p.y+12,bw,bh,darken(colour,0.3))
  g.setLineWidth(2);Button.outline(p.x+12,p.y+12,bw,bh,colour)
  Dyna.static(seat.present and seat.name or 'Waiting for opponent...',0.45,p.x+20,p.y+12,bw-16,bh,T.white,{fit=true,roomWidth=self.width})
  local ry=p.y+bh+22
  Button.panel(p.x+16,ry+7,12,12,seat.present and seat.connected and colour or T.grey,0.9)
  T.text(tag=='you' and 'You' or 'Opponent',24,p.x+36,ry,160,T.white,'left')
  -- The seat state is coloured text: gold choosing, green ready.
  local label,tint='Waiting',mix(T.grey,T.white,0.4)
  if seat.present and not seat.connected then label,tint='Away',T.red
  elseif seat.present and seat.ready then label,tint='Ready',T.green
  elseif seat.present then label,tint='Choosing deck',T.gold end
  local pw=180
  local px=p.x+p.w-12-pw
  juiced(self.juice[tag..'Pill'],px,ry-2,pw,30)
  T.text(label,24,px,ry,pw,tint,'right')
  g.pop()
  if tag=='opponent' then g.pop();return end
  if self.piles.you then DeckGrid.drawPile(self.piles.you,false,self.width) end
  g.pop()
end
return Seats
