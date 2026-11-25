-- Run Balatro's actual UI definition and layout functions as the reference.
package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
local prints,draws={},{}
local tx,ty,stack,colour=0,0,{},nil
local font={getWidth=function(_,s) return #s*100 end,getHeight=function() return 200 end,setFilter=function() end}
love={graphics={newFont=function() return font end,setFont=function() end,
  setColor=function(r,g,b,a) colour=type(r)=='table' and r or {r,g,b,a} end,
  push=function() stack[#stack+1]={tx,ty} end,
  pop=function() local top=table.remove(stack); tx,ty=top[1],top[2] end,
  translate=function(dx,dy) tx,ty=tx+(dx or 0),ty+(dy or 0) end,
  rotate=function() end,scale=function() end,polygon=function() end,
  print=function(s,x,y,_,sx,sy)
    prints[#prints+1]=s
    draws[#draws+1]={text=s,x=tx+(x or 0),y=ty+(y or 0),sx=sx,sy=sy,colour=colour}
  end}}
local Labels=require('ui.deck_labels')
local T=require('ui.theme')
local Display=require('ui.display')
local function near(a,b) assert(math.abs(a-b)<1e-9,tostring(a)..' != '..tostring(b)) end
local function reset() prints,draws={},{}; tx,ty,stack,colour=0,0,{},nil end
-- Without Balatro's source the geometry comparisons are skipped; the draw
-- contracts at the end still run.
local source=require('tests.support.balatro_source').optional()
if source then
  Moveable={extend=function() return {} end}
  dofile(source..'/engine/ui.lua')
  UIElement.__index=UIElement
  local file=assert(io.open(source..'/cardarea.lua')); local code=file:read('*a'); file:close()
  G={UIT={R='R',C='C',ROOT='ROOT',B='B',T='T',O='O',padding=0},C={CLEAR={},WHITE={},BLACK={}},
    LANG={font={FONT=font,squish=1,FONTSCALE=0.1,TEXT_HEIGHT_SCALE=0.83}},TILESCALE=3,TILESIZE=20}
  localize=function(key) return key=='k_view' and 'View' or 'Deck' end
  adjust_alpha=function() return {} end
  local function definition(marker,prefix,self)
    local start=assert(code:find(marker,1,true))
    local block=assert(code:sub(start+#marker):match('%b{}'))
    return assert(loadstring('return function(self) '..(prefix or '')..' return '..block..' end'))()(self).definition
  end
  local start=assert(code:find('local card_count = self ~=',1,true))
  local finish=assert(code:find('self.children.area_uibox =',start,true))
  local counterPrefix=code:sub(start,finish-1)
  local function layout(def)
    local box=setmetatable({}, {__index=UIBox})
    local texts={}
    local function tree(d)
      local node=setmetatable({UIT=d.n,config=d.config,ARGS={},children={},role={offset={}}},UIElement)
      node.set_values=function(self,t)
        self.T={x=t.x,y=t.y,w=t.w,h=t.h}; self.role.offset={x=t.x,y=t.y}
      end
      if d.config.mid then box.mid=node end
      if d.n==G.UIT.T then texts[#texts+1]=node end
      for _,child in ipairs(d.nodes or {}) do node.children[#node.children+1]=tree(child) end
      return node
    end
    local root=tree(def)
    UIBox.calculate_xywh(box,root,{x=0,y=0})
    root:set_wh(); root:set_alignments()
    local mid=box.mid or root
    local cx,cy=mid.role.offset.x+mid.T.w/2,mid.role.offset.y+mid.T.h/2
    for _,node in ipairs(texts) do
      node.x,node.y=node.role.offset.x-cx,node.role.offset.y-cy
    end
    return texts,root
  end
  for _,count in ipairs({0,9,52,60,120}) do
    local area={T={w=1.1*(D.TILE_W),h=0.95*(D.TILE_H)},config={card_count=count,card_limit=count}}
    G.deck=area
    local expected=layout(definition('self.children.area_uibox = UIBox',counterPrefix,area))
    local actual=Labels.counter(count)
    for i,node in ipairs(actual) do
      local ref=expected[i]
      assert(node.text==ref.config.text); near(node.scale,ref.config.scale)
      near(node.x,ref.x); near(node.y,ref.y); near(node.w,ref.T.w); near(node.h,ref.T.h)
      assert(not ref.config.shadow,'Deck counter has no shadow')
    end
  end
  local expected,root=layout(definition('self.children.view_deck = UIBox',nil,{cards={{}}}))
  local actual,w,h=Labels.hover()
  near(w,root.children[1].T.w); near(h,root.children[1].T.h)
  for i,node in ipairs(actual) do
    local ref=expected[i]
    assert(node.text==ref.config.text); near(node.scale,ref.config.scale)
    near(node.x,ref.x); near(node.y,ref.y); near(node.w,ref.T.w); near(node.h,ref.T.h)
  end
end
local card={item={count=52},unit=60,homeX=100,homeY=100,x=110,y=90,angle=0}
Labels.drawCounter(card); assert(#prints==3,'Counter draws each text exactly once, without shadow')
local prizeNodes=Labels.hover({'View','Prize'})
assert(prizeNodes[1].text=='View' and prizeNodes[2].text=='Prize','The badge takes its two words')
prints={}; Labels.drawHover(card); assert(#prints==0)
card.hovered=true; Labels.drawHover(card); assert(#prints==4,'Hover badge includes two shadowed text nodes')
prints={}; card.dragging=true; Labels.drawHover(card); assert(#prints==0,'Hover badge must disappear when dragging')

Display.set({portrait=false,scale=1,collection=1})
near(Labels.scaleFor(60),0.3)
near(Labels.scaleFor(60,nil,0.2),0.3)
near(Labels.scaleFor(60,nil,0.5),0.5)
Display.set({portrait=true,scale=0.5,collection=0.4})
near(Labels.scaleFor(60),Display.MIN_TEXT_CSS/(60*0.4))
near(Labels.scaleFor(60,0.5),Display.MIN_TEXT_CSS/(60*0.5))
near(Labels.scaleFor(200,0.5),0.3)
near(Labels.scaleFor(60,0.5,0.6),0.6)
Display.set({portrait=false,scale=1,collection=1})

local n3,b3=Labels.stackCounter(3)
assert(#n3==1 and n3[1].text=='x3'); near(n3[1].scale,0.3)
local w3,h3=Labels.metric('x3',0.3)
near(n3[1].w,w3); near(n3[1].h,h3)
near(n3[1].y,0.95*D.TILE_H/2+0.03); near(b3,n3[1].y+n3[1].h+0.03)
local counterNodes=Labels.counter(3,3,0.3)
local lastCounter=counterNodes[#counterNodes]
near(n3[1].x+n3[1].w,lastCounter.x+lastCounter.w)
local n3Large,b3Large=Labels.stackCounter(3,0.5)
near(n3Large[1].scale,0.5); assert(n3Large[1].w>n3[1].w and b3Large>b3)
local n12=Labels.stackCounter(12)
assert(#n12==1 and n12[1].text=='x12')
near(n12[1].x+n12[1].w,n3[1].x+n3[1].w); assert(n12[1].x<n3[1].x)

local stackCard={item={count=1},unit=60,homeX=100,homeY=100}
reset(); assert(Labels.drawStackCount(stackCard)==nil and #prints==0 and #draws==0,'count=1 is a no-op')
stackCard.item={}
reset(); assert(Labels.drawStackCount(stackCard)==nil and #prints==0 and #draws==0,'absent count is a no-op')
stackCard.item=nil
reset(); assert(Labels.drawStackCount(stackCard)==nil and #prints==0 and #draws==0,'missing item is a no-op')

local cardBottom=stackCard.homeY+0.95*D.TILE_H/2*stackCard.unit
local rightEdge=stackCard.homeX+0.55*D.TILE_W*stackCard.unit
stackCard.item={count=3}
reset()
local bottom3=Labels.drawStackCount(stackCard)
assert(#prints==1 and prints[1]=='x3' and #draws==1,'count=3 emits one unshadowed x3 print')
assert(#stack==0)
local d3=draws[1]
assert(d3.text=='x3' and d3.colour==T.white,'drawStackCount defaults to T.white')
assert(d3.y>cardBottom,'stack count sits below card bottom')
assert(d3.x>stackCard.homeX and d3.x+font:getWidth(d3.text)*d3.sx<=rightEdge,'x3 is right-aligned inside card right edge')
assert(d3.y+font:getHeight()*d3.sy<=bottom3,'x3 glyph bottom stays within returned bottom')

local customColour={0.9,0.5,0.2,1}
reset()
local bottomCustom=Labels.drawStackCount(stackCard,{colour=customColour})
assert(#prints==1 and draws[1].colour==customColour,'drawStackCount honours opts.colour')
near(bottomCustom,bottom3)

reset()
local bottom12=Labels.drawStackCount(stackCard,{count=12})
assert(#prints==1 and prints[1]=='x12' and #draws==1,'count=12 emits x12')
local d12=draws[1]
assert(d12.x<d3.x,'x12 starts further left than x3')
assert(d12.x+font:getWidth(d12.text)*d12.sx<=rightEdge,'x12 stays within card right edge')
near(d12.x+font:getWidth(d12.text)*d12.sx,d3.x+font:getWidth(d3.text)*d3.sx)
assert(d12.y+font:getHeight()*d12.sy<=bottom12,'x12 glyph bottom stays within returned bottom')

local drop=Labels.stackDrop(stackCard.unit)
assert(drop>0)
near(drop,(0.08+0.03+0.3*0.83+0.03)*stackCard.unit)
near(drop,bottom3-cardBottom)
local wideDrop=Labels.stackDrop(stackCard.unit,0.2)
near(wideDrop-drop,(0.2-0.08)*stackCard.unit)
near(Labels.stackDrop(stackCard.unit*2),drop*2)
Display.set({portrait=true,scale=0.5,collection=1})
local phoneScale=Labels.scaleFor(stackCard.unit,Display.scale)
local phoneDrop=Labels.stackDrop(stackCard.unit,0.12)
assert(phoneScale>0.3 and phoneDrop>Labels.stackDrop(stackCard.unit,0.12,2))
near(phoneDrop,(0.12+0.03+phoneScale*0.83+0.03)*stackCard.unit)
reset()
local phoneBottom=Labels.drawStackCount(stackCard,{gapTiles=0.12})
near(phoneBottom-cardBottom,phoneDrop)
Display.set({portrait=false,scale=1,collection=1})

print('PASS: '..(source and 'original UIBox counter geometry at five counts, hover badge geometry, text scales and ' or '')
  ..'shadow/visibility and stack counter contracts'..(source and '' or ' (source comparisons skipped: no Balatro source)'))
