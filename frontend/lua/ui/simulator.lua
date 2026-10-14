-- Full gameplay page. HUD cells follow create_UIBox_HUD; card areas follow
-- CardArea:draw/align_cards. Colors and pixels use globals.lua and engine/ui.lua.
local T=require('ui.theme')
local Button=require('ui.button')
local Card=require('ui.card')
local Pile=require('ui.deck_pile')
local Labels=require('ui.deck_labels')
local Library=require('ui.library')
local Codec=require('ui.account')
local PageText=require('ui.page_text')
local Modal=require('ui.modal')
local Simulator={};Simulator.__index=Simulator
local g=love.graphics
local function fit(text,size,x,y,w,colour)
  text=tostring(text or '')
  while size>12 and T.font(size):getWidth(text)>w do size=size-1 end
  T.text(text,size,x,y,w,colour)
end
local function inset(x,y,w,h)
  -- CardArea's area_uibox: r=0.1, colour={0,0,0,0.1}, no emboss.
  Button.panel(x,y,w,h,{0,0,0,0.1},1.2)
end
function Simulator.new(callbacks)
  return setmetatable({callbacks=callbacks,phase='empty',items={},cards={},piles={},art={},sides={},actions={},options={},footer={},controls={},time=0,focus=0,hover=0,page=1,notePage=1,pageText=PageText.new()},Simulator)
end
function Simulator:command(...)
  local fields={...};for i,v in ipairs(fields)do fields[i]=Codec.encode(tostring(v))end
  self.callbacks.command(table.concat(fields,'\t'))
end
function Simulator:open(reduced)
  self.reduced=reduced;self.drag=nil;self.focus=0;self.raw=nil;self:command('open')
end
function Simulator:layout(w,h)
  self.width,self.height=w,h
  self.portrait=w<600
  self.boardW,self.boardH=self.portrait and 480 or 1280,self.portrait and 850 or 800
  self.zoom=math.min(w/self.boardW,h/self.boardH)
  self.ox,self.oy=(w-self.boardW*self.zoom)/2,(h-self.boardH*self.zoom)/2
  self.drag=nil;self:makeCards(true);self:build()
end
function Simulator:point(x,y) return (x-self.ox)/self.zoom,(y-self.oy)/self.zoom end
function Simulator:face(item,w,h)
  if item.hidden or item.kind=='deck' or item.kind=='prize' then Library.face(self,item,w,h);return end
  local path=self.art[item.cardId]
  if path and love.filesystem.getInfo(path) then
    local ok,img=pcall(g.newImage,path)
    if ok then img:setFilter('linear','linear');g.setColor(1,1,1);g.draw(img,0,0,0,w/img:getWidth(),h/img:getHeight());img:release();return end
  end
  Button.panel(0,0,w,h,T.paper,1.2);Button.panel(4,4,w-8,h-8,T.panel,1.2)
  fit(item.name or '',20,8,65,w-16,T.white)
