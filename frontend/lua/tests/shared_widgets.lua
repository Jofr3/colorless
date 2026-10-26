-- Headless checks for the widgets the pages share: the raised modal frame,
-- the deck backs, a card's cached scan and the deck pile grid.
package.path='frontend/lua/?.lua;'..package.path
local loads,draws,files={},{},{}
local g={}
love={graphics=g,math={random=function() return 0.5 end},filesystem={getInfo=function(path) return files[path] end}}
g.newImage=function(path)
  if files[path]=='corrupt' then error('Could not decode') end
  local image={path=path,released=false}
  function image:setFilter(min,mag) self.min,self.mag=min,mag end
  function image:getDimensions() return 284,570 end
  function image:getWidth() return 600 end
  function image:getHeight() return 825 end
  function image:release() self.released=true end
  loads[#loads+1]=image
  return image
end
g.newQuad=function(x,y,w,h) return {x=x,y=y,w=w,h=h} end
g.setColor=function() end
g.draw=function(image,a,...)
  local args=type(a)=='table' and {image=image,quad=a,...} or {image=image,a,...}
  draws[#draws+1]=args
end
local T=require('ui.theme')
local Button=require('ui.button')
local CardBack=require('ui.card_back')
local CardFrame=require('ui.card_frame')
local D=require('ui.card_dimensions')
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() self.released=true end} end
local DeckGrid=require('ui.deck_grid')

local function same(a,b) for i=1,4 do if a[i]~=b[i] then return false end end return true end

-- The raised modal frame: emboss 6px below, the JOKER_GREY border, the tray inset by 4.
local panels={}
local panel=Button.panel
Button.panel=function(x,y,w,h,c,r) panels[#panels+1]={x=x,y=y,w=w,h=h,c=c,r=r} end
Button.modalFrameRaised(10,20,300,200)
Button.panel=panel
assert(#panels==3,'Emboss, border and interior')
local e,b,i=panels[1],panels[2],panels[3]
assert(e.x==10 and e.y==26 and e.w==300 and e.h==200 and same(e.c,{0.525,0.546,0.585,1}) and e.r==2.4,'Emboss')
assert(b.x==10 and b.y==20 and b.w==300 and b.h==200 and b.c==T.jokerGrey and b.r==2.4,'Border')
assert(i.x==14 and i.y==24 and i.w==292 and i.h==192 and i.c==T.tray and i.r==2.4,'Interior')

-- Deck backs: one atlas for every caller, red unless blue is asked for.
CardBack.draw('blue',71,95);CardBack.draw(nil,142,190);CardBack.draw('red',142,190)
assert(#loads==1 and loads[1].path=='assets/textures/2x/Enhancers.png' and loads[1].min=='nearest' and loads[1].mag=='nearest')
assert(draws[1].quad.y==380 and draws[1][4]==0.5 and draws[1][5]==0.5,'Blue back at its atlas row and scale')
assert(draws[2].quad.y==0 and draws[3].quad.y==0 and draws[2][4]==1,'Red back by default')

-- Scans: drawn stretched and released, or false so the caller draws a placeholder.
loads,draws={},{}
assert(CardFrame.scan(nil,120,165)==false and CardFrame.scan('gone.png',120,165)==false and #loads==0,'No path or no file')
files['bad.png']='corrupt'
assert(CardFrame.scan('bad.png',120,165)==false and #draws==0,'An unreadable scan')
files['art.png']=true
assert(CardFrame.scan('art.png',120,165)==true)
local scan=draws[1]
assert(scan.image.path=='art.png' and scan[4]==120/600 and scan[5]==165/825,'Stretched to the artwork box')
assert(scan.image.min=='linear' and scan.image.released,'Linear filtering, released after drawing')

-- Deck grid: clamps the page, lays the page out in two rows and draws backs.
local text
local view={cards={},area={x=40,y=100,w=800,h=600},page=5,width=1280,time=0,reduced=true,
  pageText={set=function(_,t) text=t end}}
local matches={}
for n=1,12 do matches[n]={id='deck'..n,name='Deck '..n,count=60,backColour=n==11 and 'blue' or nil} end
DeckGrid.fill(view,matches,10,5,0.5,false)
assert(view.pages==2 and view.page==2 and text=='Page 2/2' and #view.cards==2)
assert(view.cards[1].item.id=='deck11' and view.cards[2].item.id=='deck12')
local first,second=view.cards[1].bounds,view.cards[2].bounds
assert(first.x==46 and first.y==104 and first.w==148 and first.h==292 and second.x==206,'Bounds follow the column')
assert(view.cards[1].homeX==120 and view.cards[1].homeY==150+D.HALF_H*0.5)
draws={}
view.cards[1].item.drawFace(D.W,D.H);view.cards[2].item.drawFace(D.W,D.H)
assert(draws[1].quad.y==380 and draws[2].quad.y==0,'Each pile shows its back')
local kept=view.cards
DeckGrid.release(view)
assert(#view.cards==0 and kept[1].released and kept[2].released,'Release frees every pile')
view.page=1;DeckGrid.fill(view,{},10,5,0.5,false)
assert(view.pages==1 and view.page==1 and #view.cards==0 and text=='Page 1/1','An empty grid is one page')

print('PASS: raised modal frame, shared deck backs, cached scans and the deck pile grid')
