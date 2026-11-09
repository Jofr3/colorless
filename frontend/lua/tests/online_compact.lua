-- The online lobby under Settings' Interface Size (UI-FU2). Each step names the smallest canvas
-- its compact arrangement fits (ui/lobby_size.lua), so main.lua grows the lobby as far as the step
-- allows: the menu (Create and Join), the waiting lobby, joining and the info steps reach 150%;
-- versus, the countdown, the deck picker and the set match reach 125%, as Settings does, since your
-- seat's deck preview and the picker's two rows of piles need a 640 tall canvas. Laid out in the
-- shrunken canvas (1024x640 at 125%, 853x533 at 150%) every step's frame, controls, seats,
-- preview, piles, pager and text fit inside the canvas, and no two controls overlap; text keeps
-- clear of every control. Portrait and 1280x800 keep the arrangement they had.
package.path='frontend/lua/?.lua;'..package.path
local function check(ok,message) if not ok then error(message,2) end end
-- Fonts as wide as half their size per character and as tall as their size.
local fonts={}
local function font(size)
  fonts[size]=fonts[size] or {getWidth=function(_,s) return #tostring(s)*size/2 end,getHeight=function() return size end,
    getWrap=function(_,s) return #s*size/2,{s} end}
  return fonts[size]
end
love={math={random=function() return 0.5 end},keyboard={isDown=function() return false end},
  filesystem={getInfo=function() return nil end}}
-- The transform's translation and scale, so a text drawn in a translated frame is placed.
local m,stack={x=0,y=0,sx=1,sy=1},{}
love.graphics=setmetatable({
  push=function() stack[#stack+1]={x=m.x,y=m.y,sx=m.sx,sy=m.sy} end,pop=function() m=table.remove(stack) end,
  translate=function(x,y) m.x,m.y=m.x+m.sx*x,m.y+m.sy*y end,scale=function(x,y) m.sx,m.sy=m.sx*x,m.sy*(y or x) end,
},{__index=function() return function() end end})
local D=require('ui.card_dimensions')
local Card=require('ui.card')
Card.rebuild=function(self) self.texture={release=function() end} end
local T=require('ui.theme')
T.font=font
local Size=require('ui.interface_size')
local Dyna=require('ui.dynatext')
local Button=require('ui.button')
local Online=require('ui.online')
local LobbySize=require('ui.lobby_size')
local Labels=require('ui.deck_labels')
local Codec=require('ui.codec')
local W=require('ui.wire_fields').online
local o=Online.new({command=function() end,announce=function() end,feedback=function() end,
  jiggle=function() end,home=function() end,signin=function() end})
local function row(tag,spec,fields)
  local out={}
  for _,column in pairs(spec) do out[column]='' end
  if tag then out[1]=tag end
  for name,value in pairs(fields) do out[assert(spec[name],name)]=Codec.encode(value) end
  return table.concat(out,'\t')
end
local revision=0
local function snapshot(step,opts,rows)
  opts=opts or {};revision=revision+1
  local lines={row(nil,W.header,{revision=revision,step=step,busy=opts.busy and 1 or 0,message=opts.message or '',
    code=opts.code or 'ABCD',role='host',link='connected',countdown=opts.countdown or '',
    notice='',deckPhase=opts.decks or 'idle',name='Ash',account=opts.account or 'authenticated',canKick=0,status=''})}
  for _,r in ipairs(rows or {}) do lines[#lines+1]=row(r[1],r[1]=='P' and W.seat or W.deck,r[2]) end
  o:sync(table.concat(lines,'\n'))
end
local function seats(ready,deck)
  return {{'P',{seat='you',present=1,name='Ash',connected=1,ready=ready and 1 or 0,deckId=deck and 'deck2' or '',
      deckName=deck and 'Deck 2' or '',hasDeck=deck and 1 or 0}},
    {'P',{seat='opponent',present=1,name='Misty',connected=1,ready=ready and 1 or 0,deckId='',deckName='',hasDeck=0}}}
end
local function decks()
  local rows=seats(false,true)
  for i=1,12 do rows[#rows+1]={'D',{id='deck'..i,name='Deck '..i,count=60,standard=1,expanded=1,online=1,formatName='Standard'}} end
  return rows
end
local function action(name) for i,item in ipairs(o.items) do if item.action==name then return i,item end end end
-- Rectangles: overlap and containment, with a little float slack.
local E=1e-6
local function overlaps(a,b) return a.x<b.x+b.w-E and b.x<a.x+a.w-E and a.y<b.y+b.h-E and b.y<a.y+a.h-E end
local function within(a,b) return a.x>=b.x-E and a.y>=b.y-E and a.x+a.w<=b.x+b.w+E and a.y+a.h<=b.y+b.h+E end
local function box(r) return ('%.1f,%.1f %.1fx%.1f'):format(r.x,r.y,r.w,r.h) end
-- Every text the step draws: T.text and the error line, one line of `size` each.
local texts
local text,errorLine=T.text,Button.errorLine
T.text=function(value,size,x,y,w,...)
  texts[#texts+1]={text=value,x=m.x+m.sx*x,y=m.y+m.sy*y,w=m.sx*w,h=m.sy*size}
  return text(value,size,x,y,w,...)
end
Button.errorLine=function(value,size,x,y,w) texts[#texts+1]={text=value,x=x,y=y-4,w=w,h=size+8,error=true};return errorLine(value,size,x,y,w) end
local function sweep(name)
  local frame={x=o.x,y=o.y,w=o.w,h=o.h}
  local canvas={x=0,y=0,w=o.width,h=o.height}
  check(within(frame,canvas),name..': frame '..box(frame)..' outside the '..o.width..'x'..o.height..' canvas')
  for i,a in ipairs(o.items) do
    check(within(a,frame),name..': '..tostring(a.label or a.kind)..' '..box(a)..' outside the frame '..box(frame))
    for j=i+1,#o.items do
      local b=o.items[j]
      check(not overlaps(a,b),name..': '..tostring(a.label or a.kind)..' '..box(a)..' overlaps '..tostring(b.label or b.kind)..' '..box(b))
    end
  end
  texts={};o:draw()
  for _,t in ipairs(texts) do
    if t.text~='' then
      check(t.y>=frame.y-E and t.y+t.h<=frame.y+frame.h+E,name..': "'..t.text..'" outside the frame')
      for _,item in ipairs(o.items) do
        -- A control's own label and placeholder start inside it.
        if not within({x=t.x,y=t.y,w=0,h=0},item) then
          check(not overlaps(t,item),name..': "'..t.text..'" '..box(t)..' overlaps '..tostring(item.label or item.kind)..' '..box(item))
        end
      end
    end
  end
  return frame
end
-- The waiting prompt sits centred between Copy link and Leave, as at 1280x800.
local function waitingPrompt(name)
  local prompt=o.dyna.prompt
  local link,back=o.items[4],o.items[#o.items]
  local cy
  prompt.draw=function(_,_,y) cy=y end
  o:draw();prompt.draw=nil
  check(link.label=='Copy link' and cy,name..': the prompt is drawn under Copy link')
  check(cy-prompt.H/2>=link.y+link.h and cy+prompt.H/2<=back.y,name..': the prompt '..cy..' runs into Copy link or Leave')
  check(math.abs(cy-(link.y+link.h+back.y)/2)<=4,name..': the prompt '..cy..' is off the middle between Copy link and Leave')
end
-- The versus seats: inside the frame, apart, clear of Back and the message; your seat's buttons
-- inside it, and its preview (name above, count below) between the status row and Choose deck.
local function versus(name)
  local you,opp=o.panels.you,o.panels.opponent
  local frame={x=o.x,y=o.y,w=o.w,h=o.h}
  local back=o.items[#o.items]
  check(within(you,frame) and within(opp,frame),name..': a seat outside the frame')
  check(not overlaps(you,opp),name..': the seats overlap')
  local vs=o.dyna.vs or o.dyna.title
  check(opp.y+opp.h<=o.vs.y-vs.H/2 and o.vs.y+vs.H/2<=you.y or o.step=='countdown',name..': VS runs into a seat')
  texts={};o:draw()
  for _,t in ipairs(texts) do
    if t.error then
      check(not overlaps(t,you) and t.y+t.h<=back.y,name..': the message '..box(t)..' runs into your seat or Back')
    end
  end
  for _,item in ipairs(o.items) do
    if item.action=='choose' or item.action=='ready' then check(within(item,you),name..': '..item.label..' outside your seat') end
  end
  local pile=o.piles.you
  if pile then
    local _,choose=action('choose')
    local s=pile.baseScale
    local top=pile.homeY-D.HALF_H*s-15*s-32
    -- The count under the pile, as drawn: 0.95 of the card's half height, its row and the gap.
    local bottom=Labels.drawCounter(pile)
    -- However far the preview shrinks, the count draws on screen at least as tall as at 100%.
    local rowTop=pile.homeY+(0.08+0.95*D.TILE_H/2+0.03)*pile.unit
    local drawn=(bottom-rowTop-0.03*pile.unit)*1280/o.width
    local full=Labels.counter(60,nil,0.3)[1].h*D.W*((234-84)/D.H)/D.TILE_W
    check(drawn>=full-1e-6,name..': the preview\'s count shrinks on screen ('..drawn..' < '..full..')')
    check(top>=you.y+96,name..': the preview\'s name runs into the status row ('..top..' < '..(you.y+96)..')')
    check(bottom<=choose.y,name..': the preview runs into Choose deck ('..bottom..' > '..choose.y..')')
    check(pile.homeX==you.x+you.w/2,name..': the preview is centred in your seat')
    return s
  end
end
-- The picker: piles in the tray, the tray clear of the search row and the pager, the pager of Back.
local function picker(name)
  local a=o.area
  local frame={x=o.x,y=o.y,w=o.w,h=o.h}
  check(within(a,frame),name..': the tray outside the frame')
  for _,item in ipairs(o.items) do
    if item.kind=='field' or item.kind=='cycle' then check(item.y+item.h<=a.y,name..': '..item.kind..' runs into the tray') end
    if item.action=='previous' or item.action=='next' then
      check(item.y>=a.y+a.h,name..': the pager runs into the tray')
      check(item.y+item.h<=o.items[#o.items].y,name..': the pager runs into Back')
    end
  end
  for _,card in ipairs(o.cards) do
    check(within(card.bounds,a),name..': a pile\'s box outside the tray')
    check(card.homeY-D.HALF_H*card.baseScale-32>=a.y and card.homeY+D.HALF_H*card.baseScale+24<=a.y+a.h,name..': a pile outside the tray')
  end
  return o.cards[1] and o.cards[1].baseScale
end
local states={
  {'create',function() o.tab=1;snapshot('menu',{code='',account='anonymous'}) end},
  {'create with an error',function() o.tab=1;snapshot('menu',{code='',account='anonymous',message="Couldn't reach the lobby server. Try again in a moment."}) end},
  {'join',function() o:open(true,'');o.tab=2;snapshot('menu',{code='',account='anonymous'}) end},
  {'join with an error',function() o:open(true,'');o.tab=2;snapshot('menu',{code='',account='anonymous',message='Lobby not found'}) end},
  {'joining',function() snapshot('joining') end},
  {'waiting',function() snapshot('waiting',{},{seats()[1]}) end,waitingPrompt},
  {'versus',function() snapshot('versus',{},seats(false,false)) end,versus},
  {'versus with a deck',function() snapshot('versus',{message='Lost the lobby'},seats(false,true)) end,versus},
  {'countdown',function() snapshot('versus',{},seats(true,true));snapshot('countdown',{countdown=3},seats(true,true)) end,versus},
  {'picker',function() snapshot('versus',{},seats(false,true));o:activate((action('choose')));snapshot('versus',{decks='ready'},decks()) end,picker},
  {'picker signed out',function() snapshot('versus',{},seats(false,false));o:activate((action('choose')));snapshot('versus',{decks='anonymous'},seats(false,false)) end,picker},
  {'starting',function() snapshot('starting',{},seats(true,true)) end},
  {'not found',function() snapshot('not-found',{code='ZZZZ'}) end},
  {'kicked',function() snapshot('kicked') end},
}
-- The factor each step reaches when 125% and 150% are chosen.
local reaches={create={1.25,1.5},['create with an error']={1.25,1.5},join={1.25,1.5},['join with an error']={1.25,1.5},
  joining={1.25,1.5},waiting={1.25,1.5},versus={1.25,1.25},['versus with a deck']={1.25,1.25},countdown={1.25,1.25},
  picker={1.25,1.25},['picker signed out']={1.25,1.25},starting={1.25,1.25},['not found']={1.25,1.5},kicked={1.25,1.5}}
local scales={}
for _,s in ipairs(states) do
  local name,enter,extra=s[1],s[2],s[3]
  o:layout(1280,800);o:open(true,'');enter()
  local minW,minH=LobbySize.minimum(o.step)
  for choice=1,2 do
    local f=Size.factor(choice,1280,800,minW,minH)
    check(f==reaches[name][choice],name..' at '..Size.labels[choice+1]..' reaches '..f..', wanted '..reaches[name][choice])
    -- Laid out where the factor puts it: the step, built again in the shrunken canvas.
    o:layout(1280/f,800/f)
    local label=name..' at '..Size.labels[choice+1]
    sweep(label)
    if extra then scales[label]=extra(label) end
  end
end
-- The preview shrinks to fit at 125%; the picker's piles stay about as large on the screen.
local preview=scales['versus with a deck at 125%']
check(preview and preview>0.35 and preview<0.794,'The 125% preview is smaller than 100%\'s, got '..tostring(preview))
local piles=scales['picker at 125%']
check(piles and piles*1.25>0.75,'The 125% picker\'s piles keep their size on screen, got '..tostring(piles))
-- 1280x800 and portrait keep the arrangement they had: the full-height versus, the picker's
-- 0.794 piles and the 540 tall menu.
o:layout(1280,800);o:open(true,'');snapshot('versus',{},seats(false,true))
check(o.h==734 and o.panels.you.h==432 and o.pad==20,'1280x800 versus keeps its 734 tall frame')
check(math.abs(o.piles.you.baseScale-(234-84)/D.H)<1e-9,'1280x800 keeps its preview scale')
o:open(true,'');snapshot('menu',{code=''});check(o.h==540,'1280x800 keeps the 540 tall menu')
o:layout(480,850);o:open(true,'');snapshot('menu',{code=''});check(o.h==540,'Portrait keeps the 540 tall menu')
snapshot('versus',{},seats(false,true));check(o.pad==24 and o.panels.you.h==432,'Portrait keeps its versus')
print('PASS: the online lobby grows to 150% on its menu, waiting and info steps and 125% on versus and the picker, every step fitting its canvas')
