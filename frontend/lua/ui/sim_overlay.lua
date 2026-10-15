-- Overlay menus for the table: create_UIBox_generic_options (JOKER_GREY frame,
-- 0.1 emboss, L_BLACK body, orange Back) holding engine prompts rendered as
-- button lists or real card rows (the booster-pack picker), the coin flip,
-- the game log, discard piles, the options menu, hot-seat handoffs, a card
-- inspector and the game-over screen (create_UIBox_game_over).
local T=require('ui.theme')
local Button=require('ui.button')
local Modal=require('ui.modal')
local Dyna=require('ui.dynatext')
local Card=require('ui.card')
local Sprites=require('ui.sprites')
local Popup=require('ui.popup')
local PageText=require('ui.page_text')
local Overlay={};Overlay.__index=Overlay
local g=love.graphics
local JOKER_GREY={191/255,199/255,213/255,1}
local GREY_DARK={0.525,0.546,0.585,1}
local MONEY={243/255,185/255,88/255,1}
local function frame(x,y,w,h)
  Button.panel(x,y+6,w,h,GREY_DARK,2.4)
  Button.panel(x,y,w,h,JOKER_GREY,2.4)
  Button.panel(x+4,y+4,w-8,h-8,T.tray,2.4)
end
Overlay.frame=frame
local function lines(text)
  local out={}
  for line in (tostring(text or '')..'\n'):gmatch('(.-)\n') do out[#out+1]=line end
  while #out>0 and out[#out]=='' do out[#out]=nil end
  return out
end
function Overlay.new(sim,kind,data)
  local self=setmetatable({sim=sim,kind=kind,data=data or {},controls={},cards={},page=1,pages=1,scroll=0,focus=0,hover=0,
    motion=Modal.motion(sim.reduced),pageText=PageText.new(),created=sim.time},Overlay)
  self.motion.T.y=0
  local seat=(kind=='handoff') and (sim.viewerSeat=='p2' and T.red or T.blue) or nil
  self.titleText=Dyna.new({string=self.data.title or '',scale=kind=='gameover' and 1.1 or kind=='handoff' and 0.8 or 0.62,colours={kind=='gameover' and (sim.outcome=='win' and T.blue or T.red) or seat or T.white},shadow=true,float=true,pop_in=kind=='gameover' and 0.4 or nil,pop_in_rate=kind=='gameover' and 2 or 8,time=sim.time,maxw=kind=='gameover' and 520 or 600})
  self:layout()
  return self
end
function Overlay:offset() return self.motion.VT.y*60 end
function Overlay:release()
  for _,c in ipairs(self.cards) do c.texture:release() end
  self.cards={}
end
-- Keep the overlay when the same menu re-emits (selection toggles).
function Overlay:refresh(data)
  self.data=data
  self.titleText:set(data.title or '',self.sim.time)
  if self.kind=='cards' or self.kind=='pile' then
    for i,c in ipairs(self.cards) do local o=data.options[c.option];if o then c.item.selected=o.selected;c.item.disabled=o.disabled end end
  end
  self:build()
end
function Overlay:layout()
  local sim=self.sim
  local p=sim.portrait
  local W,H=sim.boardW,sim.boardH
  local w,h
  if self.kind=='cards' or self.kind=='pile' then
    -- Sized to the rows actually shown (one or two), like a booster pack.
    local perRow=(self.kind=='pile') and (p and 4 or 9) or (p and 3 or 8)
    local scale=(self.kind=='pile') and (p and 0.5 or 0.58) or 0.62
    local rows=math.max(1,math.min(2,math.ceil(#(self.data.options or {})/perRow)))
    w=p and 456 or 1040
    h=(self.kind=='pile' and 100 or 110)+rows*(190*scale+58)+8+(#(self.data.footer or {})>0 and 56 or 0)+(self.data.mandatory and 0 or 50)+28
    h=math.min(p and 760 or 700,h)
  elseif self.kind=='inspect' then w,h=p and 456 or 900,p and 780 or 640
  elseif self.kind=='gameover' then w,h=p and 456 or 720,p and 620 or 560
  elseif self.kind=='log' then w,h=p and 456 or 760,p and 760 or 640
  elseif self.kind=='coin' then w,h=p and 420 or 560,p and 440 or 400
  elseif self.kind=='handoff' then w,h=p and 400 or 520,p and 300 or 300
  elseif self.kind=='options' then w,h=p and 400 or 520,p and 520 or 500
  else
    -- Sized to the rows it holds: title band, note lines, up to seven
    -- 50px option rows, the page cycle, footer row and the Back button.
    local n=#(self.data.options or {})
    w=p and 440 or 600
    local noteH=0
    if self.data.note and self.data.note~='' then noteH=math.min(4,#Dyna.wrap(self.data.note,0.3,w-64))*18+12 end
    h=74+noteH+math.min(n,7)*50+(n>7 and 48 or 0)+(#(self.data.footer or {})>0 and 56 or 0)+(self.data.mandatory and 0 or 50)+22
    h=math.min(p and 780 or 700,h)
  end
  self.x,self.y,self.w,self.h=(W-w)/2,(H-h)/2,w,h
  self:build()
end
function Overlay:add(label,x,y,w,h,action,colour,extra)
  local b=extra or {}
  b.label,b.x,b.y,b.w,b.h,b.action=label,x,y,w,h,action
  b.colour=b.disabled and T.panel or colour or T.red
  b.fontSize=b.fontSize or 24
  self.controls[#self.controls+1]=b
  return b
end
function Overlay:makeCards(options,perRow,rows,scale,top)
  self:release()
  local sim=self.sim
  self.perPage=perRow*rows
  self.pages=math.max(1,math.ceil(#options/self.perPage))
  self.page=math.min(self.page,self.pages)
  local spacing=math.min(142*scale+18,(self.w-60)/perRow)
  local first=(self.page-1)*self.perPage
  for i=first+1,math.min(#options,first+self.perPage) do
    local o=options[i]
    local k=i-first-1
    local row=math.floor(k/perRow)
    local inRow=math.min(perRow,#options-first-row*perRow)
    local col=k%perRow
    local x=self.x+self.w/2+(col-(inRow-1)/2)*spacing
    local y=top+95*scale+row*(190*scale+58)
    local item={id=o.uid~='' and o.uid or ('opt'..i),cardId=o.cardId,name=o.label,hidden=o.cardId=='' or o.cardId=='hidden',selected=o.selected,disabled=o.disabled,edition='dissolve',resolution=2}
    local card=sim:newCard(item,i,x,y,scale)
    if not sim.reduced then card.motion.VT.x=(self.x+self.w/2)/card.unit;card.motion.VT.y=(top+95*scale+row*(190*scale+58))/card.unit end
    card.option=i
    card.optionIndex=i
    self.cards[#self.cards+1]=card
  end
end
function Overlay:build()
  self.controls={}
  local sim=self.sim
  local p=sim.portrait
  local x,y,w,h=self.x,self.y,self.w,self.h
  local d=self.data
  local kind=self.kind
  local bw=w-48
  local bottom=y+h-54
  local function back(label,action)
    self:add(label or 'Back',x+24,bottom,bw,38,action or 'back',T.orange,{fontSize=26})
  end
  local function footer(items,yy)
    if not items or #items==0 then return end
    local n=#items
    local fw=(bw-(n-1)*8)/n
    for i,o in ipairs(items) do
      self:add(o.label,x+24+(i-1)*(fw+8),yy,fw,40,'invoke',o.colour,{token=o.token,disabled=o.disabled,fontSize=24,selected=o.selected})
    end
  end
  if kind=='list' then
    local top=y+74
    if d.note and d.note~='' then self.noteLines=Dyna.wrap(d.note,0.3,bw-16);top=top+math.min(4,#self.noteLines)*18+12 else self.noteLines={} end
    local perPage=7
    self.pages=math.max(1,math.ceil(#d.options/perPage));self.page=math.min(self.page,self.pages)
    self.pageText:set('Page '..self.page..'/'..self.pages,sim.time)
    for i=(self.page-1)*perPage+1,math.min(self.page*perPage,#d.options) do
      local o=d.options[i]
      local b=self:add(o.label,x+24,top+((i-1)%perPage)*50,bw,40,'invoke',o.selected and T.green or o.colour,{token=o.token,disabled=o.disabled,selected=o.selected,fontSize=23})
      b.uid=o.uid
    end
    local fy=bottom-(d.mandatory and 0 or 50)
    if self.pages>1 then
      self:add('<',x+w/2-150,fy-48,34,36,'prev',T.red);self:add('>',x+w/2+116,fy-48,34,36,'next',T.red)
    end
    footer(d.footer,fy)
    if not d.mandatory then back() end
  elseif kind=='cards' or kind=='pile' then
    local top=y+(kind=='pile' and 100 or 110)
    local perRow=p and 3 or 8
    local rows=p and 2 or 2
    local scale=p and 0.62 or 0.62
    if kind=='pile' then perRow=p and 4 or 9;scale=p and 0.5 or 0.58 end
    self.cardTop=top
    self.cardScale=scale
    self:makeCards(d.options,perRow,rows,scale,top)
    if d.note and d.note~='' then self.noteLines=Dyna.wrap(d.note,0.28,bw-16) else self.noteLines={} end
    for _,c in ipairs(self.cards) do
      self.controls[#self.controls+1]={label=c.item.name,x=c.homeX-71*c.baseScale,y=c.homeY-95*c.baseScale,w=142*c.baseScale,h=190*c.baseScale,action='card',card=c,disabled=c.item.disabled and kind=='cards',fontSize=20,token=d.options[c.option].token}
    end
    local fy=bottom-(d.mandatory and 0 or 50)
    if self.pages>1 then
      self.pageText:set('Page '..self.page..'/'..self.pages,sim.time)
      self:add('<',x+w/2-150,fy-48,34,36,'prev',T.red);self:add('>',x+w/2+116,fy-48,34,36,'next',T.red)
    end
    footer(d.footer,fy)
    if not d.mandatory then back() end
  elseif kind=='coin' then
    self.flips={}
    for i,line in ipairs(lines(d.note)) do
      local who,result=line:match('^(.-):%s*(%a+)%s*$')
      self.flips[#self.flips+1]={who=who or '',heads=(result or ''):lower()=='heads',start=self.created+0.25+(i-1)*0.55,landed=false}
    end
    footer(d.footer,bottom-50)
    for _,o in ipairs(d.options) do self:add(o.label,x+24,bottom,bw,38,'invoke',o.colour,{token=o.token,fontSize=26}) end
  elseif kind=='log' then
    -- Rows arrive as "who<TAB>name<TAB>elapsed<TAB>text"; a turn divider as
    -- "turn<TAB><TAB><TAB>Turn N". Wrapped continuation lines indent under
    -- the text column.
    self.logLines={}
    local textW=bw-24-(p and 0 or 150)
    for line in (tostring(d.note or '')..'\n'):gmatch('(.-)\n') do
      local who,name,elapsed,text=line:match('^([^\t]*)\t([^\t]*)\t([^\t]*)\t(.*)$')
      if not who then who,name,elapsed,text='system','','',line end
      if who=='turn' then self.logLines[#self.logLines+1]={turn=text}
      else
        local wrapped=Dyna.wrap(text,0.3,textW)
        for i,wl in ipairs(wrapped) do
          self.logLines[#self.logLines+1]={who=who,name=i==1 and name or '',elapsed=i==1 and elapsed or '',text=wl}
        end
      end
    end
    self.visible=p and 24 or 19
    self.pages=math.max(1,math.ceil(#self.logLines/self.visible))
    self.page=math.min(self.pages,math.max(self.page,self.pages))
    self.pageText:set('Page '..self.page..'/'..self.pages,sim.time)
    if self.pages>1 then self:add('<',x+w/2-150,bottom-48,34,36,'prev',T.red);self:add('>',x+w/2+116,bottom-48,34,36,'next',T.red) end
    back()
  elseif kind=='options' then
    local top=y+78
    local col=bw
    self:add('Settings',x+24,top,col,42,'settings',T.red,{fontSize=27})
    self:add('Game log',x+24,top+54,col,42,'log',T.blue,{fontSize=27})
    local canBack=(sim.turnIndex or 0)>0
    local canFwd=(sim.turnIndex or 0)<(sim.turnCount or 1)-1
    self:add('<',x+24,top+128,42,42,'historyPrevious',T.red,{disabled=not canBack,fontSize=28})
    self:add('>',x+w-66,top+128,42,42,'historyNext',T.red,{disabled=not canFwd,fontSize=28})
    self.historyLabel='Step '..tostring((sim.turnIndex or 0)+1)..' of '..tostring(math.max(1,sim.turnCount or 1))
    self:add('New game',x+24,top+192,col,42,'new',T.red,{fontSize=27})
    self:add('Concede',x+24,top+246,col,42,'concede',T.red,{fontSize=27,disabled=sim.phase~='ready' or sim.outcome~=''})
    self:add('Save & back to menu',x+24,top+300,col,42,'leave',T.orange,{fontSize=25})
    back('Back','back')
  elseif kind=='inspect' then
    local item=d.item
    local scale=p and 1.2 or 1.62
    self:release()
    local info=sim.info[item.cardId]
    if info then self.popup=Popup.build(info,item,p and 420 or 380,sim.boardW) else self.popup=nil end
    local actions=d.actions or {}
    local popupH=self.popup and self.popup.h or 0
    -- Size the frame to its contents: the scan beside the popup and action rows.
    local contentH=p and (40+190*scale+popupH+24+#actions*46) or math.max(36+190*scale+12,36+popupH+16+#actions*46)
    h=math.min(sim.boardH-20,contentH+78)
    y=(sim.boardH-h)/2
    self.y,self.h=y,h
    bottom=y+h-54
    local cx=p and x+w/2 or x+24+71*scale
    local cy=p and y+40+95*scale or y+36+95*scale
    local card=sim:newCard({id=item.id,cardId=item.cardId,name=item.name,hidden=item.hidden,edition='dissolve',resolution=2},1,cx,cy,scale)
    card.motion.T.r=0;card.motion.VT.r=0
    self.cards[1]=card
    local ax=p and x+24 or x+24+142*scale+24
    local ay=p and (y+40+190*scale+popupH+24) or (y+36+popupH+16)
    local aw=p and bw or w-(ax-x)-24
    for i,a in ipairs(actions) do
      self:add(a.label,ax,ay+(i-1)*46,aw,38,'cardAction',a.colour,{token=a.token,disabled=a.disabled,fontSize=22,cardAction=a})
    end
    self:add('Back',x+24,bottom,bw,38,'back',T.orange,{fontSize=26})
  elseif kind=='handoff' then
    self:add(d.button or 'Continue',x+24,bottom,bw,40,'handoff',T.blue,{fontSize=28})
  elseif kind=='gameover' then
    local top=y+h-150
    if p then
      self:add('New game',x+24,top,bw,40,'newgame',T.red,{fontSize=26})
      self:add('Game log',x+24,top+48,bw/2-4,40,'log',T.blue,{fontSize=24})
      self:add('Main menu',x+24+bw/2+4,top+48,bw/2-4,40,'leave',T.red,{fontSize=24})
    else
      self:add('New game',x+24,top,bw/2-4,44,'newgame',T.red,{fontSize=27})
      self:add('Main menu',x+24+bw/2+4,top,bw/2-4,44,'leave',T.red,{fontSize=27})
      self:add('Game log',x+24,top+54,bw/2-4,40,'log',T.blue,{fontSize=24})
      self:add('View table',x+24+bw/2+4,top+54,bw/2-4,40,'peek',T.profile,{fontSize=24})
    end
  end
end
function Overlay:hit(x,y)
  y=y-self:offset()
  for i=#self.controls,1,-1 do
    local b=self.controls[i]
    if not b.disabled then
      if b.card then if b.card:hit(x,y) then return i end
      elseif Button.hit(b,x,y) then return i end
    end
  end
  return 0
end
function Overlay:update(dt,time,mx,my,reduced)
  self.time=time
  self.motion:update(dt,time,false,false,reduced)
  self.titleText:update(time,reduced)
  self.hover=self:hit(mx,my)
  local ly=my-self:offset()
  for i,c in ipairs(self.cards) do
    local active=false
    for _,b in ipairs(self.controls) do if b.card==c and (self.hover==i or self.controls[self.hover]==b or self.controls[self.focus]==b) then active=true end end
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.sim.callbacks.feedback('paper1',0.9+love.math.random()*0.2) end
    c.lift=c.item.selected and 0.2*190*c.baseScale or 0
    c:update(dt,time,active,reduced)
  end
  if self.kind=='coin' then
    for _,f in ipairs(self.flips) do
      if not f.landed and time>=f.start+0.9 then f.landed=true;self.sim.callbacks.feedback('coin'..(f.heads and '3' or '1'),f.heads and 1.05 or 0.9);self.sim.callbacks.jiggle(0.5) end
    end
  end
end
function Overlay:activate(i)
  local b=self.controls[i]
  if not b or b.disabled then return end
  local sim=self.sim
  sim.callbacks.feedback('button')
  local a=b.action
  if a=='invoke' or a=='card' then sim:invoke(b.token)
  elseif a=='back' then sim:closeOverlay(true)
  elseif a=='prev' or a=='next' then
    self.page=(self.page-1+(a=='prev' and -1 or 1)+self.pages)%self.pages+1
    self:build()
  elseif a=='handoff' then sim:finishHandoff()
  elseif a=='settings' then sim:closeOverlay();sim.callbacks.settings()
  elseif a=='log' then sim:command('log')
  elseif a=='historyPrevious' then sim:command('history','previous')
  elseif a=='historyNext' then sim:command('history','next')
  elseif a=='new' then sim:command('new')
  elseif a=='concede' then sim:command('concede')
  elseif a=='newgame' then sim:command('newgame')
  elseif a=='leave' then sim:command('leave')
  elseif a=='peek' then sim.peek=true
  elseif a=='cardAction' then sim:closeOverlay();sim:runCardAction(b.cardAction)
  end
end
function Overlay:keypressed(key)
  local sim=self.sim
  if key=='escape' then
    if self.kind=='handoff' then sim:finishHandoff() elseif not self.data.mandatory and self.kind~='gameover' then sim:closeOverlay(true) end
    return true
  end
  if key=='tab' or key=='left' or key=='right' or key=='up' or key=='down' then
    local total=#self.controls;if total==0 then return true end
    local delta=(key=='left' or key=='up' or (key=='tab' and love.keyboard.isDown('lshift','rshift'))) and -1 or 1
    for _=1,total do self.focus=(self.focus-1+delta+total)%total+1;if not self.controls[self.focus].disabled then break end end
    local b=self.controls[self.focus];if b then sim.callbacks.announce(b.label) end
    return true
  elseif key=='return' or key=='space' then self:activate(self.focus);return true
  elseif key=='pageup' or key=='pagedown' then self:wheelmoved(key=='pageup' and 1 or -1);return true end
  return false
end
function Overlay:wheelmoved(y)
  if (self.pages or 1)>1 then self.page=(self.page-1+(y>0 and -1 or 1)+self.pages)%self.pages+1;self:build() end
end
local function cycle(self,x,y,w,h)
  local hovered=Button.hit({x=x,y=y,w=w,h=h},self.sim.mx or -1,(self.sim.my or -1)-self:offset())
  Button.cycleFace(x,y,w,h,hovered)
  self.pageText:draw(self.time or 0,self.sim.reduced,x,y,w,h,self.sim.boardW,0.4)
end
function Overlay:draw(shaders)
  local sim=self.sim
  local p=sim.portrait
  local rw=sim.boardW
  local x,y,w,h=self.x,self.y,self.w,self.h
  local d=self.data
  g.push();g.translate(0,self:offset())
  frame(x,y,w,h)
  local kind=self.kind
  if kind~='inspect' and kind~='handoff' and kind~='gameover' then self.titleText:draw(x+w/2,y+38,rw) end
  if kind=='list' then
    local top=y+74
    for i=1,math.min(4,#(self.noteLines or {})) do Dyna.static(self.noteLines[i],0.3,x+32,top+(i-1)*18,w-64,18,JOKER_GREY,{roomWidth=rw}) end
    if self.pages>1 then cycle(self,x+w/2-112,y+h-54-(d.mandatory and 0 or 50)-48,224,36) end
  elseif kind=='cards' or kind=='pile' then
    local top=y+(kind=='pile' and 64 or 66)
    for i=1,math.min(2,#(self.noteLines or {})) do Dyna.static(self.noteLines[i],0.28,x+32,top+(i-1)*16,w-64,16,JOKER_GREY,{roomWidth=rw}) end
    -- The pack tray: G.C.BLACK inset with a 0.05 emboss, like the collection.
    local shownRows=math.max(1,math.min(2,math.ceil(#(d.options or {})/(self.perPage/2))))
    local tx,ty,tw,th=x+20,self.cardTop-4,w-40,(190*self.cardScale+58)*shownRows-20
    Button.panel(tx,ty+3,tw,th,{T.panel[1]*0.7,T.panel[2]*0.7,T.panel[3]*0.7,1})
    Button.panel(tx,ty,tw,th,T.panel)
    for _,c in ipairs(self.cards) do
      if c.item.selected then
        g.setLineWidth(2)
        Button.outline(c.x-71*c.baseScale*c.motion.VT.scale-3,c.y-95*c.baseScale*c.motion.VT.scale-3,142*c.baseScale*c.motion.VT.scale+6,190*c.baseScale*c.motion.VT.scale+6,T.white,1.2)
      end
      c:draw(shaders,self.time or 0,sim.mx or 0,(sim.my or 0)-self:offset(),sim.reduced,rw)
      if c.item.disabled and kind=='cards' then g.setColor(0,0,0,0.35);g.rectangle('fill',c.x-71*c.baseScale,c.y-95*c.baseScale,142*c.baseScale,190*c.baseScale) end
      local o=d.options[c.option]
      Dyna.static(o and o.label or c.item.name,0.26,c.homeX-80,c.homeY+95*c.baseScale+6,160,16,c.item.selected and T.white or JOKER_GREY,{roomWidth=rw,fit=true,shadow=c.item.selected})
    end
    if self.pages>1 then cycle(self,x+w/2-112,y+h-54-(d.mandatory and 0 or 50)-48,224,36) end
  elseif kind=='coin' then
    local n=#self.flips
    local spacing=math.min(130,(w-60)/math.max(n,1))
    for i,f in ipairs(self.flips) do
      local cx=x+w/2+(i-(n+1)/2)*spacing
      local cy=y+h/2-14
      local age=math.max(0,(self.time or 0)-f.start)
      local t=math.min(age/0.9,1)
      local flip=1
      local lift=0
      local chip=Sprites.WHITE
      if age>0 and t<1 then
        flip=math.cos(t*math.pi*7)
        lift=math.sin(t*math.pi)*56
        chip=flip>=0 and Sprites.WHITE or Sprites.BLACK
      elseif t>=1 then chip=f.heads and Sprites.WHITE or Sprites.BLACK;flip=1 end
      local px=(cx-rw/2)/(rw/2)*1.5
      if not Sprites.chip(chip,cx,cy-lift,88,sim.reduced and 0 or math.sin((self.time or 0)*0.7+i)*0.06,math.max(0.08,math.abs(flip)),px,0.1+lift/120) then
        g.setColor(T.white);g.circle('fill',cx,cy-lift,40,8)
      end
      if f.landed then
        Dyna.static(f.heads and 'HEADS' or 'TAILS',0.42,cx-60,cy+56,120,22,f.heads and T.blue or T.red,{roomWidth=rw})
        Dyna.static(f.who,0.26,cx-70,cy+80,140,16,JOKER_GREY,{roomWidth=rw,fit=true})
      end
    end
  elseif kind=='log' then
    local top=y+74
    local first=(self.page-1)*self.visible
    local seatColour={p1=T.blue,p2=T.red,system=JOKER_GREY}
    for i=first+1,math.min(#self.logLines,first+self.visible) do
      local line=self.logLines[i]
      local ly=top+(i-first-1)*(p and 24 or 25)
      if line.turn then
        Dyna.static(line.turn,0.3,x+32,ly,w-64,20,MONEY,{align='center',roomWidth=rw})
      elseif p then
        Dyna.static(line.text,0.3,x+32,ly,w-64,20,T.white,{align='left',roomWidth=rw})
      else
        -- Elapsed stamp, the seat's name in its colour, then the line.
        Dyna.static(line.elapsed,0.26,x+32,ly+1,56,20,JOKER_GREY,{align='left',roomWidth=rw,shadow=false})
        Dyna.static(line.name,0.3,x+92,ly,90,20,seatColour[line.who] or JOKER_GREY,{align='left',fit=true,roomWidth=rw})
        Dyna.static(line.text,0.3,x+32+150,ly,w-64-150,20,T.white,{align='left',roomWidth=rw})
      end
    end
    if self.pages>1 then cycle(self,x+w/2-112,y+h-54-48,224,36) end
  elseif kind=='options' then
    -- create_option_cycle: embossed red centre between the two arrows.
    local cx,cw=x+72,w-144
    Button.cycleFace(cx,y+78+128,cw,42,false)
    Dyna.static(self.historyLabel or '',0.4,cx,y+78+128,cw,42,T.white,{roomWidth=rw})
    Dyna.static('Rewind the game',0.26,x+72,y+78+108,w-144,14,JOKER_GREY,{roomWidth=rw,shadow=false})
  elseif kind=='inspect' then
    local item=d.item
    Dyna.static(item.name,0.5,x+24,y+8,w-48,30,T.white,{roomWidth=rw,fit=true})
    local c=self.cards[1]
    if c then c:draw(shaders,self.time or 0,sim.mx or 0,(sim.my or 0)-self:offset(),sim.reduced,rw) end
    if self.popup then
      local px=p and x+(w-self.popup.w)/2 or x+24+142*(c and c.baseScale or 1.6)+24
      local py=p and y+40+190*(c and c.baseScale or 1.2)+12 or y+36
      self.popup.draw(px,py)
    end
  elseif kind=='handoff' then
    Dyna.static('PASS THE TABLE TO',0.36,x+24,y+40,w-48,20,JOKER_GREY,{roomWidth=rw})
    self.titleText:draw(x+w/2,y+100,rw)
    Dyna.static(d.note or '',0.3,x+24,y+150,w-48,18,T.white,{roomWidth=rw,fit=true})
    Dyna.static('Keep your hand hidden until the other player looks away.',0.24,x+24,y+180,w-48,14,JOKER_GREY,{roomWidth=rw,fit=true,shadow=false})
  elseif kind=='gameover' then
    self.titleText:draw(x+w/2,y+60,rw)
    -- Stats: BLACK box, emboss 0.05, rows of label / value like round_scores_row.
    local bx,by,bw,bh=x+24,y+110,w-48,#(d.rows or {})*34+20
    Button.panel(bx,by+3,bw,bh,{T.panel[1]*0.7,T.panel[2]*0.7,T.panel[3]*0.7,1})
    Button.panel(bx,by,bw,bh,T.panel)
    local rows=d.rows or {}
    for i,r in ipairs(rows) do
      local ry=by+12+(i-1)*34
      Dyna.static(r.label,0.34,bx+16,ry,bw/2,24,JOKER_GREY,{align='left',roomWidth=rw})
      Dyna.static(r.value,0.4,bx+bw/2,ry-2,bw/2-16,28,r.colour or T.white,{align='right',roomWidth=rw,fit=true})
    end
  end
  for i,b in ipairs(self.controls) do
    if not b.card then
      Button.draw(b,not b.disabled and (self.hover==i or self.focus==i),self.sim.pressedOverlay==i and self.hover==i,self.focus==i,rw)
      if b.selected then g.setLineWidth(1.5);Button.outline(b.x-2,b.y-2,b.w+4,b.h+4,T.white,1.2) end
    end
  end
  g.pop()
end
return Overlay
