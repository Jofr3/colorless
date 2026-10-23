package.path='frontend/lua/?.lua;'..package.path
love={math={random=function()return 0.5 end},filesystem={getInfo=function()return false end},
 graphics={newFont=function(_,size)return {getWidth=function(_,s)return #s*size/2 end,setFilter=function()end}end},
 keyboard={isDown=function()return false end}}
local Card=require('ui.card')
Card.rebuild=function(self)self.texture={release=function(t)t.released=true end}end
local Builder=require('ui.builder');local Codec=require('ui.codec')
for _,view in ipairs({'list','cards'})do
 for _,remove in ipairs({false,true})do
  for _,reduced in ipairs({false,true})do
   local commands={}
   local b=Builder.new({command=function(raw)commands[#commands+1]=Codec.fields(raw)end,feedback=function()end,announce=function()end})
   b.reduced=reduced;b:layout(1280,800);b.phase='ready';b.deckView=view
   b.deck={{id='test',name='Test card',kind='Pokemon',quantity=3,remaining=1}};b:build()
   -- Grid cards deal in from the row centre; press once they have landed.
   for frame=1,60 do b:update(1/60,frame/60-1,0,0,reduced)end
   local control
   for _,c in ipairs(b.controls)do if c.action==(view=='list' and 'detail' or 'deck-card')then control=c;break end end
   local x,y=control.x+control.w/2,control.y+control.h/2
   b:mousepressed(x,y)
   local dropX,dropY=remove and 500 or 1100,530
   for frame=1,30 do b:update(1/60,frame/60,dropX,dropY,reduced)end
   local c=assert(b.dragCard);local texture=c.texture;local releasedX,releasedY=c.x,c.y
   local before=#commands
   b:mousereleased(dropX,dropY)
   assert(b.dragCard==c and c.returning and not c.dragging and not texture.released,'Release must retain the returning card')
   assert(#commands==before+(remove and 1 or 0),'A cancelled drop must not modify the deck')
   if remove then assert(commands[#commands][1]=='remove' and commands[#commands][2]=='test')end
   b:makeCards(true) -- catalog refresh must not discard an ongoing return
   assert(b.dragCard==c)
   b:update(1/60,31/60,dropX,dropY,reduced)
   if not reduced then
    assert(b.dragCard==c and not texture.released,'Card must remain visible while travelling')
    assert(math.abs(c.x-c.homeX)+math.abs(c.y-c.homeY)>1,'Return must not snap to its origin')
    assert(c.x~=releasedX or c.y~=releasedY,'Return must advance with the motion engine')
   end
   for frame=32,180 do b:update(1/60,frame/60,dropX,dropY,reduced)end
   assert(not b.dragCard and texture.released,'Settled card must release its temporary texture')
   assert(#commands==before+(remove and 1 or 0),'Animation must not send additional mutations')
  end
 end
end
print('PASS: list/grid drag return, cancelled/accepted drops, refresh survival, reduced motion and texture cleanup')
