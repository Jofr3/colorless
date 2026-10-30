-- Small page controls get larger hit areas, never larger buttons (audit PG8, QA11; the user's
-- rule: a button keeps its look, text, size and place). The library's Manage, the builder's
-- deck-row - and + and its Retry / Retry save answer the pointer over an invisible rectangle of
-- about 34x34 virtual pixels, at least 24 CSS pixels where the screen is small, around the
-- unchanged face. No hit area reaches another control's, and the press still lands.
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local Card=require('ui.card');Card.rebuild=function(self) self.texture={release=function() end} end
local Library=require('ui.library')
local Builder=require('ui.builder')
local Codec=require('ui.codec')
local Display=require('ui.display')
local HitArea=require('ui.hit_area')
local Wire=require('ui.wire_fields')
local B=Wire.builder
local D=require('ui.card_dimensions')
local function check(ok,message) if not ok then error(message,2) end end
local function rect(c) return c.hitRect or c end
local function contains(outer,inner)
  return outer.x<=inner.x and outer.y<=inner.y and outer.x+outer.w>=inner.x+inner.w and outer.y+outer.h>=inner.y+inner.h
end
-- No grown hit area reaches another control's hit area or face.
local function apart(controls,where)
  for i,a in ipairs(controls) do
    for j=i+1,#controls do
      local b=controls[j]
      if a.hitRect or b.hitRect then
        check(not HitArea.overlaps(rect(a),rect(b)),('%s: %s (%s) reaches %s (%s)'):format(where,a.action,a.label or '',b.action,b.label or ''))
      end
    end
  end
end
-- The screens PG8 and QA11 name: desktop, a phone sideways and a phone upright.
local SCREENS={
  {name='1280x800',w=1280,h=800,display={scale=1,collection=0.9,portrait=false}},
  {name='844x390',w=1280,h=800,display={scale=0.4875,collection=0.4875,portrait=false}},
  {name='390x844',w=480,h=850,display={scale=0.8125,collection=0.8125,portrait=true}},
}
local function minimum(screen) return math.max(34,24/screen.display.collection) end

