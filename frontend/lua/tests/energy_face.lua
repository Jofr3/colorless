-- Imageless Energy cards get a generated face in their type's colour.
package.path='frontend/lua/?.lua;'..package.path
local fills,prints,polys={},{},0
local colour={1,1,1,1}
love={math={random=function()return 0.5 end},graphics={
  newFont=function(_,size)return {getWidth=function(_,v)return #v*size*0.5 end,getHeight=function()return size end,setFilter=function()end}end,
  setColor=function(...)colour={...}end,setFont=function()end,push=function()end,pop=function()end,translate=function()end,scale=function()end,
  rectangle=function(_,x,y,w,h)fills[#fills+1]={x=x,y=y,w=w,h=h,c=colour}end,polygon=function()polys=polys+1 end,
  print=function(t)prints[#prints+1]=t end,printf=function(t)prints[#prints+1]=t end,
},keyboard={isDown=function()return false end},filesystem={getInfo=function()return nil end}}
local T=require('ui.theme')
T.box=function(x,y,w,h,c)fills[#fills+1]={x=x,y=y,w=w,h=h,c=c,box=true}end
T.text=function(t)prints[#prints+1]=t end
local Energy=require('ui.energy')
local Card=require('ui.card');Card.rebuild=function(self)self.texture={release=function()end}end
local Builder=require('ui.builder')
local b=Builder.new({command=function()end,feedback=function()end,announce=function()end});b.art={}
b:face({id='sve-007',name='Darkness Energy',kind='Energy',subtype='Basic Energy'},142,190)
local same=function(a,c)for i=1,3 do assert(math.abs(a[i]-c[i])<1e-9)end end
same(fills[2].c,Energy.colours.Darkness)
assert(fills[2].x==4 and fills[2].w==134 and fills[1].c==T.paper,'Paper border around the type-coloured field')
assert(polys>0,'The pixel pip is drawn')
assert(prints[1]=='Darkness Energy' and prints[2]=='Basic Energy','Name on top, subtype at the foot')
fills={};prints={};polys=0
b:face({id='x',name='Mystery Trainer',kind='Trainer',subtype='Item'},142,190)
assert(fills[2].c==T.ink and prints[1]=='Mystery Trainer','Other imageless cards keep the dark placeholder')
print('PASS: imageless Energy cards draw a generated type-coloured face')
