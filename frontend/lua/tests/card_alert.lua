-- The card alert follows Card:draw's attachment: create_UIBox_card_alert with
-- align 'tri' and offset (-0.1, 0.1), inside the card's top-right corner.
package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
local source=os.getenv('BALATRO_SOURCE') or '../balatro-source'
local function read(path)local f=assert(io.open(source..path));local raw=f:read('*a');f:close();return raw end
local noop=function()end
local fills,draws,transform={},{},{}
love={math={random=function()return 0.5 end},graphics={setColor=noop,setFont=noop,setLineWidth=noop,
 push=function()transform[#transform+1]={}end,pop=function()transform[#transform]=nil end,
 translate=function(x,y)transform[#transform].x,transform[#transform].y=x,y end,rotate=function(r)transform[#transform].r=r end,
 scale=noop,polygon=noop,print=function(_,x,y)draws[#draws+1]={x=x,y=y}end,transformPoint=function(x,y)return x,y end}}
local T=require('ui.theme');T.font=function()return {getWidth=function(_,s)return #s*100 end,getHeight=function()return 200 end}end
local Button=require('ui.button');Button.panel=function(x,y,w,h,c,r)fills[#fills+1]={x=x,y=y,w=w,h=h,c=c,r=r}end
local Card=require('ui.card');Card.rebuild=function(self)self.texture={}end
local Alert=require('ui.card_alert')
-- Card:draw's attachment arguments, straight from the source.
local card=read('/card.lua')
assert(card:find('definition = create_UIBox_card_alert(), \n                    config = {align=(self.ability.set == \'Voucher\' and (self.config.center.order%2)==1) and "tli" or "tri",',1,true))
assert(card:find('offset = {x = (self.ability.set == \'Voucher\' and (self.config.center.order%2)==1) and 0.1 or -0.1, y = 0.1}',1,true))
-- Deliberate deviation: the badge straddles the corner, centred 0.1 tiles in.
assert(math.abs(Alert.card.x-(0.21-0.1))<1e-9 and math.abs(Alert.card.y-(0.1-0.21))<1e-9)
-- moveable.lua 'tri': x = offset.x + major.w - self.w; y = offset.y (inner).
local c=Card.new({id='x',name='X',illegal=true},1);c:place(400,300,0.84,false)
local ox,oy=Alert.cardOffset(c)
local unit=c.unit;local halfW,halfH=D.HALF_W*0.84,D.HALF_H*0.84
assert(math.abs(ox-(-halfW+(Alert.card.x+2*halfW/unit-0.42)*unit))<1e-9,'tri aligns the badge to the right edge plus the offset')
assert(math.abs(oy-(-halfH+Alert.card.y*unit))<1e-9,'tri aligns the badge to the top edge plus the offset')
-- Surface tuning: piles sit further in than the default, gallery cards further out.
assert(Alert.pile.x<Alert.card.x and Alert.pile.y>Alert.card.y and Alert.gallery.x>Alert.card.x and Alert.gallery.y<Alert.card.y)
local gx,gy=Alert.cardOffset(c,Alert.gallery)
assert(math.abs((gx-ox)-(Alert.gallery.x-Alert.card.x)*unit)<1e-9 and math.abs((gy-oy)-(Alert.gallery.y-Alert.card.y)*unit)<1e-9,'cardOffset honours a surface offset')
c.angle=0.1
Alert.drawOnCard(c,1,true,1280)
assert(transform[1]==nil,'The card transform is popped')
assert(#fills==2 and fills[2].x==ox and fills[2].y==oy and fills[2].w==0.42*unit and fills[1].y==oy+0.05*unit,'Badge and emboss are drawn in card space')
assert(math.abs(fills[2].r-0.6*unit/20)<1e-9,'Corner res follows the card unit')
assert(#draws>=1 and math.abs(draws[#draws].x-(ox+0.21*unit))<4 and draws[#draws].y<oy+0.21*unit,'The ! is centred in the badge and lifted by the font offset')
-- Menu badges (60px tiles) use the darker red_bad; cards keep plain red.
fills={};Alert.draw(0,0,60,0,true,1280,true);assert(math.abs(fills[2].c[1]-T.red[1]*0.9)<1e-9 and fills[2].w==25.2)
fills={};Alert.draw(0,0,60,0,true,1280,false);assert(fills[2].c[1]==T.red[1])
print('PASS: card alerts follow Card:draw attachment, card transform and unit')
