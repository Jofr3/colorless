-- The deck picker the sandbox chooser and the lobby share: the player's decks searched by name,
-- a page of piles at a time (ui/deck_grid.lua) in a dark tray, its pager, and the pile under the
-- pointer or keyboard focus lifting. `view` is the page; it keeps its own search field, filters,
-- empty text and what a pile does when chosen.
local T=require('ui.theme')
local Button=require('ui.button')
local Pager=require('ui.pager')
local DeckGrid=require('ui.deck_grid')
local DeckPicker={}
-- The pager, anchored at the room's centre.
DeckPicker.PAGER={face=-119,w=238,arrow=32,h=36,textScale=0.4}
local TRAY_EMBOSS={T.panel[1]*0.7,T.panel[2]*0.7,T.panel[3]*0.7,1}
-- A capital in Latin-1 or Latin Extended-A to its small letter, as JavaScript's toLowerCase maps
-- it; any other code point as it is. İ, whose small form is two code points, stays.
local function smallLetter(cp)
  if cp>=0xC0 and cp<=0xDE and cp~=0xD7 then return cp+32 end
  if cp==0x178 then return 0xFF end
  if cp%2==0 and (cp>=0x100 and cp<=0x136 and cp~=0x130 or cp>=0x14A and cp<=0x176) then return cp+1 end
  if cp%2==1 and (cp>=0x139 and cp<=0x147 or cp>=0x179 and cp<=0x17D) then return cp+1 end
  return cp
end
-- `text` in small letters for a search, as the deck library's (src/lua/library.ts) folds it for
-- ASCII, Latin-1 and Latin Extended-A; Lua's lower() alone leaves É as it is.
function DeckPicker.fold(text)
  return (text:lower():gsub('([\195-\197])([\128-\191])',function(lead,tail)
    local cp=smallLetter((lead:byte()-192)*64+tail:byte()-128)
    return string.char(192+math.floor(cp/64),128+cp%64)
  end))
end
-- The decks whose names hold the query, trimmed, ignoring case and taken literally, and that
-- `keep` (when given) keeps.
function DeckPicker.matches(decks,query,keep)
  local out={}
  local q=DeckPicker.fold(query):match('^%s*(.-)%s*$')
  for _,d in ipairs(decks) do
    if (not keep or keep(d)) and (q=='' or DeckPicker.fold(d.name):find(q,1,true)) then out[#out+1]=d end
  end
  return out
end
-- Turns `delta` pages, wrapping round, rebuilds the page and says the page it lands on.
function DeckPicker.turn(view,delta)
  local page=view.page
  view.page=(view.page-1+delta+view.pages)%view.pages+1;view:makeCards(true);view:build();view.focus=0;view.pressed=nil
  if view.page~=page then view.callbacks.announce(Pager.page(view.page,view.pages)) end
end
-- Lifts the pile whose control (in `controls`, with .card) is under the pointer, or has keyboard
-- focus while the pointer is over none, with the paper sound; none while not `live`.
function DeckPicker.update(view,controls,dt,time,reduced,live)
  for i,card in ipairs(view.cards) do
    local active=live and ((controls[view.hover] or {}).card==i or view.hover==0 and (controls[view.focus] or {}).card==i)
    if active and not card.hovered then
      if not card.motion.juice then card:juiceUp(time,0.05,0.03,reduced) end
      view.callbacks.feedback('paper1')
    end
    card:update(dt,time,active,reduced,view.width)
  end
end
-- The pager's arrows at height y, made by make(label,x,y,w,h,dir) (ui/pager.lua).
function DeckPicker.arrows(view,y,make)
  return Pager.arrows(DeckPicker.PAGER,view.width/2,y,view.page,view.pages,make)
end
-- The tray behind the piles: Balatro's G.C.BLACK with its emboss.
function DeckPicker.drawTray(a)
  Button.panel(a.x,a.y+3,a.w,a.h,TRAY_EMBOSS)
  Button.panel(a.x,a.y,a.w,a.h,T.panel)
end
-- Each pile, outlined when its deck's id is `chosen`, then `decorate(card)` over it when given.
function DeckPicker.drawPiles(view,chosen,decorate)
  for _,card in ipairs(view.cards) do
    DeckGrid.drawPile(card,card.item.id==chosen,view.width)
    if decorate then decorate(card) end
  end
end
-- The pager's face at height y.
function DeckPicker.drawPager(view,y)
  Pager.draw(DeckPicker.PAGER,view.width/2,y,view.pageText,true,view.mx,view.my,view.time,view.reduced,view.width)
end
return DeckPicker
