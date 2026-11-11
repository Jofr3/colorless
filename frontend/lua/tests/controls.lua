package.path='frontend/lua/?.lua;'..package.path
local shift=false
love={keyboard={isDown=function() return shift end}}
local Controls=require('ui.controls')
assert(Controls.backward('left') and Controls.backward('up') and not Controls.backward('tab'))
shift=true; assert(Controls.backward('tab') and not Controls.backward('right'))
local disabled={false,true,false}
local skip=function(i) return disabled[i] end
assert(Controls.cycle(0,1,3,skip)==1)
assert(Controls.cycle(1,1,3,skip)==3)
assert(Controls.cycle(3,1,3,skip)==1)
assert(Controls.cycle(3,-1,3,skip)==1)
local focus,found=Controls.cycle(2,1,3,function() return true end)
assert(focus==2 and not found)

shift=false
-- Tab's ring: with nothing focused, Tab lands on `first`, the page's primary region, and
-- Shift+Tab on the control before it (the last when first is 1).
local none=function() return false end
assert(Controls.ring(0,1,4,none)==1 and Controls.ring(0,-1,4,none)==4,'From nothing: the first control, or Shift+Tab the last')
assert(Controls.ring(0,1,4,none,2)==2 and Controls.ring(0,-1,4,none,2)==1,'A Back listed first is reached last')
assert(Controls.ring(4,1,4,none,2)==1 and Controls.ring(2,1,4,none,2)==3,'Once focused, Tab steps through list order')
assert(Controls.first({{ringLast=true},{},{}})==2 and Controls.first({{},{}})==1,'Leading ringLast controls move the start')
-- Arrows by layout: a 3x2 grid with a wide Back under it and a small button hanging under the
-- first cell that arrows pass over (Tab still reaches it).
local function box(x,y,w,h,extra) local b=extra or {};b.x,b.y,b.w,b.h=x,y,w,h;return b end
local grid={
  box(0,300,300,40),                      -- 1 Back, listed first
  box(0,0,90,120),box(100,0,90,120),box(200,0,90,120),
  box(0,122,30,16,{arrowSkip=true}),      -- 5 hangs under cell 2
  box(0,150,90,120),box(100,150,90,120),  -- 6, 7: the second row is one short
  box(100,150,90,120,{disabled=true}),    -- 8 disabled
}
local function go(focus,key) return (Controls.grid(focus,key,grid,nil,2)) end
assert(go(2,'right')==3 and go(3,'right')==4 and go(4,'right')==4,'Right walks the row and stops at its end')
assert(go(4,'left')==3 and go(2,'left')==2,'Left walks back and stops')
assert(go(2,'down')==6 and go(3,'down')==7,'Down moves to the cell below, past the hanging button')
assert(go(4,'down')==7,'Down from a cell with nothing straight below takes the nearest one below')
assert(go(6,'down')==1 and go(1,'up')==7,'Down from the last row reaches Back; Up from Back the nearest cell above')
assert(go(6,'up')==2 and go(7,'up')==3,'Up moves to the cell above')
assert(go(5,'down')==6 and go(5,'up')==2,'From the hanging button arrows move by its own place')
assert(go(0,'down')==2 and go(0,'right')==2 and go(0,'up')==1 and go(0,'left')==1,'With nothing focused Right and Down land where Tab would, Left and Up where Shift+Tab would')
local _,moved=Controls.grid(4,'right',grid,nil,2);assert(not moved,'An arrow with nothing that way reports no move')
assert(Controls.grid(2,'tab',grid)==2,'Only arrows move by layout')
-- Sideways, a control in the beam (overlapping across the arrow) wins over a nearer one outside it.
local row={box(0,0,40,100),box(300,0,40,100),box(60,101,40,40)}
assert(Controls.grid(1,'right',row)==2,'Right keeps to the row rather than the nearer box below it')
-- move: Tab and Shift+Tab stay linear, arrows go by layout.
assert(Controls.move(2,'tab',grid,nil,2)==3 and Controls.move(4,'tab',grid,nil,2)==5,'Tab keeps list order, hanging button included')
assert(Controls.move(2,'down',grid,nil,2)==6,'move hands arrows to grid')
shift=true;assert(Controls.move(2,'tab',grid,nil,2)==1,'Shift+Tab steps back');shift=false
print('controls ok')
