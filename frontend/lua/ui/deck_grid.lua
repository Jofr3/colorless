-- One page of deck piles in a two-row grid, as the sandbox chooser and the
-- online picker show them. `view` carries cards, area, page, pageText, time,
-- reduced and width; fill sets view.cards, view.page and view.pages.
local D=require('ui.card_dimensions')
local Pile=require('ui.deck_pile')
local CardBack=require('ui.card_back')
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
return DeckGrid
