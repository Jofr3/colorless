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
print('controls ok')