end
function Simulator:makeCards(resize)
  if not self.width then return end
  local old={};for _,c in ipairs(self.cards)do old[c.item.owner..':'..c.item.id]=c end
  self.cards={}
  local counts={};for _,item in ipairs(self.items)do local key=item.owner..item.zone;counts[key]=(counts[key]or 0)+1 end
  for i,item in ipairs(self.items)do
    local bottom=item.owner=='you';local x,y,scale=744,390,0.65
    local zone=item.zone;local n=counts[item.owner..zone] or 1
    if zone=='hand' then
      scale=bottom and 0.82 or 0.34
      local span=bottom and math.min(690,(n-1)*96) or math.min(490,(n-1)*44)
      x=735+(n>1 and (item.index/(n-1)-0.5)*span or 0);y=bottom and 690 or 52
    elseif zone=='bench' then scale=math.min(0.57,650/math.max(5,n)/152);x=735+(item.index-(n-1)/2)*math.min(125,670/math.max(n,1));y=bottom and 504 or 181
    elseif zone=='active' then x=735;y=bottom and 367 or 312;scale=0.61
      -- Active cards face each other across the table centre, away from benches.
      x=bottom and 823 or 635;y=342
    elseif zone=='discard' then x=1168;y=bottom and 493 or 184;scale=0.48
    elseif zone=='stadium' then x=340;y=342;scale=0.55
    elseif zone=='prize' then x=290.5+item.index%3*30;y=(bottom and 489 or 163)+math.floor(item.index/3)*43;scale=27/142 end
    if self.portrait then
      if zone=='hand' then scale=bottom and 0.55 or 0.22;local span=math.min(bottom and 340 or 250,(n-1)*(bottom and 60 or 26));x=240+(n>1 and (item.index/(n-1)-0.5)*span or 0);y=bottom and 691 or 153
      elseif zone=='bench' then scale=math.min(0.34,300/math.max(5,n)/152);x=245+(item.index-(n-1)/2)*math.min(61,300/n);y=bottom and 530 or 235
      elseif zone=='active' then x=bottom and 295 or 190;y=385;scale=0.48
      elseif zone=='stadium' then x=65;y=385;scale=0.4
      elseif zone=='discard' then x=425;y=bottom and 627 or 319;scale=0.3
      elseif zone=='prize' then x=24+item.index%3*18;y=(bottom and 526 or 221)+math.floor(item.index/3)*26;scale=16/142 end
    end
    item.edition='dissolve';item.resolution=2;item.drawFace=function(w,h)self:face(item,w,h)end
    local key=item.owner..':'..item.id;local c=old[key];old[key]=nil
    if c and c.item.cardId~=item.cardId then c.texture:release();c=nil end
    if not c then
      c=Card.new(item,i);c:place(x,y,scale,false)
      if not self.reduced then c.motion.VT.x=(self.portrait and 425 or 1080)/c.unit;c.motion.VT.y=(self.portrait and (bottom and 530 or 235)or(bottom and 480 or 180))/c.unit end
    else
      c.item=item
      if resize or math.abs(c.baseScale-scale)>0.001 then
        local px,py=c.x,c.y;c:place(x,y,scale,false);c.motion.VT.x=px/c.unit;c.motion.VT.y=py/c.unit
      else c.homeX,c.homeY=x,y end
    end
    c.fan=zone=='hand' and (item.index-(n-1)/2)/n or nil
    c.baseY=y
    c.motion.T.r=c.fan and 0.2*c.fan or 0
    c.dragging=false;self.cards[#self.cards+1]=c
  end
  for _,c in pairs(old)do c.texture:release()end
  for _,p in ipairs(self.piles)do p.texture:release()end;self.piles={}
  for _,owner in ipairs({'you','opponent'})do
    local side=self.sides[owner]
    if side then
      local item={id=owner..'deck',owner=owner,kind='deck',quantity=side.deck,copyLimit=60,count=side.deck,name='Deck',drawFace=function(w,h)Library.face(self,{},w,h)end}
      local p=Pile.new(item,1);p:place(self.portrait and 425 or 1070,self.portrait and(owner=='you'and 530 or 235)or(owner=='you'and 493 or 184),self.portrait and 0.32 or 0.49,false,self.boardW);self.piles[#self.piles+1]=p
    end
  end
end
function Simulator:sync(raw)
  if not raw or raw==self.raw then return end;self.raw=raw
  local rows={};for line in raw:gmatch('[^\n]+')do rows[#rows+1]=Codec.fields(line)end
  local f=rows[1];if not f then return end
  local previous=self.menuId
  self.revision,self.phase,self.you,self.opponent,self.turn,self.gamePhase,self.message,self.title,self.turnIndex,self.turnCount=tonumber(f[1]),f[2],f[3],f[4],tonumber(f[5]),f[6],f[7],f[8],tonumber(f[9]),tonumber(f[10])
  self.items={};self.sides={};self.actions={};self.options={};self.footer={};self.menuTitle=nil;self.menuId=nil;self.note='';self.outcome=''
  for i=2,#rows do local r=rows[i]
    if r[1]=='S' then self.sides[r[2]]={deck=tonumber(r[3]),prizes=tonumber(r[4]),hand=tonumber(r[5])}
    elseif r[1]=='C' then self.items[#self.items+1]={id=r[2],cardId=r[3],name=r[4],owner=r[5],zone=r[6],index=tonumber(r[7]),hidden=r[8]=='true',hp=tonumber(r[9]),damage=tonumber(r[10]),energy=tonumber(r[11]),status=r[12]}
    elseif r[1]=='A' or r[1]=='O' or r[1]=='F' then
      local list=r[1]=='A' and self.actions or r[1]=='O' and self.options or self.footer
      list[#list+1]={token=r[2],label=r[3],colour=T[r[4]]or T.blue,disabled=r[5]=='true',selected=r[6]=='true',cardId=r[7]}
    elseif r[1]=='M' then self.menuTitle,self.note,self.mandatory,self.menuId=r[2],r[3],r[4]=='true',r[5]or r[2]
    elseif r[1]=='N' then self.outcome=r[2] end
  end
  if previous~=self.menuId then self.page=1;self.notePage=1;self.focus=0;self.modalMotion=self.menuTitle and Modal.motion(self.reduced) or nil end
  if self.drag then self.drag.card.dragging=false;self.drag=nil end
  self:makeCards(false);self:build()
  self.callbacks.announce(self.message~='' and self.message or self.menuTitle or self.title)
end
function Simulator:add(label,x,y,w,h,action,colour,disabled,token)
  local b={label=label,x=x,y=y,w=w,h=h,action=action,colour=disabled and T.panel or colour or T.blue,disabled=disabled,fontSize=24,token=token}
  self.controls[#self.controls+1]=b;return b
end
function Simulator:build()
  self.controls={}
  if self.preview then self.preview.texture:release();self.preview=nil end
  if self.menuTitle then
    local x,y,w,h=self.portrait and 12 or 290,35,self.portrait and 456 or 800,self.portrait and 780 or 690
    self.dialog={x=x,y=y,w=w,h=h}
    local first=self.options[1]
    if first and first.disabled and first.cardId~='' then
      local item={id=first.cardId,cardId=first.cardId,name=first.label,edition='dissolve',resolution=2}
      item.drawFace=function(w,h)self:face(item,w,h)end
      self.preview=Card.new(item,1);self.preview:place(x+(self.portrait and 85 or 135),y+345,self.portrait and 1 or 1.4,false);self.preview.motion.T.r=0;self.preview.motion.VT.r=0
    end
    self.pages=math.max(1,math.ceil(#self.options/7));self.page=math.min(self.page,self.pages)
    self.pageText:set('Page '..self.page..'/'..self.pages,self.time)
    for i=(self.page-1)*7+1,math.min(self.page*7,#self.options)do
      local o=self.options[i];local b=self:add(o.label,x+(self.preview and (self.portrait and 174 or 260) or 24),y+175+(i-1)%7*49,w-(self.preview and (self.portrait and 198 or 284) or 48),39,'invoke',o.selected and T.green or o.colour,o.disabled,o.token)
      b.selected=o.selected;b.fontSize=22
    end
    if self.pages>1 then self:add('<',x+w/2-152,y+h-143,32,34,'prev',T.red);self:add('>',x+w/2+120,y+h-143,32,34,'next',T.red)end
    for i,o in ipairs(self.footer)do self:add(o.label,x+24+(i-1)*(w-48)/#self.footer,y+h-97,(w-48)/#self.footer-6,36,'invoke',o.colour,o.disabled,o.token)end
    if not self.mandatory then self:add('Back',x+24,y+h-47,w-48,35,'dismiss',T.orange)end
    if self.note~='' then
      local _,lines=T.font(20):getWrap(self.note,w-90);self.noteLines=lines
      self.notePages=math.max(1,math.ceil(#lines/4));self.notePage=math.min(self.notePage,self.notePages)
      if self.notePages>1 then self:add('>',x+w-49,y+89,26,30,'note',T.red)end
    else self.noteLines={} end
    return
  end
  if self.portrait then
    for i,o in ipairs(self.actions)do self:add(o.label,14+(i-1)*116,771,108,35,'invoke',o.colour,o.disabled,o.token).fontSize=20 end
    self:add('Log',14,815,70,28,'log',T.blue).fontSize=20
    self:add('<',94,815,28,28,'historyPrevious',T.red,(self.turnIndex or 0)<=0)
    self:add('>',130,815,28,28,'historyNext',T.red,(self.turnIndex or 0)>=(self.turnCount or 1)-1)
    self:add('New',168,815,44,28,'new',T.red).fontSize=18
    self:add('Options',220,815,102,28,'settings',T.orange).fontSize=20
    self:add('Save & Back',334,815,132,28,'leave',T.orange).fontSize=20
    return
  end
  local y=365
  for _,o in ipairs(self.actions)do self:add(o.label,34,y,176,40,'invoke',o.colour,o.disabled,o.token);y=y+51 end
  self:add('New game',34,566,176,23,'new',T.red).fontSize=19
  self:add('Game log',34,595,176,39,'log',T.blue)
  self:add('<',34,644,38,34,'historyPrevious',T.red,(self.turnIndex or 0)<=0)
  self:add('>',172,644,38,34,'historyNext',T.red,(self.turnIndex or 0)>=(self.turnCount or 1)-1)
  self:add('Options',34,696,176,36,'settings',T.orange)
  self:add('Save & Back',34,742,176,32,'leave',T.orange)
end
function Simulator:hit(x,y)
  if self.menuTitle and self.modalMotion then y=y-self.modalMotion.VT.y*60 end
  for i=#self.controls,1,-1 do local b=self.controls[i];if not b.disabled and Button.hit(b,x,y)then return i end end
  return 0
end
function Simulator:cardHit(x,y)
  if self.menuTitle then return nil end
  for i=#self.cards,1,-1 do if self.cards[i]:hit(x,y)then return self.cards[i]end end
end
function Simulator:update(dt,time,mx,my,reduced)
  self.time,self.reduced=time,reduced
  if love.filesystem.getInfo('__simulator.txt')then self:sync(love.filesystem.read('__simulator.txt'))end
  if love.filesystem.getInfo('__builder_art.txt')then
    local raw=love.filesystem.read('__builder_art.txt')
    if raw~=self.artRaw then
      self.artRaw=raw;local art={}
      for line in raw:gmatch('[^\n]+')do local r=Codec.fields(line);if r[2]then art[r[1]]=r[2]end end
      local old=self.art;self.art=art
      for _,c in ipairs(self.cards)do if old[c.item.cardId]~=art[c.item.cardId]then c:rebuild()end end
      if self.preview and old[self.preview.item.cardId]~=art[self.preview.item.cardId]then self.preview:rebuild()end
    end
  end
  if self.modalMotion then self.modalMotion:update(dt,time,false,false,reduced)end
  if self.preview then self.preview:update(dt,time,false,reduced)end
  mx,my=self:point(mx,my);self.mx,self.my=mx,my;self.hover=self:hit(mx,my)
  local hovered=self:cardHit(mx,my)
  if self.drag then
    local d=self.drag
    if not d.moved and (mx-d.x)^2+(my-d.y)^2>36 then d.moved=true;d.card.dragging=true end
    if d.moved then d.card.targetX,d.card.targetY=mx-d.dx,my-d.dy end
  end
  for _,c in ipairs(self.cards)do
    local active=not self.menuTitle and (c==hovered or self.focusCard==c)
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.callbacks.feedback('paper1')end
    if c.fan then
      -- CardArea:align_cards hand rotation, breathing and shallow arc.
      c.motion.T.r=0.2*c.fan+(reduced and 0 or 0.02*math.sin(2*time+c.homeX/c.unit))
      c.homeY=c.baseY+((reduced and 0 or 0.1*math.sin(0.666*time+c.homeX/c.unit))+math.abs(1.3*c.fan)^2-0.3)*c.unit
    end
    c:update(dt,time,active,reduced)
  end
  for _,p in ipairs(self.piles)do p:update(dt,time,not self.menuTitle and p:hit(mx,my),reduced,self.boardW)end
end
function Simulator:activate(index)
  local b=self.controls[index];if not b or b.disabled then return end
  self.callbacks.feedback('button')
  if b.action=='invoke'then self:command('invoke',self.revision,b.token)
  elseif b.action=='settings'then self.callbacks.settings()
  elseif b.action=='prev' or b.action=='next'then self.page=(self.page-1+(b.action=='prev'and -1 or 1)+self.pages)%self.pages+1;self:build()
  elseif b.action=='note'then self.notePage=self.notePage%self.notePages+1;self:build()
  elseif b.action=='historyPrevious' or b.action=='historyNext'then self:command('history',b.action=='historyPrevious'and'previous'or'next')
  else self:command(b.action)end
end
function Simulator:mousepressed(x,y)
  x,y=self:point(x,y);self.focus=0;self.focusCard=nil;self.pressed=self:hit(x,y)
  if self.pressed>0 or self.menuTitle then return end
  local c=self:cardHit(x,y)
  if c then
    self.clicked=c
    if c.item.owner=='you' and (c.item.zone=='hand' or c.item.zone=='bench' or c.item.zone=='active')then self.drag={card=c,x=x,y=y,dx=x-c.x,dy=y-c.y,moved=false}end
  end
end
function Simulator:mousereleased(x,y)
  x,y=self:point(x,y)
  if self.pressed and self.pressed>0 and self.pressed==self:hit(x,y)then self:activate(self.pressed)
  elseif self.drag and self.drag.moved then
    local d=self.drag;d.card.dragging=false
    local zone,index
    if self.portrait then
      if x>110 and x<390 and y>480 and y<577 then zone='bench';index=0;for _,c in ipairs(self.cards)do if c~=d.card and c.item.owner=='you'and c.item.zone=='bench'and c:hit(x,y)then index=c.item.index end end
      elseif x>255 and x<337 and y>330 and y<440 then zone='active';index=0
      elseif x>20 and x<110 and y>330 and y<440 then zone='stadium';index=0
      elseif y>130 and y<600 then zone='playmat';index=0 end
    elseif x>305 and x<1005 and y>430 and y<580 then
      zone='bench';index=math.max(0,math.floor((x-422)/125+0.5))
      for _,c in ipairs(self.cards)do if c~=d.card and c.item.owner=='you'and c.item.zone=='bench'and c:hit(x,y)then index=c.item.index;break end end
    elseif x>760 and x<890 and y>270 and y<425 then zone='active';index=0
    elseif x>285 and x<400 and y>270 and y<425 then zone='stadium';index=0
    elseif x>260 and y<590 then zone='playmat';index=0 end
    if zone then self:command('move',d.card.item.id,d.card.item.zone,d.card.item.index,zone,index)end
  elseif self.clicked and self.clicked==self:cardHit(x,y)then
    local c=self.clicked;c:juiceUp(self.time,nil,nil,self.reduced)
    if c.item.zone=='discard'then self:command('pile',c.item.owner)else self:command('card',c.item.id)end
  end
  self.drag=nil;self.clicked=nil;self.pressed=nil
end
function Simulator:keypressed(key)
  if key=='escape'then if self.menuTitle then self:command('dismiss')else self.callbacks.settings()end;return end
  if key=='tab' or key=='left' or key=='right' or key=='up' or key=='down'then
    local cardCount=self.menuTitle and 0 or #self.cards
    local total=#self.controls+cardCount;if total==0 then return end
    local delta=(key=='left'or key=='up'or(key=='tab'and love.keyboard.isDown('lshift','rshift')))and -1 or 1
    for _=1,total do self.focus=(self.focus-1+delta+total)%total+1
      local b=self.controls[self.focus];local c=self.cards[self.focus-#self.controls]
      if (b and not b.disabled)or(c and not c.item.hidden)then self.focusCard=c;self.callbacks.announce(b and b.label or c.item.name);break end
    end
  elseif key=='return'or key=='space'then
    if self.focusCard then self:command('card',self.focusCard.item.id)else self:activate(self.focus)end
  elseif key=='pageup'or key=='pagedown'then self:wheelmoved(key=='pageup'and 1 or -1)end
end
function Simulator:wheelmoved(y)
  if self.menuTitle and self.pages>1 then self.page=(self.page-1+(y>0 and -1 or 1)+self.pages)%self.pages+1;self:build()end
end
local function stat(label,value,x,y,w,colour)
  Button.panel(x,y,w,76,T.tray,1.2)
  fit(label,23,x,y+3,w,T.white)
  Button.panel(x+6,y+29,w-12,40,T.panel,1.2)
  T.text(tostring(value),34,x+5,y+26,w-10,colour)
end
function Simulator:draw(shaders)
  g.push();g.translate(self.ox,self.oy);g.scale(self.zoom)
  if self.portrait then
    Button.panel(10,12,460,108,T.panel,1.8)
    fit(self.you or 'Sandbox',28,16,21,188,T.white);fit(self.title or '',21,16,57,188,T.paper)
    fit(self.opponent or '',20,16,88,188,T.paper)
    stat('Turn',self.turn or 0,212,23,76,T.orange)
    stat('Hand',(self.sides.you or {}).hand or 0,296,23,76,T.blue)
    stat('Prizes',(self.sides.you or {}).prizes or 0,380,23,76,T.blue)
    inset(109,183,280,112);inset(109,479,280,110)
    inset(146,326,88,132);inset(251,326,88,132);inset(25,336,80,108)
    fit('Opponent',19,140,303,100,T.paper);fit('Your Active',19,246,303,100,T.paper)
    fit('Stadium',19,20,312,90,T.paper);fit('Bench',19,105,463,282,T.paper)
    fit('Discard',18,393,287,68,T.paper);fit('Discard',18,393,594,68,T.paper)
    fit(self.gamePhase=='setup:place'and 'Drag a Basic Pokemon to your Active spot' or 'Your hand',20,20,605,360,T.paper)
  else
  Button.panel(20,20,204,760,T.panel,1.8)
  Button.panel(28,28,188,92,T.panel)
  fit(self.you or 'Sandbox',31,34,39,176,T.white)
  fit(self.title or 'Choose decks',23,34,81,176,T.paper)
  stat('Turn',self.turn or 0,30,133,88,T.orange)
  stat('Hand',(self.sides.you or {}).hand or 0,126,133,88,T.blue)
  stat('Prizes',(self.sides.you or {}).prizes or 0,30,222,88,T.blue)
  stat('Opponent',(self.sides.opponent or {}).prizes or 0,126,222,88,T.red)
  fit(self.opponent or '',23,34,314,176,T.paper)
  fit(tostring((self.turnIndex or 0)+1)..' / '..tostring(self.turnCount or 0),21,74,649,96,T.white)
  -- Open playing field: transparent area wells, as in CardArea:draw.
  inset(390,107,620,146);inset(390,433,620,146)
  inset(575,263,121,157);inset(763,263,121,157)
  inset(290,265,105,153)
  fit('Stadium',20,290,242,105,T.paper)
  fit(self.opponent or '',24,408,81,570,T.white)
  fit('Bench',21,408,410,570,T.white)
  fit('Opponent Active',20,566,238,139,T.paper);fit('Your Active',20,763,238,121,T.paper)
  fit(self.gamePhase=='setup:place' and 'Drag a Basic Pokemon to your Active spot' or 'Your hand',22,407,584,600,T.paper)
  end
  for _,owner in ipairs({'opponent','you'})do
    local side=self.sides[owner]or{prizes=0,deck=0}
    local y=self.portrait and (owner=='you'and 515 or 210)or(owner=='you'and 471 or 145)
    local px,pw,ph,gapX,gapY=self.portrait and 16 or 277,self.portrait and 16 or 27,self.portrait and 22 or 36,self.portrait and 18 or 30,self.portrait and 26 or 43
    fit('Prizes',self.portrait and 18 or 21,self.portrait and 8 or 272,y-30,self.portrait and 72 or 100,T.paper)
    for i=1,side.prizes do
      local visible=false;for _,item in ipairs(self.items)do if item.owner==owner and item.zone=='prize'and item.index==i-1 then visible=true end end
      if not visible then g.push();g.translate(px+(i-1)%3*gapX,y+math.floor((i-1)/3)*gapY);Library.face(self,{},pw,ph);g.pop()end
    end
    if not self.portrait then fit('Discard',20,1128,owner=='you'and 421 or 112,86,T.paper)end
  end
  for _,p in ipairs(self.piles)do p:draw();Labels.drawQuantity(p)end
  for _,c in ipairs(self.cards)do if not c.dragging and not (c.hovered and c.item.zone=='hand') then
    c:draw(shaders,self.time,self.mx or 0,self.my or 0,self.reduced,self.boardW)
    if c.item.hp and not c.item.hidden then
      local y=c.y+95*c.baseScale+3
      Button.panel(c.x-43,y,86,20,T.panel,0.6)
      fit(tostring(math.max(0,c.item.hp-c.item.damage))..' / '..c.item.hp,18,c.x-43,y-1,86,c.item.damage>0 and T.red or T.white)
      if c.item.energy>0 then fit(c.item.energy..' Energy',16,c.x-48,y+19,96,T.paper)end
      if c.item.status~=''then fit(c.item.status,16,c.x-54,y-22,108,T.red)end
    end
  end end
  for _,c in ipairs(self.cards)do if c.hovered and c.item.zone=='hand'and not c.dragging then c:draw(shaders,self.time,self.mx or 0,self.my or 0,self.reduced,self.boardW)end end
  if self.drag and self.drag.moved then self.drag.card:draw(shaders,self.time,self.mx,self.my,self.reduced,self.boardW)end
  if self.message and self.message~=''then Button.panel(self.portrait and 12 or 280, self.portrait and 737 or 755,self.portrait and 456 or 950,32,T.panel);fit(self.message,self.portrait and 18 or 22,self.portrait and 18 or 289,self.portrait and 739 or 757,self.portrait and 444 or 932,T.red)end
  if self.outcome and self.outcome~=''then fit(self.outcome,24,self.portrait and 12 or 400,self.portrait and 609 or 596,self.portrait and 456 or 650,T.white)end
  if self.menuTitle then
    Modal.backdrop(self.boardW,self.boardH)
    g.push();g.translate(0,self.modalMotion and self.modalMotion.VT.y*60 or 0)
    local d=self.dialog
    Button.panel(d.x,d.y+6,d.w,d.h,T.panel,2.4)
    Button.panel(d.x,d.y,d.w,d.h,{191/255,199/255,213/255,1},2.4)
    Button.panel(d.x+4,d.y+4,d.w-8,d.h-8,T.tray,2.4)
    if self.preview then self.preview:draw(shaders,self.time,self.mx or 0,self.my or 0,self.reduced,self.boardW)end
    fit(self.menuTitle,32,d.x+20,d.y+18,d.w-40,T.white)
    local lines={};for i=(self.notePage-1)*4+1,math.min(self.notePage*4,#self.noteLines)do lines[#lines+1]=self.noteLines[i]end
    T.text(table.concat(lines,'\n'),20,d.x+24,d.y+66,d.w-90,T.paper,'left')
    if self.pages>1 then
      local x,y=d.x+d.w/2-114,d.y+d.h-143
      Button.cycleFace(x,y,228,34,Button.hit({x=x,y=y,w=228,h=34},self.mx or -1,self.my or -1))
      self.pageText:draw(self.time,self.reduced,x,y,228,34,self.boardW,0.4)
    end
  end
  for i,b in ipairs(self.controls)do
    Button.draw(b,self.hover==i or self.focus==i,self.pressed==i and self.hover==i,self.focus==i,self.boardW)
    if b.selected then g.setLineWidth(1.5);Button.outline(b.x-2,b.y-2,b.w+4,b.h+4,T.white,1.2)end
  end
  if self.menuTitle then g.pop()end
  g.pop()
end
return Simulator
