-- Headless checks for the widgets the pages draw from one place (audit PG15): the option
-- cycle's centre and arrows (Settings, the lobby's deck filter, the builder's filters), the
-- pagers' arrows and face (the collection pages and the lobby's deck picker), the titled deck
-- pile (the sandbox chooser and the lobby) and the icon glyphs (the builder and the library).
package.path='frontend/lua/?.lua;'..package.path
local calls={}
local g=setmetatable({},{__index=function(t,k)
  local f=function(...) calls[#calls+1]={k,...} end
  rawset(t,k,f)
  return f
end})
love={graphics=g,math={random=function() return 0.5 end},filesystem={getInfo=function() return nil end}}
local font={getWidth=function(_,s) return #tostring(s)*10 end,getHeight=function() return 20 end}
local T=require('ui.theme');T.font=function() return font end
local Button=require('ui.button')
local Pager=require('ui.pager')
local Labels=require('ui.deck_labels')
local DeckGrid=require('ui.deck_grid')
local DeckPicker=require('ui.deck_picker')
local function check(ok,message) if not ok then error(message,2) end end
local function same(a,b) for i=1,4 do if a[i]~=(b[i] or 1) then return false end end return true end

local panels,texts,draws,faces,outlines
local panel,text,draw,cycleFace,outline=Button.panel,T.text,Button.draw,Button.cycleFace,Button.outline
Button.panel=function(x,y,w,h,c,r) panels[#panels+1]={x=x,y=y,w=w,h=h,c={c[1],c[2],c[3],c[4]},r=r} end
T.text=function(value,size,x,y,w) texts[#texts+1]={text=value,size=size,x=x,y=y,w=w} end
Button.draw=function(b,active,pressed) draws[#draws+1]={label=b.label,x=b.x,y=b.y,w=b.w,h=b.h,colour=b.colour,active=active,pressed=pressed} end
Button.cycleFace=function(x,y,w,h,hovered,emboss) faces[#faces+1]={x=x,y=y,w=w,h=h,hovered=hovered,emboss=emboss} end
Button.outline=function(x,y,w,h,c,r) outlines[#outlines+1]={x=x,y=y,w=w,h=h,c=c,r=r} end
local function reset() panels,texts,draws,faces,outlines,calls={},{},{},{},{},{} end
local function called(name)
  local list={}
  for _,c in ipairs(calls) do if c[1]==name then list[#list+1]=c end end
  return list
end

-- The option cycle's centre as Settings draws it: the embossed face, the value narrowed to fit,
-- and the pips centred over the row Settings measures (count*7.2-2.4).
reset()
Button.optionCycle(100,50,192,38.4,{colour=T.red,label='Short',squeeze=true,pips={count=3,index=2,off=T.ink,span=3*7.2-2.4}})
check(#panels==5,'Emboss, face and three pips')
check(panels[1].y==56 and same(panels[1].c,{T.red[1]*0.7,T.red[2]*0.7,T.red[3]*0.7}) and same(panels[2].c,T.red),'Embossed face at rest')
check(panels[3].x==100+(192-(3*7.2-2.4))/2,'The pip row centred under the value')
check(panels[4].x==panels[3].x+7.2 and panels[3].y==78 and panels[3].w==4.8 and panels[3].r==0.6,'Pips 7.2 apart under the value')
check(same(panels[3].c,T.ink) and same(panels[4].c,T.white) and same(panels[5].c,T.ink),'The chosen pip is white, the others ink')
check(#texts==1 and texts[1].x==0 and texts[1].y==0 and texts[1].w==192,'A short value draws at full width')
local scale=called('scale')
check(#scale==1 and scale[1][2]==1 and scale[1][3]==1,'A short value is not narrowed')
reset()
Button.optionCycle(100,50,192,38.4,{colour=T.panel,hovered=true,label=('W'):rep(30),squeeze=true,pips={count=2,index=1,off=T.ink}})
scale=called('scale')
check(#scale==1 and scale[1][2]==180/300 and texts[1].size==12 and texts[1].w==192/(180/300),'A long value shrinks to 12 and narrows to fit')
check(same(panels[1].c,{T.panel[1]*0.5,T.panel[2]*0.5,T.panel[3]*0.5}) and same(panels[2].c,Button.hoverColour(T.panel,true)),'Hover darkens the face and its emboss')
-- The row width a page passes is kept to the last bit: at twenty pips Settings' sum and the
-- builder's land a float apart.
reset()
Button.optionCycle(100,50,192,38.4,{label='x',pips={count=20,index=1,off=T.ink,span=20*7.2-2.4}})
check(panels[3].x==100+(192-(20*7.2-2.4))/2 and panels[3].x~=100+(192-(19*7.2+4.8))/2,"The pip row keeps the page's own width")
-- As the lobby draws it: the value shrinks but is not narrowed.
reset()
Button.optionCycle(100,50,192,38.4,{label=('W'):rep(30),pips={count=5,index=5,off=T.ink,span=5*7.2-2.4}})
check(#called('scale')==0 and texts[1].x==100 and texts[1].y==51 and texts[1].w==192 and texts[1].size==12,'Without squeeze the value only shrinks')
check(same(panels[7].c,T.white) and same(panels[2].c,T.red),'The last pip lit, red by default')

-- As the builder draws it: its own page text, a set of chosen pips and the panel-coloured rest.
reset()
local drawn
local pageText={draw=function(_,...) drawn={...} end}
Button.optionCycle(100,50,192,38.4,{hovered=true,text=pageText,textHeight=29,time=3,reduced=true,roomWidth=1280,
  pips={count=20,spacing=5.76,set='1,3',index=2,off=T.panel}})
check(drawn and drawn[1]==3 and drawn[2]==true and drawn[3]==100 and drawn[6]==29 and drawn[7]==1280 and drawn[8]==0.4,'The page text over the face')
check(#texts==0 and #panels==22,'No label; twenty pips')
check(panels[3].x==100+(192-(19*5.76+4.8))/2 and panels[4].x==panels[3].x+5.76,'Pips at their own spacing')
check(same(panels[3].c,T.white) and same(panels[4].c,T.panel) and same(panels[5].c,T.white),'Every pip of the set lit, the index ignored')
reset()
Button.optionCycle(100,50,192,38.4,{text=pageText,time=3,roomWidth=1280})
check(#panels==2 and drawn[6]==38.4,'No pips: the text takes the full height')

-- The cycle's arrows: focus lights both, the pointer one, a press one.
reset()
Button.cycleArrows(100,50,264,T.red,false,true,false,1280)
check(#draws==2 and draws[1].label=='<' and draws[1].x==100 and draws[2].label=='>' and draws[2].x==100+264-28.8,'Arrows at both ends')
check(draws[1].y==50 and draws[1].w==28.8 and draws[1].h==38.4 and draws[1].colour==T.red,'Arrow size and colour')
check(draws[1].active and draws[2].active and not draws[1].pressed and not draws[2].pressed,'Focus lights both arrows')
reset()
Button.cycleArrows(100,50,264,T.panel,'right',false,'right',1280)
check(not draws[1].active and draws[2].active and not draws[1].pressed and draws[2].pressed and draws[2].colour==T.panel,'The pointer lights and presses one side')
reset()
Button.cycleArrows(100,50,264,T.red,'center',false,nil,1280)
check(not draws[1].active and not draws[2].active,'The centre lights neither arrow')

-- Pagers: arrows 6 px either side of the face, spoken, and a focus stop only with pages to turn.
local made={}
local function make(label,x,y,w,h,dir) local c={label=label,x=x,y=y,w=w,h=h,dir=dir,fontSize=24};made[#made+1]=c;return c end
local left,right=Pager.arrows(DeckPicker.PAGER,640,500,1,3,make)
check(left.x==640-157 and right.x==640+125 and left.w==32 and left.h==36 and left.y==500,"The deck grid's arrows where the chooser placed them")
check(left.dir==-1 and right.dir==1 and left.label=='<' and right.label=='>','Each arrow knows its direction')
check(left.speech=='Previous page, page 1 of 3' and right.speech=='Next page, page 1 of 3' and not left.skipFocus,'Spoken and focusable')
check(left.fontSize==24,'No fontSize leaves the page its own')
left,right=Pager.arrows({face=-135,w=270,arrow=36,h=48,fontSize=30},640,656,1,1,make)
check(left.x==640-177 and right.x==640+141 and left.h==48 and left.fontSize==30 and right.fontSize==30,"The library's arrows and label size")
check(left.skipFocus and right.skipFocus,'One page: Tab skips the arrows')
left,right=Pager.arrows({face=36,w=170,arrow=30,h=36,emboss=5},234,595,2,2,make)
check(left.x==234 and right.x==234+212,"The builder's deck arrows")
reset()
local shown
local text={draw=function(_,...) shown={...} end}
local spec={face=-119,w=238,arrow=32,h=36,textScale=0.4,emboss=5}
Pager.draw(spec,640,500,text,true,640,510,7,false,1280)
check(#faces==1 and faces[1].x==521 and faces[1].y==500 and faces[1].w==238 and faces[1].h==36 and faces[1].emboss==5,'The face beside its arrows')
check(faces[1].hovered==true and shown[3]==521 and shown[5]==238 and shown[6]==36 and shown[7]==1280 and shown[8]==0.4,'Lit under the pointer; the page text over it')
Pager.draw(spec,640,500,text,false,640,510,7,false,1280)
Pager.draw(spec,640,500,text,true,nil,nil,7,false,1280)
Pager.draw(spec,640,500,text,true,500,510,7,false,1280)
check(not faces[2].hovered and not faces[3].hovered and not faces[4].hovered,'Unlit behind a dialog, with no pointer, or beside it')

-- The titled deck pile: its count, its fitted name, and an outline round them while chosen.
local counter=Labels.drawCounter
Labels.drawCounter=function() return 400 end
local pile={baseScale=0.5,homeX=300,item={name='Deck one'},draws=0}
function pile:draw() self.draws=self.draws+1 end
function pile:target() return 302,250 end
local D=require('ui.card_dimensions')
reset()
DeckGrid.drawPile(pile,false,1280)
check(pile.draws==1 and #outlines==0,'An unchosen pile has no outline')
local titleX,titleY=302-D.HALF_W*0.5-6,250-D.HALF_H*0.5-32
check(#texts==1 and texts[1].text=='Deck one' and texts[1].x==titleX and texts[1].y==titleY and texts[1].w==D.W*0.5+12,'Its name above it')
reset()
DeckGrid.drawPile(pile,true,1280)
local o=outlines[1]
check(#outlines==1 and o.y==titleY-5 and o.h==400-titleY+10 and o.c==T.white and o.r==1.2,'A chosen pile is outlined from its name to its count')
check(o.x==math.min(titleX,300-D.HALF_W*0.5)-5,'The outline starts left of the name and the pile')
Labels.drawCounter=counter

-- Icon glyphs: white, over the face's parallax, pressed in with it.
local function rects()
  local list={}
  for _,c in ipairs(called('rectangle')) do list[#list+1]=table.concat({c[3],c[4],c[5],c[6]},',') end
  return table.concat(list,' ')
end
reset()
Button.icon({x=600,y=100,w=40,h=24},'dots',false,1280)
check(rects()=='-10,-2,4,4 -2,-2,4,4 6,-2,4,4','Three dots')
local translate=called('translate')[1]
check(translate[2]==600+0.4*((620-640)/640*1.5)*3+20 and translate[3]==100-0.4*4.5+12 and called('scale')[1][2]==1,'Over the face, at rest')
check(called('setColor')[1][2]==T.white and #called('push')==1 and #called('pop')==1,'White, in its own transform')
reset()
Button.icon({x=600,y=100,w=40,h=24},'info',true,1280)
check(rects()=='-2,-11,5,5 -2,-3,5,14 -5,-3,8,3 -5,8,11,3','The info glyph')
check(called('scale')[1][2]==0.985 and called('translate')[1][3]==100-(0.4-1.5)*4.5+12,'Pressed in with the face')
reset()
Button.icon({x=600,y=100,w=40,h=36},'cards',false,1280)
check(rects()=='-10,-11,8,10 -10,2,8,10 2,-11,8,10 2,2,8,10','The card grid')
reset()
Button.icon({x=600,y=100,w=40,h=36},'list',false,1280)
local list=rects()
check(list=='-10,-9,3,3 -3,-9,13,3 -10,-2,3,3 -3,-2,13,3 -10,5,3,3 -3,5,13,3','The list glyph')
reset()
Button.icon({x=600,y=100,w=40,h=36},'other',false,1280)
check(rects()==list,'Any other name draws the list')

-- The decklist text area (audit PG16): it wraps each paragraph once per value and width, and
-- draws the lines a new value wraps to.
local TextArea=require('ui.text_area')
local wraps=0
font.getWrap=function(_,s,w)
  wraps=wraps+1
  local lines={}
  for word in s:gmatch('%S+') do lines[#lines+1]=word end
  return w,lines
end
local area=TextArea.new('Paste here')
local field={x=10,y=20,w=300,h=220}
local view={}
local function shownLines() local list={};for _,t in ipairs(texts) do list[#list+1]=t.text end;return table.concat(list,' ') end
reset();area:draw(field,'4 Pikachu\n2 Raichu',true,false,0,0,0,false,view)
check(wraps==2 and shownLines()=='4 Pikachu 2 Raichu','Each paragraph wraps to its own lines')
reset();area:draw(field,'4 Pikachu\n2 Raichu',true,false,0,0,1,false,view)
check(wraps==2 and shownLines()=='4 Pikachu 2 Raichu','An unchanged decklist keeps its wrap')
reset();area:draw(field,'3 Pichu',true,false,0,0,1,false,view)
check(wraps==3 and shownLines()=='3 Pichu','A new decklist wraps again')
reset();area:draw({x=10,y=20,w=200,h=220},'3 Pichu',true,false,0,0,1,false,view)
check(wraps==4,'So does a new width')
reset();area:draw(field,'',true,false,0,0,1,false,view)
check(shownLines()=='Paste here','An empty field shows its placeholder')
font.getWrap=nil

Button.panel,T.text,Button.draw,Button.cycleFace,Button.outline=panel,text,draw,cycleFace,outline
print('PASS: option cycle centre and arrows, pager arrows and face, titled deck pile, icon glyphs and the text area')
