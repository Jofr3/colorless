-- Exercise the original Card:init -> Card:draw -> Sprite:draw_self pipeline,
-- including prep_draw and glued child transforms, not just CardArea targets.
package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
local draws,transform,stack,colour={}, {x=0,y=0,sx=1,sy=1}, {}, {1,1,1,1}
local g={}
local blend,alpha='alpha','alphamultiply'
love={graphics=g,math={random=function() return 0.7 end}}
g.getBlendMode=function() return blend,alpha end
g.setBlendMode=function(mode,multiply) blend,alpha=mode,multiply end
g.push=function() stack[#stack+1]={x=transform.x,y=transform.y,sx=transform.sx,sy=transform.sy} end
g.pop=function() transform=table.remove(stack) end
g.translate=function(x,y) transform.x=transform.x+x*transform.sx;transform.y=transform.y+y*transform.sy end
g.scale=function(x,y) transform.sx=transform.sx*x;transform.sy=transform.sy*(y or x) end
g.rotate=function(r) assert(r==0) end
g.setColor=function(r,g,b,a) colour=type(r)=='table' and r or {r,g,b,a or 1} end
g.setShader=function(s) assert(not s,'Resting decks must not draw a shadow shader') end
g.setCanvas=function() end
g.clear=function() end
g.newCanvas=function(w,h) return {w=w,h=h,setFilter=function(self,min,mag) self.min,self.mag=min,mag end,release=function() end} end
g.newQuad=function(_,_,w,h) return {w=w,h=h} end
g.draw=function(texture,...)
  local a={...};local x,y,r,sx,sy,ox,oy,w,h
  if type(a[1])=='table' then
    w,h=a[1].w,a[1].h;x,y,r,sx,sy=a[2],a[3],a[4],a[5],a[6];ox,oy=0,0
  else
    assert(alpha=='alphamultiply','Native sprite copies retain the source atlas blend mode')
    w,h=texture.w,texture.h;x,y,r,sx,sy,ox,oy=unpack(a)
  end
  assert(r==0)
  draws[#draws+1]={x=transform.x+(x-ox*sx)*transform.sx,y=transform.y+(y-oy*sy)*transform.sy,
    w=w*sx*transform.sx,h=h*sy*transform.sy,shade=colour[1],alpha=colour[4]}
end
local Pile=require('ui.deck_pile')
local source=os.getenv('BALATRO_SOURCE') or '../balatro-source'
for _,file in ipairs({'engine/object.lua','engine/node.lua','engine/moveable.lua','engine/sprite.lua','card.lua','cardarea.lua','functions/misc_functions.lua'}) do
  dofile(source..'/'..file)
end
add_to_drawhash=function() end
-- Exclude card abilities/catalog lookup; retain the actual constructor's scale,
-- sprite construction, child binding, transforms, tint and draw functions.
Card.set_ability=function(self)
  self.ability={}
  self.children.back=Sprite(self.T.x,self.T.y,self.T.w,self.T.h,G.ASSET_ATLAS.centers,{x=0,y=0})
  self.children.back:set_role({major=self,role_type='Glued',draw_major=self})
  self.children.center=Moveable(0,0,0,0)
end
Card.set_base=function() end
Card.set_cost=function() end
local function near(a,b) assert(math.abs(a-b)<0.02,tostring(a)..' != '..tostring(b)) end
for _,count in ipairs({1,9,18,52,60}) do
  for _,scale in ipairs({0.4,0.74,1.2}) do
    local baked
    local p=Pile.new({count=count,drawFace=function(w,h)
      assert(blend=='replace','Copy native texels without discarding transparent edge RGB')
      baked={w,h}
    end},1)
    assert(baked[1]==142 and baked[2]==190,'Preserve the native back raster before display scaling')
    assert(p.texture.min=='linear' and p.texture.mag=='linear','Match Balatro 2x texture filtering')
    local unit=D.W*scale/D.TILE_W
    local cw,ch=D.TILE_W,D.TILE_H
    G={SETTINGS={GRAPHICS={shadows='On'}},STAGE_OBJECT_INTERRUPT=true,
      ROOM={T={w=20,x=0,y=0}},MOVEABLES={},I={CARD={},SPRITE={},MOVEABLE={},CARDAREA={}},
      TIMERS={REAL=0},TILESCALE=1,TILESIZE=unit,C={WHITE={1,1,1,1}},
      ASSET_ATLAS={centers={px=71,py=95,image={getDimensions=function() return 710,665 end}}}}
    local area=CardArea(20-1.1*cw-0.5,5,1.1*cw,0.95*ch,{type='deck',deck_height=Pile.DECK_HEIGHT})
    G.deck=area
    local x,y=(area.T.x+area.T.w/2)*unit,(area.T.y+area.T.h/2)*unit
    p:place(x,y,scale,false,1280)
    for rank=1,count do
      local c=Card(area.T.x,area.T.y,cw,ch,{},{});c.area=area;c.facing='back';c.sprite_facing='back'
      -- Card:init rests every card at 0.95; ours rest at 1 throughout, so
      -- compare relative to each card's own resting size.
      c.T.scale=1;c.VT.scale=1
      area.cards[rank]=c
    end
    area:set_ranks()
    -- Let each card's parallax feed back into the next alignment, as in-game.
    for frame=1,180 do
      area:align_cards()
      for _,c in ipairs(area.cards) do c:calculate_parrallax() end
      p:update(1/60,frame/60,false,false,1280)
    end
    for _,hover in ipairs({false,true}) do
      for frame=1,90 do p:update(1/60,3+frame/60,hover,false,1280) end
      draws={};p:draw();local ours=draws
      assert(blend=='alpha' and alpha=='alphamultiply','Restore blend state after pile drawing')
      draws={}
      for _,layer in ipairs(p.layers) do
        local c=area.cards[layer.rank]
        for k,v in pairs(c.T) do c.VT[k]=v end
        c.VT.scale=c.T.scale+(hover and layer.rank==1 and 0.05 or 0)
        c.children.back:glue_to_major(c)
        c:draw()
      end
      assert(#draws==#ours,'Exactly one sprite per visible rank, without resting shadows')
      for i,draw in ipairs(draws) do
        for _,key in ipairs({'x','y','w','h','alpha','shade'}) do near(ours[i][key],draw[key]) end
      end
    end
  end
end
local discard=Pile.new({kind='discard',count=4,drawFace=function(w,h) assert(w==D.W and h==D.H) end},1)
assert(discard.texture.min=='nearest','Face-up piles retain the scan renderer')
print('PASS: original card/sprite geometry and rank overlays at 5 counts, 3 sizes and idle/hover; native back pixels and filtering')
