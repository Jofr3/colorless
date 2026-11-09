-- The hot-seat history row's tooltips (audit SM12): after about 400 ms of hover or keyboard focus
-- on an icon (Undo turn, Undo action, New game, Redo action, Redo turn) its spoken label shows in
-- a card-popup frame beside it: never over the icon, inside the board in landscape, portrait and
-- a short landscape phone, grown in with motion and whole under reduced motion, gone once the
-- pointer or focus leaves, never on a touch screen's tap, and never taking a click.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub')
Stub.install()
love.keyboard={isDown=function() return false end}
-- m6x11plus's real proportions at its 200 px atlas (about 0.4 em per glyph, 1 em tall), so the
-- labels measure about as wide as they draw.
local T=require('ui.theme')
local glyphs={getWidth=function(_,s) return #tostring(s)*80 end,getHeight=function() return 200 end,setFilter=function() end,
  getWrap=function(_,s) return #tostring(s)*80,{tostring(s)} end}
T.font=function() return glyphs end
local Card=require('ui.card');Card.rebuild=function(self) self.texture={release=function() end} end
local Display=require('ui.display')
local Simulator=require('ui.simulator')
-- What the frame draws: each popup frame and DynaText label.
local Popup=require('ui.popup')
local Dyna=require('ui.dynatext')
local frames,labels={},{}
local frame,static=Popup.frame,Dyna.static
Popup.frame=function(x,y,w,h) frames[#frames+1]={x=x,y=y,w=w,h=h};return frame(x,y,w,h) end
Dyna.static=function(text,scale,...) labels[#labels+1]={text=text,scale=scale};return static(text,scale,...) end
local function drawn() frames,labels={},{} end
local function check(ok,message) if not ok then error(message,2) end end
local shader={hasUniform=function() return true end,send=function() end}
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader,background=shader}
local said={}
local sim=Simulator.new({command=function() end,announce=function(text) said[#said+1]=text end,feedback=function() end,
  settings=function() end,jiggle=function() end})
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
local LABELS={'Undo turn','Undo action','New game','Redo action','Redo turn'}
local revision=100
local function history()
  revision=revision+1
  local rows={row(revision,'ready','Player 1','Player 2',1,'turn:action','','Your turn','',0,0,'you','you','p1',0,0,0,'','','','tooltip-match'),
    row('A','end','End turn','red',false,'primary')}
  -- Redo action and Redo turn are disabled, as with nothing to redo.
  for i,label in ipairs(LABELS) do rows[#rows+1]=row('A','history'..i,label,'red',i>3,'minor') end
  -- A full hand: in portrait it fans right above the history row.
  for i=1,7 do rows[#rows+1]=row('C','hand'..i,'sv01-033','Houndour','you','hand',i-1,'false','Pokemon','','Basic','',0,'','','','Fire','false',i-1) end
  sim:sync(table.concat(rows,'\n'))
end
local clock=10
local mouseX,mouseY=-1000,-1000
local function run(seconds,reduced)
  local steps=math.floor(seconds*60+0.5)
  for _=1,steps do clock=clock+1/60;sim:update(1/60,clock,mouseX,mouseY,reduced or false);sim:draw(shaders) end
end
-- The pointer over a control's face centre, in the canvas coordinates update takes.
local function hover(b)
  if not b then mouseX,mouseY=-1000,-1000;return end
  mouseX,mouseY=(b.x+b.w/2)*sim.zoom+sim.ox,(b.y+b.h/2)*sim.zoom+sim.oy
end
local function icons()
  local out={}
  for i,b in ipairs(sim.controls) do if b.token and b.token:match('^history') then out[#out+1]={index=i,b=b} end end
  return out
end
local function control(action) for i,b in ipairs(sim.controls) do if b.label==action then return i,b end end end
-- What the tooltip draws now: its frame's box (shadow included) and label, or nil.
local function shown() return sim.tooltip:box(sim.boardW,sim.boardH) end
-- A button's face as drawn: lifted 1.8 at rest, its panel 3 below its bounds.
local function clear(box,b)
  return box.y+box.h+4<=b.y-2 or box.y>=b.y+b.h+3 or box.x+box.w<=b.x or box.x>=b.x+b.w
end
local layouts={
  {name='landscape',w=1280,h=800,display={scale=1,portrait=false,coarse=false}},
  {name='portrait',w=480,h=850,display={scale=390/480,portrait=true,coarse=false}},
  {name='844x390',w=1280,h=800,display={scale=390/800,portrait=false,coarse=false}},
}
for _,view in ipairs(layouts) do
  Display.set(view.display)
  sim:layout(view.w,view.h);sim:open(false);history();hover(nil);run(0.1)
  local list=icons()
  check(#list==5,view.name..': the history row draws five icons')
  for k,entry in ipairs(list) do
    local b=entry.b
    check(b.label==LABELS[k] and b.tooltip,view.name..': '..LABELS[k]..' carries a tooltip')
    -- Hover: nothing for the first 300 ms, then the label beside the icon.
    hover(b);run(0.3)
    check(not shown(),view.name..': '..b.label..' shows no tooltip before the delay')
    local under=sim:hit(mouseX,mouseY)
    run(0.15)
    local box=shown()
    check(box and box.label==b.label,view.name..': '..b.label..' shows its label after about 400 ms'..(b.disabled and ' (disabled too)' or ''))
    check(box.x>=0 and box.y>=0 and box.x+box.w<=sim.boardW and box.y+box.h+4<=sim.boardH,view.name..': '..b.label..' tooltip stays on the board')
    check(clear(box,b),view.name..': '..b.label..' tooltip does not cover its icon')
    -- Nor any control without a tooltip: in landscape End turn sits right above the row and Log
    -- below it (QA7 bug 1). A fellow icon may be covered; its own tooltip takes over on it.
    for _,other in ipairs(sim.controls) do
      check(other.tooltip or clear(box,other),view.name..': '..b.label..' tooltip does not cover '..other.label)
    end
    -- Nor a card: in portrait the hand fans right above the row (FU5).
    for _,c in ipairs(sim.cards) do
      local hw,hh=c:halfExtents()
      check(clear(box,{x=c.x-hw,y=c.y-hh+2,w=2*hw,h=2*hh-5}),view.name..': '..b.label..' tooltip does not cover the card '..c.item.name)
    end
    check(box.textScale*60*Display.scale>=12-1e-9,view.name..': its label is at least 12 CSS px')
    drawn();sim:draw(shaders)
    local framed,named=false,false
    for _,f in ipairs(frames) do if f.x==box.x and f.y==box.y and f.w==box.w and f.h==box.h then framed=true end end
    for _,t in ipairs(labels) do if t.text==b.label and t.scale==box.textScale then named=true end end
    check(framed and named,view.name..': '..b.label..' tooltip draws its frame and label')
    run(0.15);check(shown().scale==1,view.name..': it has grown in soon after')
    -- It takes no clicks: the pointer hits what it did before it showed.
    check(sim:hit(mouseX,mouseY)==under,view.name..': the icon still answers the pointer')
    hover(nil);run(1/60)
    check(not shown(),view.name..': '..b.label..' tooltip leaves with the pointer')
  end
  -- Keyboard focus shows it too, and moving focus takes it away.
  local first=list[1]
  sim.focus=first.index;sim.focusKey=nil;hover(nil);run(0.3)
  check(not shown(),view.name..': no tooltip before the delay on focus')
  run(0.15);local box=shown()
  check(box and box.label=='Undo turn',view.name..': keyboard focus on Undo turn shows its tooltip')
  sim:keypressed('tab');run(1/60)
  local now=shown()
  check(not now or now.label~='Undo turn',view.name..': moving focus takes the tooltip away')
  sim.focus=0
  -- Other controls have none.
  local _,endTurn=control('End turn')
  hover(endTurn);run(0.6);check(not shown(),view.name..': End turn, which has its words, shows no tooltip')
  hover(nil);run(1/60)
end
-- With motion it grows in; under reduced motion it appears whole.
Display.set(layouts[1].display)
sim:layout(1280,800);sim:open(false);history();hover(nil);run(0.1)
local undo=icons()[2].b
hover(undo);run(0.43)
local growing=shown();check(growing and growing.scale<1,'With motion the tooltip grows in')
run(0.2);check(shown().scale==1,'and settles at full size')
hover(nil);run(1/60);hover(undo);run(0.43,true)
local still=shown();check(still and still.scale==1,'Under reduced motion it appears whole, with no growth')
-- A touch screen shows none, however long a finger rests; keyboard focus still does.
hover(nil);run(1/60)
Display.set({coarse=true})
hover(undo);run(1);check(not shown(),'A touch screen shows no tooltip for a tap or a resting finger')
hover(nil);sim.focus=icons()[2].index;run(0.5)
check(shown() and shown().label=='Undo action','Keyboard focus shows it on a touch screen')
Display.set({coarse=false})
-- An overlay over the table hides it.
sim.focus=0;hover(undo);run(0.5);check(shown(),'shown before the overlay')
sim:openOptions();run(1/60);check(not shown(),'An overlay over the table hides the tooltip')
-- Placement where above does not fit: below, then beside, always inside the board.
local Tooltip=require('ui.tooltip')
local function placed(b) local x,y=Tooltip.place(b,100,30,480,850);return {x=x,y=y,w=100,h=30} end
local top={x=0,y=2,w=44,h=44}
local box=placed(top);check(box.y>=top.y+top.h+3 and box.x==4,'A control at the top edge gets its tooltip below, inside the left edge')
local tall={x=10,y=4,w=44,h=840}
box=placed(tall);check(box.x>=tall.x+tall.w and clear(box,tall) and box.y>=4,'A control with no room above or below gets it on its right')
local right={x=430,y=4,w=46,h=840}
box=placed(right);check(box.x+box.w<=right.x and box.x>=4,'At the right edge it goes on the left')
print('PASS: history tooltips after 400 ms of hover or focus, beside the icon and on the board, still under reduced motion, none on touch')
