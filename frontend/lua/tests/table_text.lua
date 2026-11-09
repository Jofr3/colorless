-- Interface Size on the table (audit FU1): the board and its cards stay at 100%, and 125% or 150%
-- enlarges the text overlays instead. The card inspector's text, the hover popup, the game log,
-- the HUD's prompt and hint, the history tooltips, the coin captions, the game-over rows and the
-- away text grow by the chosen step where it fits, else by less, never below 100%. Every button
-- keeps its rectangle and font size, and grown text stays inside its panel and on the board,
-- covering no control it cleared at 100%. Landscape 1280x800, portrait 480x850 and the 844x390
-- phone (1280x800 drawn at 390/800).
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub')
Stub.install()
love.keyboard={isDown=function() return false end}
-- m6x11plus's real proportions at its 200 px atlas (about 0.4 em per glyph, 1 em tall), wrapping
-- at word boundaries.
local T=require('ui.theme')
local glyphs={getWidth=function(_,s) return #tostring(s)*80 end,getHeight=function() return 200 end,setFilter=function() end,
  getWrap=function(_,s,w)
    local lines,line={},''
    for word in tostring(s):gmatch('%S+') do
      local next=line=='' and word or line..' '..word
      if #next*80>w and line~='' then lines[#lines+1]=line;line=word else line=next end
    end
    if line~='' then lines[#lines+1]=line end
    return #tostring(s)*80,lines
  end}
T.font=function() return glyphs end
local Card=require('ui.card');Card.rebuild=function(self) self.texture={release=function() end} end
local Display=require('ui.display')
local Simulator=require('ui.simulator')
local Dyna=require('ui.dynatext')
-- Every DynaText label drawn, with its box and the transform's scale and offset at the time.
local labels={}
local m,stack={sx=1,tx=0,ty=0},{}
local g=love.graphics
local push,pop,translate,scale,origin=g.push,g.pop,g.translate,g.scale,g.origin
g.push=function(...) stack[#stack+1]={sx=m.sx,tx=m.tx,ty=m.ty};return push(...) end
g.pop=function(...) m=table.remove(stack) or {sx=1,tx=0,ty=0};return pop(...) end
g.translate=function(x,y,...) m.tx,m.ty=m.tx+m.sx*x,m.ty+m.sx*y;return translate(x,y,...) end
g.scale=function(s,t,...) m.sx=m.sx*s;return scale(s,t,...) end
g.origin=function(...) m={sx=1,tx=0,ty=0};stack={};return origin(...) end
local static=Dyna.static
Dyna.static=function(text,s,x,y,w,h,...)
  -- In board pixels: the table draws inside sim:draw's own zoom and offset.
  labels[#labels+1]={text=tostring(text),scale=s*m.sx,x=m.tx+m.sx*x,y=m.ty+m.sx*y,w=m.sx*(w or 0),h=m.sx*(h or 0),sx=m.sx}
  return static(text,s,x,y,w,h,...)
end
local function check(ok,message) if not ok then error(message,2) end end
-- TABLE_TEXT_REPORT=1 prints each overlay's growth over 100%.
local report=os.getenv('TABLE_TEXT_REPORT')
local function note(name,what,value) if report then io.write(('%-22s %-12s %.3f\n'):format(name,what,value)) end end
local shader={hasUniform=function() return true end,send=function() end}
local shaders={dissolve=shader,played=shader,foil=shader,holo=shader,polychrome=shader,background=shader}
local sim=Simulator.new({command=function() end,announce=function() end,feedback=function() end,
  sourceFeedback=function() end,settings=function() end,jiggle=function() end})
local function enc(s) return (tostring(s):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',c:byte()) end)) end
local function row(...) local f={...};for i,v in ipairs(f) do f[i]=enc(v) end;return table.concat(f,'\t') end
local RS,US='\30','\31'
local revision=100
local LABELS={'Undo turn','Undo action','New game','Redo action','Redo turn'}
local function snapshot(extra,opts)
  opts=opts or {}
  revision=revision+1
  local rows={row(revision,'ready','Player 1','Player 2',3,opts.phase or 'turn:action','','Your turn',opts.hint or 'Attach Energy, play Trainers, then attack or end your turn.',0,1,
    'you','you','p1',1,0,0,opts.outcome or '',opts.outcome and 'All prize cards taken.' or '','',opts.match or 'text-match')}
  for _,r in ipairs({
    row('S','you',46,6,2,3,0),row('S','opponent',47,5,7,1,0),
    row('C','tr1','sv01-189','Professor\'s Research','you','hand',0,'false','Trainer','Supporter','','',0,'','','','','true',0),
    row('C','active1','sv01-033','Houndour','you','active',0,'false','Pokemon','','Basic',70,20,'Fire,Fire','','','Fire','true',0),
    row('C','bench1','sv01-030','Growlithe','you','bench',0,'false','Pokemon','','Basic',70,0,'','','','Fire','true',0),
    row('C','opp1','sv01-052','Quaxly','opponent','active',0,'false','Pokemon','','Basic',60,0,'','','','Water','false',0),
    row('C','oppb','sv01-052','Quaxly','opponent','bench',0,'false','Pokemon','','Basic',60,0,'','','','Water','false',0),
    row('I','sv01-033','Pokemon','','Basic',70,'Fire',1,'Water:×2','Grass:-30','','Bouffer'..US..'Take 20 less damage from attacks.'..US..'Ability',
      'Bite'..US..'Colorless'..US..'10'..US..''..RS..'Flare'..US..'Fire,Colorless'..US..'30'..US..'Discard an Energy from this Pokémon.','','Houndour'),
    row('I','sv01-189','Trainer','Supporter','','','','','','','Discard your hand and draw 7 cards.','','','','Professor\'s Research'),
    row('I','sv01-052','Pokemon','','Basic',60,'Water',1,'Lightning:×2','','','','Peck'..US..'Colorless'..US..'10'..US..'','','Quaxly'),
    row('K','3','active1','Flare · 30','red','false','','','Fire,Colorless'),
    row('K','3b','active1','Retreat','blue','true','','retreat','Colorless'),
    row('A','end','End turn','red','false','primary'),
  }) do rows[#rows+1]=r end
  for i,label in ipairs(LABELS) do rows[#rows+1]=row('A','history'..i,label,'red',i>3,'minor') end
  for _,r in ipairs(extra or {}) do rows[#rows+1]=r end
  sim:sync(table.concat(rows,'\n'))
end
local clock=10
local mouseX,mouseY=-1000,-1000
local function run(seconds,reduced)
  local steps=math.max(1,math.floor(seconds*60+0.5))
  for _=1,steps do clock=clock+1/60;sim:update(1/60,clock,mouseX,mouseY,reduced==nil and true or reduced);sim:draw(shaders) end
end
local function drawn() labels={};g.origin();sim:draw(shaders);return labels end
local function hover(x,y)
  if not x then mouseX,mouseY=-1000,-1000;return end
  mouseX,mouseY=x*sim.zoom+sim.ox,y*sim.zoom+sim.oy
end
local function find(list,text) for _,l in ipairs(list) do if l.text==text then return l end end end
-- The rectangles, labels and font sizes of every control, the table's and an overlay's.
local function faces(controls)
  local out={}
  for _,b in ipairs(controls) do
    out[#out+1]=string.format('%s %.6f %.6f %.6f %.6f %s %s',tostring(b.label),b.x,b.y,b.w,b.h,tostring(b.fontSize),tostring(b.invisible))
  end
  return table.concat(out,'\n')
end
local function overlaps(a,b) return a.x<b.x+b.w and b.x<a.x+a.w and a.y<b.y+b.h and b.y<a.y+a.h end
-- A visible control's face as drawn: lifted 1.8 at rest, its panel 3 below its bounds.
local function face(b) return {x=b.x,y=b.y-2,w=b.w,h=b.h+5} end
-- `box` covers no visible control that `base` (the same panel at 100%) left clear.
local function clears(box,base,controls,skip)
  for _,b in ipairs(controls) do
    if not b.invisible and b~=skip and overlaps(box,face(b)) and not overlaps(base,face(b)) then return false,b.label end
  end
  return true
end
local layouts={
  {name='landscape',w=1280,h=800,display={scale=1,portrait=false,coarse=false}},
  {name='portrait',w=480,h=850,display={scale=390/480,portrait=true,coarse=false}},
  {name='844x390',w=1280,h=800,display={scale=390/800,portrait=false,coarse=false}},
}
local STEPS={1,1.25,1.5}
check(Display.tableText==1,'The table text factor starts at 100%')
-- Grown text keeps off a visible control it cleared at 100%; one it covered then, or an invisible
-- hit area, does not hold it back.
local Shared=require('ui.sim_shared')
local controls={{x=0,y=0,w=10,h=10},{x=100,y=0,w=10,h=10,invisible=true}}
check(Shared.clears(controls,{x=50,y=0,w=10,h=10},{x=50,y=0,w=10,h=10}),'Text away from every control clears them')
check(not Shared.clears(controls,{x=5,y=0,w=10,h=10},{x=50,y=0,w=10,h=10}),'Text grown over a control it cleared does not clear it')
check(Shared.clears(controls,{x=5,y=0,w=10,h=10},{x=8,y=0,w=10,h=10}),'Text over a control it covered at 100% may stay there')
check(Shared.clears(controls,{x=95,y=0,w=10,h=10},{x=50,y=0,w=10,h=10}),'An invisible hit area does not hold text back')
local base={}
for _,view in ipairs(layouts) do
  for _,factor in ipairs(STEPS) do
    local name=view.name..' at '..factor*100 ..'%'
    Display.set(view.display);Display.set({tableText=factor})
    sim:layout(view.w,view.h);sim:open(true);snapshot();hover(nil);run(0.1)
    local B=base[view.name] or {};base[view.name]=B
    local function same(key,value,what)
      if factor==1 then B[key]=value else check(B[key]==value,name..': '..what..' are unchanged\n'..value..'\nwas\n'..tostring(B[key])) end
    end
    local function grown(key,value) if factor==1 then B[key]=value end;return B[key] end
    same('table',faces(sim.controls),'the table\'s buttons')

    -- 1. The history tooltips: the label grows, on the board, off its icon and every other control.
    local undo
    for _,b in ipairs(sim.controls) do if b.label=='Undo action' then undo=b end end
    hover(undo.x+undo.w/2,undo.y+undo.h/2);run(0.6)
    local box=sim.tooltip:box(sim.boardW,sim.boardH)
    check(box and box.label=='Undo action',name..': the Undo action tooltip shows')
    local unit=grown('tooltip',box.textScale)
    check(box.textScale>=unit-1e-9,name..': the tooltip is never smaller than at 100%')
    if factor>1 then check(box.textScale>unit+1e-9,name..': the tooltip grows ('..box.textScale..' vs '..unit..')') end
    note(name,'tooltip',box.textScale/unit)
    if view.name=='landscape' then check(math.abs(box.textScale-unit*factor)<1e-9,name..': the tooltip grows by the whole step where it fits') end
    check(box.x>=0 and box.y>=0 and box.x+box.w<=sim.boardW and box.y+box.h+4<=sim.boardH,name..': the tooltip stays on the board')
    local tw,th=Dyna.measure(box.label,box.textScale)
    check(tw<=box.w-20+1e-9 and th<=box.h-12+1e-9,name..': the tooltip\'s frame holds its label')
    for _,b in ipairs(sim.controls) do
      if not b.tooltip or b==undo then
        check(not overlaps({x=box.x,y=box.y,w=box.w,h=box.h+4},face(b)),name..': the tooltip keeps off '..b.label)
      end
    end
    for _,c in ipairs(sim.cards) do
      local hw,hh=c:halfExtents()
      check(not overlaps({x=box.x,y=box.y,w=box.w,h=box.h+4},{x=c.x-hw,y=c.y-hh+2,w=2*hw,h=2*hh-5}),name..': the tooltip keeps off '..c.item.name)
    end
    local label=find(drawn(),'Undo action')
    check(label and math.abs(label.scale-box.textScale)<1e-9,name..': the tooltip draws its label at its scale')
    hover(nil);run(0.1)

    -- 2. The hover popup over the Active grows about its place, on the board, off the controls.
    local active=sim.byUid['you:active1']
    hover(active.x,active.y);run(0.2)
    check(sim.popup==active,name..': hovering the Active shows its popup')
    local popup=sim:hoverPopup()
    local unitBox=grown('hover',popup)
    check(popup.scale>=1,name..': the hover popup is never smaller')
    note(name,'hover',popup.scale)
    if factor>1 and view.name~='portrait' then check(math.abs(popup.scale-factor)<1e-9,name..': the hover popup grows by the step ('..popup.scale..')') end
    if factor>1 then check(popup.scale>1,name..': the hover popup grows') end
    check(math.abs(popup.w-sim.popupBox.w*popup.scale)<1e-9 and math.abs(popup.h-sim.popupBox.h*popup.scale)<1e-9,name..': the hover popup scales as a whole')
    check(popup.x>=sim.L.table.x+4-1e-9 and popup.x+popup.w<=sim.boardW-4+1e-9 and popup.y>=4-1e-9 and popup.y+popup.h<=sim.boardH-4+1e-9,name..': the hover popup stays on the table')
    local ok,covered=clears(popup,unitBox,sim.controls)
    check(ok,name..': the hover popup covers '..tostring(covered)..', which it cleared at 100%')
    local hw,hh=active:halfExtents()
    check(not overlaps(popup,{x=active.x-hw,y=active.y-hh,w=2*hw,h=2*hh}) or overlaps(unitBox,{x=active.x-hw,y=active.y-hh,w=2*hw,h=2*hh}),name..': the hover popup keeps off its card')
    local name1=find(drawn(),'Houndour')
    check(name1 and name1.sx==popup.scale,name..': the hover popup draws at its scale')
    hover(nil);run(0.1)

    -- 2b. Over the opponent's Bench: in portrait its popup sits above the card, under the HUD's Log
    -- and Options, so it grows only as far as it keeps off them.
    local bench=sim.byUid['opponent:oppb']
    hover(bench.x,bench.y);run(0.2)
    check(sim.popup==bench,name..': hovering the opponent\'s Bench shows its popup')
    local benchPopup=sim:hoverPopup()
    local unitBench=grown('benchHover',benchPopup)
    note(name,'hover bench',benchPopup.scale)
    check(benchPopup.scale>=1,name..': the Bench popup is never smaller')
    check(benchPopup.y>=4-1e-9 and benchPopup.y+benchPopup.h<=sim.boardH-4+1e-9,name..': the Bench popup stays on the board')
    ok,covered=clears(benchPopup,unitBench,sim.controls)
    check(ok,name..': the Bench popup covers '..tostring(covered)..', which it cleared at 100%')
    if factor>1 and view.name~='portrait' then check(benchPopup.scale>1,name..': the Bench popup grows') end
    hover(nil);run(0.1)

    -- 2c. With the Active selected its action rows show above it; the Bench popup keeps off them.
    local function tap(c) local sx,sy=c.x*sim.zoom+sim.ox,c.y*sim.zoom+sim.oy;sim:mousepressed(sx,sy);sim:mousereleased(sx,sy) end
    tap(active);run(0.3)
    check(sim.highlight==active and sim.attachedPopup,name..': the Active shows its action rows')
    hover(bench.x,bench.y);run(0.2)
    local over=sim:hoverPopup()
    local unitOver=grown('overHover',over)
    note(name,'hover over',over.scale)
    ok,covered=clears(over,unitOver,sim.controls)
    check(ok,name..': the Bench popup covers '..tostring(covered)..', which it cleared at 100%')
    hover(nil);tap(active);run(0.3)

    -- 3. The card inspector: its rules text grows; the zoomed card, Back and the actions do not move
    -- or change, and the frame grows upward on the board.
    sim:openInspect(active);run(0.5)
    local o=sim.overlay
    check(o and o.kind=='inspect',name..': the inspector opens')
    same('inspect',faces(o.controls),'the inspector\'s buttons')
    local rect=o:popupRect()
    local unitRect=grown('inspectPopup',rect)
    check(rect.scale>=1,name..': the inspector text is never smaller')
    note(name,'inspect',rect.scale)
    if factor>1 then check(rect.scale>1,name..': the inspector text grows ('..rect.scale..')') end
    if factor>1 and view.name~='portrait' then check(math.abs(rect.scale-factor)<1e-9,name..': the inspector text grows by the step') end
    check(math.abs(rect.w-unitRect.w*rect.scale)<1e-9 and math.abs(rect.h-unitRect.h*rect.scale)<1e-9,name..': the inspector text scales as a whole')
    check(rect.x>=o.x+24-1e-9 and rect.x+rect.w<=o.x+o.w-24+1e-9 and rect.y>=o.y+30,name..': the inspector text stays in its frame')
    check(o.y>=10-1e-9 and o.y+o.h<=sim.boardH-10+1e-9,name..': the inspector frame stays on the board')
    local unitFrame=grown('inspectFrame',{y=o.y,h=o.h})
    check(math.abs(o.y+o.h-(unitFrame.y+unitFrame.h))<1e-9,name..': the inspector frame keeps its bottom')
    for _,b in ipairs(o.controls) do
      check(not overlaps(rect,face(b)),name..': the inspector text keeps off '..b.label)
    end
    local c=o.cards[1]
    local cardTop=c.homeY-c.baseScale*189/2
    check(cardTop>=o.y+30 and math.abs(c.baseScale-grown('inspectCard',c.baseScale))<1e-12,name..': the zoomed card keeps its size, inside the frame')
    local scanned=find(drawn(),'Bouffer')
    check(scanned and math.abs(scanned.sx-rect.scale)<1e-9,name..': the inspector draws its text at its scale')
    sim:closeOverlay(true);run(0.3)

    -- 4. The game log: its lines grow, fewer to a page, inside the frame and above the pager.
    local log={}
    for i=1,40 do log[#log+1]=(i%10==1 and 'turn\t\t\tTurn '..i) or ('p1\tPlayer 1\t0:'..string.format('%02d',i)..'\tPlayer 1 attached a Fire Energy to Houndour in the Active Spot.') end
    snapshot({row('M','log','Game log',table.concat(log,'\n'),'false','log1')});run(0.5)
    o=sim.overlay
    check(o and o.kind=='log',name..': the log opens')
    same('log',faces(o.controls),'the log\'s buttons')
    check(o.logScale==factor,name..': the log text grows by the step')
    note(name,'log',o.logScale)
    check(o.visible==math.floor(grown('logVisible',o.visible)/factor),name..': a page holds fewer lines ('..o.visible..')')
    -- Its first page is full.
    o.page=1;o:build()
    local texts={}
    for _,line in ipairs(o.logLines) do texts[line.text or line.turn]=true end
    local bottom,lineScale=0,nil
    for _,l in ipairs(drawn()) do
      if texts[l.text] then
        lineScale=l.scale;bottom=math.max(bottom,l.y+l.h)
        check(l.x>=o.x+24 and l.x+l.w<=o.x+o.w-24+1e-9,name..': a log line stays in its frame')
      end
    end
    check(lineScale and math.abs(lineScale-0.3*factor)<1e-9,name..': log lines draw at 0.3 x the step, got '..tostring(lineScale))
    check(bottom<=grown('logBottom',bottom)+1e-9,name..': the log\'s last line ends no lower than at 100%')
    sim:closeOverlay(true);snapshot();run(0.3)

    -- 5. The HUD's prompt: its lines grow inside the prompt box, never smaller than at 100%, and a
    -- note that fit the box at 100% does not move to the portrait strip.
    snapshot({row('M','board','Choose a Pokémon','Pick one','false','board1'),row('O','18','Houndour','blue','false','false','sv01-033','active1'),row('O','18b','Growlithe','blue','false','false','sv01-030','bench1')});run(0.5)
    local title=find(drawn(),'Choose a Pokémon')
    check(title,name..': the prompt title draws')
    local unitTitle=grown('prompt',title)
    check(title.scale>=unitTitle.scale-1e-9,name..': the prompt is never smaller')
    note(name,'prompt',title.scale/unitTitle.scale)
    if factor>1 and view.name~='portrait' then check(title.scale>unitTitle.scale+1e-9,name..': the prompt grows ('..title.scale..')') end
    local fit=(sim.hud.promptGrow and sim.hud.promptGrow.grown) or sim.hud.promptFit
    check((fit.strip~=nil)==(sim.hud.promptFit.strip~=nil),name..': the prompt keeps its place in the box or the strip')
    if not fit.strip then
      check(#fit.titles*(fit.th+3)+8+#fit.notes*(fit.nh+3)<=fit.h+1e-9,name..': the grown prompt fits its box')
    end
    snapshot();run(0.3)

    -- 6. The HUD's hint (no prompt up): it grows inside its box, never smaller.
    local hint=find(drawn(),'Attach Energy, play Trainers, then attack or end your turn.')
    local words={}
    for _,l in ipairs(labels) do if l.text:match('Trainers') or l.text:match('turn%.$') or l.text:match('^Attach') then words[#words+1]=l end end
    check(#words>0,name..': the hint draws')
    local unitHint=grown('hint',words[1].scale)
    check(words[1].scale>=unitHint-1e-9,name..': the hint is never smaller')
    note(name,'hint',words[1].scale/unitHint)
    if factor>1 then check(words[1].scale>unitHint+1e-9,name..': the hint grows ('..words[1].scale..' vs '..unitHint..')') end
    local _=hint
    -- Inside the turn panel's body (landscape) or the box right of the portrait HUD's buttons.
    local hintBottom=view.display.portrait and sim.L.hud.y+58+sim.L.hud.h-64 or sim.hud:top(sim.L)+48+10+226-72
    for _,l in ipairs(words) do check(l.y+l.h<=hintBottom+1e-9,name..': the hint stays in its box') end

    -- 6b. A long prompt note: in portrait it takes the strip under the HUD at 100% and keeps it,
    -- in no more lines, covering no control the strip cleared; in landscape it grows in its box.
    local long='Choose up to two of your Benched Pokémon. Each one moves an Energy to your Active Pokémon, then shuffle your deck.'
    snapshot({row('M','board','Move Energy',long,'false','board2'),row('O','18','Houndour','blue','false','false','sv01-033','active1'),row('O','18b','Growlithe','blue','false','false','sv01-030','bench1')});run(0.5)
    drawn()
    local fit1=sim.hud.promptFit
    local grownFit=sim.hud.promptGrow and sim.hud.promptGrow.grown or fit1
    local unitLong=grown('longPrompt',{scale=fit1.scale,strip=fit1.strip and fit1.strip.scale,lines=#fit1.notes})
    check((fit1.strip~=nil)==(unitLong.strip~=nil),name..': the long note takes the strip as at 100%')
    check(grownFit.scale>=unitLong.scale-1e-9,name..': the long prompt title is never smaller')
    if fit1.strip then
      check(grownFit.strip.scale>=unitLong.strip-1e-9 and #grownFit.notes<=unitLong.lines,name..': the strip note is never smaller and takes no more lines')
      if factor>1 then check(grownFit.strip.scale>unitLong.strip+1e-9,name..': the strip note grows') end
      local unitStrip=grown('strip',fit1.strip)
      local ok,covered=clears(grownFit.strip,unitStrip,sim.controls)
      check(ok,name..': the strip covers '..tostring(covered)..', which it cleared at 100%')
      note(name,'strip',grownFit.strip.scale/unitLong.strip)
    else
      check(#grownFit.titles*(grownFit.th+3)+8+#grownFit.notes*(grownFit.nh+3)<=fit1.h+1e-9,name..': the long prompt fits its box')
      note(name,'long prompt',grownFit.scale/unitLong.scale)
    end
    snapshot();run(0.3)

    -- 6c. Choosing who goes first: the line under the title grows inside the empty turn panel.
    snapshot({row('A','first','P1 first','blue','false','primary'),row('A','second','P2 first','blue','false','primary')},{phase='setup:chooseFirst',hint='Choose who goes first.'});run(0.5)
    if not view.display.portrait then
      local line=find(drawn(),'Your turn')
      check(line,name..': the choose-first line draws')
      local unitLine=grown('first',line.scale)
      check(math.abs(line.scale-unitLine*factor)<1e-9,name..': the choose-first line grows by the step')
      for _,b in ipairs(sim.controls) do check(not overlaps(line,face(b)),name..': the choose-first line keeps off '..b.label) end
    end
    snapshot();run(0.3)

    -- 6d. A touch phone held sideways: the rotate hint grows above the turn panel.
    if view.name=='844x390' then
      Display.set({coarse=true});run(0.1)
      local first=find(drawn(),'Turn your phone upright')
      local second=find(labels,'for a larger table')
      check(first and second,name..': the rotate hint draws')
      local unitRotate=grown('rotate',first.scale)
      check(first.scale>=unitRotate-1e-9,name..': the rotate hint is never smaller')
      if factor>1 then check(first.scale>unitRotate+1e-9,name..': the rotate hint grows') end
      note(name,'rotate',first.scale/unitRotate)
      check(second.y+second.h<=sim.hud:top(sim.L)-4+1e-9,name..': the rotate hint ends above the turn panel')
      Display.set({coarse=false});run(0.1)
    end

    -- 7. The coin captions grow below their coins, above the overlay's button.
    snapshot({row('M','coin','Coin flip','Player 1: Heads','true','coin1'),row('O','15','Continue','blue','false','false','','')});run(1.5)
    o=sim.overlay
    same('coin',faces(o.controls),'the coin overlay\'s buttons')
    local heads=find(drawn(),'HEADS')
    local who=find(labels,'Player 1')
    check(heads and who,name..': the coin captions draw')
    local unitHeads=grown('heads',heads.scale)
    check(heads.scale>=unitHeads-1e-9,name..': the coin caption is never smaller')
    note(name,'coin',heads.scale/unitHeads)
    if factor>1 then check(heads.scale>unitHeads+1e-9,name..': the coin caption grows') end
    for _,b in ipairs(o.controls) do check(who.y+who.h<=b.y-2,name..': the coin captions end above '..b.label) end
    sim:closeOverlay(true);snapshot();run(0.3)

    -- 8. The game-over rows grow inside their box, above the buttons.
    snapshot(nil,{phase='gameOver',outcome='win'});run(3)
    o=sim.overlay
    check(o and o.kind=='gameover',name..': game over opens')
    same('gameover',faces(o.controls),'the game-over buttons')
    local reason=find(drawn(),'Reason')
    local unitReason=grown('reason',reason.scale)
    check(reason.scale>=unitReason-1e-9,name..': the game-over rows are never smaller')
    note(name,'gameover',reason.scale/unitReason)
    if factor>1 then check(reason.scale>unitReason+1e-9,name..': the game-over rows grow') end
    local lowest=0
    for _,l in ipairs(labels) do if l.text=='Cards in hand' then lowest=l.y+l.h end end
    for _,b in ipairs(o.controls) do check(lowest<=b.y-2,name..': the game-over rows end above '..b.label) end
    for _,l in ipairs(labels) do
      if l.text=='Opponent prizes left' then check(Dyna.measure(l.text,l.scale)<=(o.w-48)/2-16+1e-9,name..': a row label stays in its half') end
    end
    sim:closeOverlay(true)
  end
end

-- 9. Online, the away text grows over the board centre, never wider than the table.
for _,view in ipairs(layouts) do
  local unit
  for _,factor in ipairs(STEPS) do
    local name=view.name..' online at '..factor*100 ..'%'
    Display.set(view.display);Display.set({tableText=factor})
    sim:layout(view.w,view.h);sim:open(true,false,'online','ABCD')
    snapshot({row('L','online','false','Misty',42000,'concede,leave','partial')},{match='ABCD:1'});run(0.5)
    check(sim.away,name..': the opponent is away')
    local s=sim:awayScale()
    unit=unit or s
    check(s>=1,name..': the away text is never smaller')
    note(name,'away',s)
    if factor>1 then check(s>1,name..': the away text grows ('..s..')') end
    check(math.max(sim.away.title.W,sim.away.detail.W)*s<=sim.L.table.w-40+1e-9,name..': the away text fits the table')
  end
end
Display.set({scale=1,portrait=false,tableText=1})
print('PASS: Interface Size enlarges the table\'s text overlays and leaves its board, cards and buttons as they are')