-- The library's Manage.
local function librarySnapshot(revision,count)
  local lines={table.concat({revision,'ready','0','','','name-asc','1','1',count,''},'\t')}
  for i=1,count do lines[#lines+1]='D\tdeck'..i..'\tDeck '..i..'\t60\t0\t' end
  return table.concat(lines,'\n')
end
for n,screen in ipairs(SCREENS) do
  Display.set(screen.display)
  local sent={}
  local library=Library.new({command=function(raw) sent[#sent+1]=Codec.fields(raw) end,announce=function() end,feedback=function() end})
  library:layout(screen.w,screen.h);library:sync(librarySnapshot(n,screen.w<600 and 4 or 12));library:layout(screen.w,screen.h)
  local where='library '..screen.name
  local count=0
  for i,b in ipairs(library.controls) do
    if b.action=='manage' then
      count=count+1
      local card=library.cards[b.card]
      local s=card.baseScale
      check(b.x==card.homeX-D.HALF_W*s and b.y==card.homeY+D.HALF_H*s+2 and b.w==40 and b.h==24,where..': Manage keeps its face')
      check(b.hitRect and contains(b.hitRect,b),where..': Manage has a hit area around its face')
      check(b.hitRect.h>=math.min(minimum(screen),30),where..': Manage is easier to hit ('..b.hitRect.h..' tall)')
      check(b.hitRect.h*screen.display.collection>=20,where..': at least 20 CSS px tall')
      -- A press in the grown part, under the face, opens the Manage dialog.
      local x,y=b.x+b.w/2,b.y+b.h+4
      check(library:hit(x,y)==i,where..': the space under Manage is Manage')
      library:mousepressed(x,y);library:mousereleased(x,y)
      check(library.modal and library.modal.mode=='manage',where..': pressing there opens Manage')
      library:closeModal()
    end
  end
  check(count>0,where..': there are Manage buttons')
  apart(library.controls,where)
end
print('PASS: library Manage hit areas')

-- The builder.
local function row(tag,spec,fields)
  local out={}
  local width=0
  for _,column in pairs(spec) do width=math.max(width,column) end
  for i=1,width do out[i]='' end
  if tag then out[1]=tag end
  for name,value in pairs(fields) do out[assert(spec[name],name)]=Codec.encode(value) end
  return table.concat(out,'\t')
end
local revision=0
local function builderSnapshot(o)
  revision=revision+1
  local lines={row(nil,B.header,{revision=revision,phase='ready',name='Fire Deck',format='standard',
    saveStatus=o.saveStatus or '',message=o.message or '',busy=0,page=1,pages=3,total=24,count=14,
    selected='',details='',transfer='',cover='',importing=0,dirty=0,retry=o.retry and 1 or 0})}
  for i=1,8 do
    lines[#lines+1]=row('C',B.card,{cardId='c'..i,name='Card '..i,supertype='Pokémon',subtype='Basic',
      quantity=0,remaining=2,hp=70,mark='G',number=tostring(i),copyLimit=4,illegal=0,gaps=''})
  end
  for i=1,6 do
    lines[#lines+1]=row('D',B.card,{cardId='d'..i,name='Deck card '..i,supertype='Pokémon',subtype='Basic',quantity=2,
      remaining=2,hp=60,mark='G',number=tostring(i),copyLimit=4,illegal=0,gaps=''})
  end
  lines[#lines+1]=row('V',B.validation,{message='',pokemon=12,trainer=0,energy=0})
  return table.concat(lines,'\n')
end
for _,screen in ipairs(SCREENS) do
  Display.set(screen.display)
  for _,state in ipairs({{saveStatus='failed',message='Could not save.'},{retry=true}}) do
    local sent={}
    local b=Builder.new({command=function(raw) sent[#sent+1]=Codec.fields(raw) end,feedback=function() end,announce=function() end,signin=function() end})
    b:layout(screen.w,screen.h);b:sync(builderSnapshot(state));b:layout(screen.w,screen.h)
    local portrait=screen.w<600
    for _,tab in ipairs(portrait and {'catalog','deck'} or {'catalog'}) do
      b.tab=tab;b:build()
      local where=('builder %s %s %s'):format(screen.name,tab,state.retry and 'retry' or 'failed save')
      local rows=0
      for i,c in ipairs(b.controls) do
        if c.rowAction then
          rows=rows+1
          check(c.w==34 and c.h==24,where..': a row action keeps its face')
          check(c.hitRect and contains(c.hitRect,c),where..': a row action has a hit area around its face')
          check(c.hitRect.h>=math.min(34,minimum(screen)),where..': row actions are 34 tall ('..c.hitRect.h..')')
          check(b:hit(c.x+c.w/2,c.y-4)==i and b:hit(c.x+c.w/2,c.y+c.h+4)==i,where..': above and below the face is the row action')
        end
        if c.action=='retry-save' or c.action=='retry' then
          if portrait then check(c.w==432 and c.h==36,where..': portrait Retry keeps its face')
          else
            check(c.x==1122 and c.y==b.height-83 and c.w==110 and c.h==18 and c.fontSize==16,where..': Retry keeps its face')
            check(c.hitRect and contains(c.hitRect,c) and c.hitRect.h>c.h,where..': Retry has a taller hit area')
            check(b:hit(c.x+c.w/2,c.y-2)==i and b:hit(c.x+c.w/2,c.y+c.h+2)==i,where..': just above and below Retry is Retry')
          end
        end
      end
      check(rows>0 or (portrait and tab=='catalog'),where..': there are deck rows')
      apart(b.controls,where)
    end
  end
end
Display.set({scale=1,collection=1,portrait=false})
print('PASS: builder row actions and Retry hit areas; no hit area reaches another control')
