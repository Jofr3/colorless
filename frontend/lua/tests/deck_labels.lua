-- Run Balatro's actual UI definition and layout functions as the reference.
package.path='frontend/lua/?.lua;'..package.path
local D=require('ui.card_dimensions')
local prints={}
local font={getWidth=function(_,s) return #s*100 end,getHeight=function() return 200 end,setFilter=function() end}
love={graphics={newFont=function() return font end,setFont=function() end,setColor=function() end,
  push=function() end,pop=function() end,translate=function() end,rotate=function() end,scale=function() end,
  polygon=function() end,print=function(s) prints[#prints+1]=s end}}
local Labels=require('ui.deck_labels')
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
  local function near(a,b) assert(math.abs(a-b)<1e-9,tostring(a)..' != '..tostring(b)) end
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
prints={}; Labels.drawHover(card); assert(#prints==0)
card.hovered=true; Labels.drawHover(card); assert(#prints==4,'Hover badge includes two shadowed text nodes')
prints={}; card.dragging=true; Labels.drawHover(card); assert(#prints==0,'Hover badge must disappear when dragging')
print('PASS: '..(source and 'original UIBox counter geometry at five counts, hover badge geometry, text scales and ' or '')
  ..'shadow/visibility contracts'..(source and '' or ' (source comparisons skipped: no Balatro source)'))
