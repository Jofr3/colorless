-- One page of deck piles in a two-row grid, as the sandbox chooser and the
-- online picker show them. `view` carries cards, area, page, pageText, time,
-- reduced and width; fill sets view.cards, view.page and view.pages.
local D=require('ui.card_dimensions')
local T=require('ui.theme')
local Button=require('ui.button')
local Fit=require('ui.text_fit')
local Pile=require('ui.deck_pile')
local Labels=require('ui.deck_labels')
local CardBack=require('ui.card_back')
local g=love.graphics
local DeckGrid={}
-- The grid's pager (ui/pager.lua), anchored at the room's centre.
DeckGrid.PAGER={face=-119,w=238,arrow=32,h=36,textScale=0.4}
function DeckGrid.release(view)
  for _,card in ipairs(view.cards) do card.texture:release() end
  view.cards={}
end
function DeckGrid.fill(view,matches,size,cols,scale,entering)
  view.pages=math.max(1,math.ceil(#matches/size));view.page=math.max(1,math.min(view.pages,view.page))
  view.pageText:set('Page '..view.page..'/'..view.pages,view.time)
  local a=view.area
  for i=(view.page-1)*size+1,math.min(#matches,view.page*size) do
    local item=matches[i]
    item.drawFace=function(w,h) CardBack.draw(item.backColour,w,h) end
    local card=Pile.new(item,i)
    local index=#view.cards
    card:place(a.x+a.w/cols*(index%cols+0.5),a.y+50+D.HALF_H*scale+math.floor(index/cols)*a.h/2,scale,false,view.width)
    card.bounds={x=a.x+(index%cols)*a.w/cols+6,y=a.y+math.floor(index/cols)*a.h/2+4,w=a.w/cols-12,h=a.h/2-8}
    card:collect(cols,index%cols,view.width/2,entering,view.time,view.reduced,view.width)
    view.cards[#view.cards+1]=card
  end
end
-- A deck pile with its count below and its name above, fitted to the pile, and a white outline
-- round all three while `chosen`: the grid's piles and the lobby seat's chosen deck.
function DeckGrid.drawPile(card,chosen,roomWidth)
  card:draw()
  local bottom=Labels.drawCounter(card)
  local tx,ty=card:target(1,roomWidth,Pile.parallax())
  local titleX,titleY=tx-D.HALF_W*card.baseScale-6,ty-D.HALF_H*card.baseScale-32
  local titleWidth=D.W*card.baseScale+12
  if chosen then
    local left=math.min(titleX,card.homeX-D.HALF_W*card.baseScale)-5
    local right=math.max(titleX+titleWidth,card.homeX+78.1*card.baseScale)+5
    g.push('all');g.setLineWidth(1.5)
    Button.outline(left,titleY-5,right-left,bottom-titleY+10,T.white,1.2)
    g.pop()
  end
  local text,size=Fit.fit(card.item.name,22,titleWidth)
  T.text(text,size,titleX,titleY,titleWidth,T.white)
end
return DeckGrid
