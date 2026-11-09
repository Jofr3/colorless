local D=require('ui.card_dimensions')
local WheelPager=require('ui.wheel_pager')
-- Overlay menus for the table: create_UIBox_generic_options (T.jokerGrey frame,
-- 0.1 emboss, L_BLACK body, orange Back) holding engine prompts rendered as
-- button lists or real card rows (the booster-pack picker), the coin flip,
-- the game log, discard piles, the options menu, a card
-- inspector and the game-over screen (create_UIBox_game_over). Online, Leave
-- match uses delete_profile's press-again confirm because leaving forfeits.
local T=require('ui.theme')
local Controls=require('ui.controls')
local Button=require('ui.button')
local Modal=require('ui.modal')
local Dyna=require('ui.dynatext')
local Sprites=require('ui.sprites')
local Popup=require('ui.popup')
local PageText=require('ui.page_text')
local CollectionMotion=require('ui.collection_motion')
local Motion=require('ui.motion')
local Pager=require('ui.pager')
local Speech=require('ui.sim_speech')
local Display=require('ui.display')
local Size=require('ui.interface_size')
local Overlay={};Overlay.__index=Overlay
local g=love.graphics
local function lines(text)
  local out={}
  for line in (tostring(text or '')..'\n'):gmatch('(.-)\n') do out[#out+1]=line end
  while #out>0 and out[#out]=='' do out[#out]=nil end
  return out
end
-- The overlay keeps its simulator. It reads time, reduced, mx, my, boardW,
-- boardH, portrait, viewportUnit, L.zones, mode, phase, outcome, flags, info
-- and pressedOverlay; it writes only peek (Peek) and pressedOverlay (cleared on
-- a page change). It calls callbacks.{feedback,announce,jiggle,settings} and
-- the methods command, invoke, newCard, closeOverlay, runCardAction, rematch
-- and rematchPending.
function Overlay.new(sim,kind,data)
  local self=setmetatable({sim=sim,kind=kind,data=data or {},controls={},cards={},page=1,pages=1,focus=0,hover=0,
    motion=Modal.motion(sim.reduced),pageText=PageText.new(),created=sim.time,leaveJuice=Motion.new(0,0)},Overlay)
  self.motion.T.y=0
  self.titleText=Dyna.new({string=self.data.title or '',scale=kind=='gameover' and 1.1 or 0.62,colours={kind=='gameover' and (sim.outcome=='win' and T.blue or T.red) or T.white},shadow=true,float=true,pop_in=kind=='gameover' and 0.4 or nil,pop_in_rate=kind=='gameover' and 2 or 8,time=sim.time,maxw=kind=='gameover' and 520 or 600})
  self:layout()
  self.pendingAnnounce=self:opening()
  return self
end
-- What a tray or the log says as it opens. It is spoken on the overlay's first
-- update, after the snapshot that opened it has announced its own line.
function Overlay:opening()
  local d=self.data
  if self.kind=='cards' or self.kind=='pile' then
    local parts={}
    if (d.title or '')~='' then parts[#parts+1]=d.title end
    local line=(self.instructionText or '')~='' and self.instructionText or (d.note or ''):gsub('%s*\n%s*',' ')
    if line~='' then parts[#parts+1]=line end
    local n=#(d.options or {})
    parts[#parts+1]=n==0 and (self.kind=='pile' and 'Discard pile is empty' or 'No cards') or n..(n==1 and ' card' or ' cards')
    return Speech.sentences(parts)
  elseif self.kind=='log' then
    local n=#self.logEntries
    if n==0 then return 'Game log, no entries yet' end
    local parts={'Game log, '..n..(n==1 and ' entry' or ' entries')}
    local from=math.max(1,n-2)
    for i=from,n do parts[#parts+1]=(i==from and 'Latest: ' or '')..self.logEntries[i].text end
    parts[#parts+1]='Up and down read the log'
    return Speech.sentences(parts)
  end
end
-- A tray's one line of instruction: the prompt's note, else, while an effect
-- asks, the header's hint or the name of the card being played.
function Overlay:instruction()
  local d=self.data
  if (d.note or '')~='' then return (d.note:gsub('%s*\n%s*',' ')) end
  local sim=self.sim
  if self.kind~='cards' or sim.gamePhase~='effect:choose' then return '' end
  if (sim.hint or '')~='' then return sim.hint end
  for _,it in ipairs(sim.items or {}) do
    if it.zone=='played' and it.owner=='you' and not it.hidden then return it.name end
  end
  return ''
end
function Overlay:offset() return self.motion.VT.y*60 end
function Overlay:release()
  for _,c in ipairs(self.cards) do c.texture:release() end
  self.cards={}
end
-- Keep the overlay when the same menu re-emits (selection toggles).
function Overlay:refresh(data)
  local cardGrid=self.kind=='cards' or self.kind=='pile'
  local keepCards=cardGrid and #self.data.options==#data.options
  if keepCards then
    for i,o in ipairs(data.options) do
      local previous=self.data.options[i]
      if not previous or previous.uid~=o.uid or previous.cardId~=o.cardId then keepCards=false;break end
    end
  end
  self.data=data
  self.titleText:set(data.title or '',self.sim.time)
  local toggled=self.toggled and data.options[self.toggled]
  if toggled then self.pendingAnnounce=self:selection(toggled,data) end
  self.toggled=nil
  if keepCards then
    for _,c in ipairs(self.cards) do
      local o=data.options[c.option]
      c.item.selected=o.selected;c.item.disabled=o.disabled;c.item.name=o.label
      c.greyed=self.kind=='cards' and (o.disabled or o.dimmed) or false
    end
  end
  if cardGrid and not keepCards then self:layout() else self:build(keepCards) end
end
-- '<name>, selected, 2 of 3' from the host's re-emitted menu: the count is
-- how many are picked, out of the x/N on the confirm button when it has one.
function Overlay:selection(option,data)
  local picked=0
  for _,o in ipairs(data.options) do if o.selected then picked=picked+1 end end
  local max
  for _,f in ipairs(data.footer or {}) do max=max or (f.label or ''):match('^%d+/(%d+)$') end
  return option.label..', '..(option.selected and 'selected' or 'not selected')..', '..picked..(max and ' of '..max or ' chosen')
end
function Overlay:layout()
  local sim=self.sim
  local p=sim.portrait
  local W,H=sim.boardW,sim.boardH
  local w,h
  if self.kind=='cards' or self.kind=='pile' then
    self.cardGap=8
    -- Keep room for lift, held-card zoom and shadows outside the tight grid.
    self.cardPadding=24
    local compact=(self.data.title or '')==''
    self.instructionText=compact and self:instruction() or ''
    local band=self.instructionText~='' and 24 or 0
    local maxColumns=5
    self.cardColumns=compact and math.max(1,math.min(maxColumns,#(self.data.options or {}))) or maxColumns
    self.cardHeader=compact and 24+band or 110
    w=p and 456 or math.min(W-40,maxColumns*D.W*sim.L.zones.you_hand.scale+(maxColumns-1)*self.cardGap+2*self.cardPadding+48)
    local widest=w
    local unitBounds=CollectionMotion.bounds(maxColumns,1,0)
    self.cardScale=math.min(sim.L.zones.you_hand.scale,(w-48-(maxColumns-1)*self.cardGap-2*self.cardPadding)/unitBounds.width)
    local bounds=CollectionMotion.bounds(self.cardColumns,self.cardScale,self.cardGap)
    w=bounds.width+2*self.cardPadding+48
    -- A narrow tray widens for its instruction line, up to the full tray.
    if band>0 then w=math.max(w,math.min(widest,Dyna.measure(self.instructionText,0.28)+64)) end
    self.cardRowHeight=bounds.height
    local count=#(self.data.options or {})
    local rows=math.max(1,math.ceil(count/self.cardColumns))
    local fixed=self.cardHeader+(#(self.data.footer or {})>0 and 64 or 0)+(self.data.mandatory and 0 or 64)+24
    local available=math.min(H-40,p and 760 or 700)-fixed
    local function fittingRows(room)
      return math.max(1,math.floor((room-2*self.cardPadding+self.cardGap)/(self.cardRowHeight+self.cardGap)))
    end
    local pageBand=rows>fittingRows(available) and 39 or 0
    self.cardRows=math.min(rows,fittingRows(available-pageBand))
    self.perPage=self.cardRows*self.cardColumns
    self.pages=math.max(1,math.ceil(count/self.perPage))
    self.page=math.min(self.page,self.pages)
    self.contentHeight=self.cardRows*self.cardRowHeight+(self.cardRows-1)*self.cardGap+2*self.cardPadding
    h=fixed+self.contentHeight+pageBand
  elseif self.kind=='inspect' then w,h=p and 456 or 900,p and 780 or 640
  elseif self.kind=='gameover' then w,h=p and 456 or 720,p and 620 or 560
  elseif self.kind=='log' then w,h=p and 456 or 760,p and 760 or 640
  elseif self.kind=='coin' then w,h=p and 420 or 560,p and 440 or 400
  elseif self.kind=='options' then
    -- create_UIBox_generic_options + UIBox:calculate_xywh: content minw 7,
    -- body padding 0.2 on each side, then outline padding 0.07 on each side.
    w,h=p and 400 or (7+2*0.2+2*0.07)*sim.viewportUnit,p and 328 or 308
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
  -- Fit the heading inside the same padded content area as the description.
  local titleWidth=math.min(self.kind=='gameover' and 520 or 600,w-64)
  if self.titleText.cfg.maxw~=titleWidth then
    self.titleText.cfg.maxw=titleWidth
    self.titleText:set(self.data.title or '',sim.time,true)
  end
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
function Overlay:makeCards(options,scale,top)
  self:release()
  local sim=self.sim
  local spacing=D.W*scale+self.cardGap
  local first=(self.page-1)*self.perPage
  local count=math.min(self.perPage,#options-first)
  -- The host stages this page's artwork first, then its neighbours'.
  local window=table.concat({self.data.id or '',first,self.perPage},'|')
  if window~=self.artWindow then self.artWindow=window;sim:command('menu-page',self.data.id or '',first,self.perPage) end
  for i=first+1,math.min(first+self.perPage,#options) do
    local o=options[i]
    local k=i-first-1
    local row=math.floor(k/self.cardColumns)
    local col=k%self.cardColumns
    local rowCount=math.min(self.cardColumns,count-row*self.cardColumns)
    local x=self.x+self.w/2+(col-(rowCount-1)/2)*spacing
    local rowBounds=CollectionMotion.bounds(rowCount,scale,self.cardGap)
    local rowTop=top+row*(self.cardRowHeight+self.cardGap)-rowBounds.top
    local y=rowTop+D.HALF_H*scale
    local item={id=o.uid~='' and o.uid or ('opt'..i),cardId=o.cardId,name=o.label,hidden=o.cardId=='' or o.cardId=='hidden',selected=o.selected,disabled=o.disabled,edition='dissolve',resolution=2}
    local card=sim:newCard(item,i,x,y,scale)
    card.greyed=self.kind=='cards' and (o.disabled or o.dimmed) or false
    CollectionMotion.place(card,x,rowTop,rowCount,col,self.x+self.w/2,sim.time,sim.reduced,sim.boardW)
    card.option=i
    card.optionIndex=i
    self.cards[#self.cards+1]=card
  end
end
function Overlay:build(keepCards)
  self.controls={};self.warningY=nil
  local sim=self.sim
  local p=sim.portrait
  local x,y,w,h=self.x,self.y,self.w,self.h
  local d=self.data
  local kind=self.kind
  local bw=w-48
  local cardGrid=kind=='cards' or kind=='pile'
  local bottom=y+h-(cardGrid and 64 or 54)
  local function back(label,action)
    self:add(label or 'Back',x+24,bottom,bw,cardGrid and 40 or 38,action or 'back',T.orange,{fontSize=26})
  end
  local function footer(items,yy)
    if not items or #items==0 then return end
    local n=#items
    local fw=(bw-(n-1)*8)/n
    for i,o in ipairs(items) do
      self:add(o.label,x+24+(i-1)*(fw+8),yy,fw,40,'invoke',o.colour,{token=o.token,disabled=o.disabled,fontSize=24,selected=o.selected})
    end
  end
  if kind=='list' or kind=='confirm' then
    local top=y+74
    if d.note and d.note~='' then self.noteLines=Dyna.wrap(d.note,0.3,bw-16);top=top+math.min(4,#self.noteLines)*18+12 else self.noteLines={} end
    local perPage=7
    self.pages=math.max(1,math.ceil(#d.options/perPage));self.page=math.min(self.page,self.pages)
    self.pageText:set('Page '..self.page..'/'..self.pages,sim.time)
    local optionW=kind=='confirm' and (p and bw*5/7 or math.min(bw,5*sim.viewportUnit)) or bw
    for i=(self.page-1)*perPage+1,math.min(self.page*perPage,#d.options) do
      local o=d.options[i]
      local b=self:add(o.label,x+(w-optionW)/2,top+((i-1)%perPage)*50,optionW,40,'invoke',o.selected and T.green or o.colour,{token=o.token,disabled=o.disabled,selected=o.selected,fontSize=23})
      b.uid=o.uid
    end
    local fy=bottom-(d.mandatory and 0 or 50)
    if self.pages>1 then
      Pager.arrow(self:add('<',x+w/2-150,fy-48,34,36,'prev',T.red),-1,self.page,self.pages)
      Pager.arrow(self:add('>',x+w/2+116,fy-48,34,36,'next',T.red),1,self.page,self.pages)
    end
    footer(d.footer,fy)
    if not d.mandatory then back() end
  elseif kind=='cards' or kind=='pile' then
    local fy=bottom-(d.mandatory and 0 or 64)
    local gridBottom=#(d.footer or {})>0 and fy-24 or (d.mandatory and y+h-24 or bottom-24)
    if self.pages>1 then gridBottom=gridBottom-39 end
    self.viewport={x=x+24,y=y+self.cardHeader,w=w-48,h=gridBottom-(y+self.cardHeader)}
    self.cardTop=self.viewport.y+self.cardPadding
    if not keepCards then self:makeCards(d.options,self.cardScale,self.cardTop) end
    -- An untitled tray prints its instruction as one line instead.
    if (self.instructionText or '')=='' and d.note and d.note~='' then self.noteLines=Dyna.wrap(d.note,0.28,bw-16) else self.noteLines={} end
    for _,c in ipairs(self.cards) do
      self.controls[#self.controls+1]={label=c.item.name,x=c.homeX-D.HALF_W*c.baseScale,y=c.homeY-D.HALF_H*c.baseScale,w=D.W*c.baseScale,h=D.H*c.baseScale,action='card',card=c,disabled=c.item.disabled and kind=='cards',fontSize=20,token=d.options[c.option].token}
    end
    if self.pages>1 then
      self.paginationY=gridBottom+12
      self.pageText:set('Page '..self.page..'/'..self.pages,sim.time)
      Pager.arrow(self:add('<',x+w/2-150,self.paginationY,34,36,'prev',T.red),-1,self.page,self.pages)
      Pager.arrow(self:add('>',x+w/2+116,self.paginationY,34,36,'next',T.red),1,self.page,self.pages)
    else self.paginationY=nil end
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
    -- Interface Size grows the captions under the coins (audit FU1) while they end above the
    -- buttons and stay narrower than a coin's spacing and the frame.
    local n=#self.flips
    local spacing=math.min(130,(w-60)/math.max(n,1))
    local cy=y+h/2-14
    local top=y+h
    for _,b in ipairs(self.controls) do top=math.min(top,b.y-2) end
    self.captionScale=Size.grow(Display.tableText,function(k)
      for _,f in ipairs(self.flips) do
        local tw=Dyna.measure('HEADS',0.42*k)
        if tw>(n>1 and spacing-8 or w-48) or 140*k>w-48 then return false end
      end
      return cy+56+24*k+16*k<=top
    end)
  elseif kind=='log' then
    -- Rows arrive as "who<TAB>name<TAB>elapsed<TAB>text"; a turn divider as
    -- "turn<TAB><TAB><TAB>Turn N". Wrapped continuation lines indent under
    -- the text column.
    self.logLines={}
    -- One spoken entry per row, at the first drawn line it wraps onto.
    self.logEntries={}
    -- Interface Size grows its lines (audit FU1): a page holds fewer of them, in the same frame.
    local s=Display.tableText
    self.logScale=s
    local textW=bw-24-(p and 0 or 150*s)
    for line in (tostring(d.note or '')..'\n'):gmatch('(.-)\n') do
      local who,name,elapsed,text=line:match('^([^\t]*)\t([^\t]*)\t([^\t]*)\t(.*)$')
      if not who then who,name,elapsed,text='system','','',line end
      if line~='' then self.logEntries[#self.logEntries+1]={text=(name~='' and name..': ' or '')..text,line=#self.logLines+1} end
      if who=='turn' then self.logLines[#self.logLines+1]={turn=text}
      else
        local wrapped=Dyna.wrap(text,0.3*s,textW)
        for i,wl in ipairs(wrapped) do
          self.logLines[#self.logLines+1]={who=who,name=i==1 and name or '',elapsed=i==1 and elapsed or '',text=wl}
        end
      end
    end
    self.visible=math.floor((p and 24 or 19)/s)
    self.pages=math.max(1,math.ceil(#self.logLines/self.visible))
    -- The log opens on its newest page and keeps the reader's page after that.
    self.page=self.logOpened and math.min(self.page,self.pages) or self.pages
    self.logOpened=true
    self.pageText:set('Page '..self.page..'/'..self.pages,sim.time)
    if self.pages>1 then
      Pager.arrow(self:add('<',x+w/2-150,bottom-48,34,36,'prev',T.red),-1,self.page,self.pages)
      Pager.arrow(self:add('>',x+w/2+116,bottom-48,34,36,'next',T.red),1,self.page,self.pages)
    end
    self.logFocus=math.min(self.logFocus or #self.logEntries,#self.logEntries)
    back()
  elseif kind=='options' then
    local top=y+24
    -- create_UIBox_options uses minw 5; set_wh expands Back to the
    -- generic menu's 7-tile content width. Portrait keeps its compact UI.
    local col=p and bw*5/7 or 5*sim.viewportUnit
    local left=x+(w-col)/2
    self:add('Settings',left,top,col,42,'settings',T.red,{fontSize=27})
    if sim.mode=='online' then
      -- No hot-seat history or new game; a live match can be conceded.
      local live=sim.outcome==''
      self:add('Concede',left,top+54,col,42,'concede',T.red,{fontSize=27,disabled=not sim.flags.concede})
      self:add(self.armed and 'Leave? Forfeits' or 'Leave match',left,top+108,col,42,'leave',T.red,{fontSize=27,confirm=live})
      self.warningY=top+162
    else
      self:add('Choose decks',left,top+54,col,42,'choosedecks',T.red,{fontSize=27})
      self:add('New game',left,top+108,col,42,'newgame',T.red,{fontSize=27,disabled=sim.phase~='ready'})
      self:add('Main menu',left,top+162,col,42,'leave',T.red,{fontSize=27})
    end
    local backWidth=p and bw or 7*sim.viewportUnit
    self:add('Back',x+(w-backWidth)/2,bottom,backWidth,38,'back',T.orange,{fontSize=26})
  elseif kind=='inspect' then
    local item=d.item
    local scale=p and 1.2 or 1.62
    self:release()
    local info=sim.info[item.cardId]
    if info then self.popup=Popup.build(info,item,p and 420 or 380,sim.boardW) else self.popup=nil end
    local actions=d.actions or {}
    local popupH=self.popup and self.popup.h or 0
    -- Size the frame to its contents: the scan beside the popup and action rows.
    local contentH=p and (40+D.H*scale+popupH+24+#actions*46) or math.max(36+D.H*scale+12,36+popupH+16+#actions*46)
    h=math.min(sim.boardH-20,contentH+78)
    y=(sim.boardH-h)/2
    self.popupScale=1
    -- Interface Size grows the rules text as a whole (audit FU1). The frame grows upward by as much
    -- and the zoomed card rides up with its top, so the action rows and Back stay where 100% puts
    -- them; the step shrinks to what fits the board's top and the frame's width.
    if Display.tableText>1 and self.popup then
      local room=p and bw or w-(24+D.W*scale+24)-24
      local popup=self.popup
      self.popupScale=Size.grow(Display.tableText,function(k)
        return popup.w*k<=room and y-popupH*(k-1)>=10
      end)
      local extra=popupH*(self.popupScale-1)
      y,h,popupH=y-extra,h+extra,popupH*self.popupScale
    end
    self.y,self.h=y,h
    bottom=y+h-54
    local cx=p and x+w/2 or x+24+D.HALF_W*scale
    local cy=p and y+40+D.HALF_H*scale or y+36+D.HALF_H*scale
    local card=sim:newCard({id=item.id,cardId=item.cardId,name=item.name,hidden=item.hidden,edition='dissolve',resolution=2},1,cx,cy,scale)
    card.motion.T.r=0;card.motion.VT.r=0
    self.cards[1]=card
    local ax=p and x+24 or x+24+D.W*scale+24
    local ay=p and (y+40+D.H*scale+popupH+24) or (y+36+popupH+16)
    local aw=p and bw or w-(ax-x)-24
    for i,a in ipairs(actions) do
      self:add(a.label,ax,ay+(i-1)*46,aw,38,'cardAction',a.colour,{token=a.token,disabled=a.disabled,fontSize=22,cardAction=a})
    end
    self:add('Back',x+24,bottom,bw,38,'back',T.orange,{fontSize=26})
  elseif kind=='gameover' and sim.mode=='online' then
    -- Rematch returns both players to the lobby's versus step.
    local top=y+h-150
    local sent=sim:rematchPending()
    local rematch={fontSize=p and 26 or 27,disabled=sent or not sim.flags.rematch}
    local label=sent and 'Waiting...' or 'Rematch'
    if p then
      self:add(label,x+24,top,bw,40,'rematch',T.red,rematch)
      self:add('Game log',x+24,top+48,bw/2-4,40,'log',T.blue,{fontSize=24})
      self:add('Leave',x+24+bw/2+4,top+48,bw/2-4,40,'leave',T.red,{fontSize=24})
    else
      self:add(label,x+24,top,bw/2-4,44,'rematch',T.red,rematch)
      self:add('Leave',x+24+bw/2+4,top,bw/2-4,44,'leave',T.red,{fontSize=27})
      self:add('Game log',x+24,top+54,bw/2-4,40,'log',T.blue,{fontSize=24})
      self:add('View table',x+24+bw/2+4,top+54,bw/2-4,40,'peek',T.profile,{fontSize=24})
    end
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
  if kind=='gameover' then
    -- Interface Size grows the result rows (audit FU1) while their box ends above the buttons and
    -- the online notice over them, and each label stays in its half of the box.
    local rows=d.rows or {}
    local limit=y+h-150-(sim.mode=='online' and 34 or 0)-8
    self.rowScale=Size.grow(Display.tableText,function(k)
      if y+110+#rows*34*k+20>limit then return false end
      for _,r in ipairs(rows) do if Dyna.measure(r.label,0.34*k)>(w-48)/2-16 then return false end end
      return true
    end)
  end
end
local function cardLayer(card)
  return (card.hovered or card.held) and 2 or (card.item.selected and 1 or 0)
end
-- A press anywhere but the armed Leave disarms it (delete_profile resets
-- when the menu changes).
function Overlay:press(x,y)
  local i=self:hit(x,y)
  if self.armed and (self.controls[i] or {}).action~='leave' then self:disarm() end
  return i
end
function Overlay:arm()
  self.armed=self.time or self.sim.time;self.echo=self.armed+0.06
  self.leaveJuice:juice_up(self.armed,0.3,0.1,self.sim.reduced)
  self.sim.callbacks.feedback('tarot2',1,0.4)
  self:build()
  self.sim.callbacks.announce('Press again to leave. Leaving forfeits the match - your opponent wins immediately.')
end
function Overlay:disarm() if self.armed then self.armed=nil;self.echo=nil;self:build() end end
function Overlay:hit(x,y)
  y=y-self:offset()
  local v=self.viewport
  local inGrid=not v or (x>=v.x and x<=v.x+v.w and y>=v.y and y<=v.y+v.h)
  if v and inGrid then
    for layer=2,0,-1 do
      for i=#self.controls,1,-1 do
        local b=self.controls[i]
        if b.card and not b.disabled and cardLayer(b.card)==layer and b.card:hit(x,y) then return i end
      end
    end
  end
  for i=#self.controls,1,-1 do
    local b=self.controls[i]
    if not b.disabled then
      if b.card then if not v and b.card:hit(x,y) then return i end
      elseif Button.hit(b,x,y) then return i end
    end
  end
  return 0
end
function Overlay:update(dt,time,mx,my,reduced)
  self.time=time
  if self.pendingAnnounce then self.sim.callbacks.announce(self.pendingAnnounce);self.pendingAnnounce=nil end
  self.motion:update(dt,time,false,false,reduced)
  self.titleText:update(time,reduced)
  self.leaveJuice:update(dt,time,false,false,reduced)
  if self.echo and time>=self.echo then self.echo=nil;self.sim.callbacks.feedback('tarot2',0.76,0.4) end
  if self.armed and time-self.armed>3 then self:disarm() end
  self.hover=self:hit(mx,my)
  local ly=my-self:offset()
  for i,c in ipairs(self.cards) do
    local pointed,focused,held=false,false,nil
    for _,b in ipairs(self.controls) do
      if b.card==c and (self.hover==i or self.controls[self.hover]==b) then pointed=true end
      if b.card==c and self.hover==0 and self.controls[self.focus]==b then focused=true end
    end
    local active=pointed or focused
    local pressed=self.controls[self.sim.pressedOverlay or 0]
    if pressed and pressed.card==c then held=true end
    c.held=held
    if active and not c.hovered then c:juiceUp(time,0.05,0.03,reduced);self.sim.callbacks.feedback('paper1',0.9+love.math.random()*0.2) end
    c.lift=c.item.selected and 0.2*D.H*c.baseScale or 0
    if self.viewport then c.lift=math.min(c.lift,self.cardGap-4) end
    if c.collection then CollectionMotion.target(c,time,reduced,self.sim.boardW) end
    c:update(dt,time,active,reduced,focused and not pointed)
  end
  if self.kind=='coin' then
    for _,f in ipairs(self.flips) do
      -- Reduced motion lands every coin at once, without the spin.
      if not f.landed and (reduced or time>=f.start+0.9) then f.landed=true;self.sim.callbacks.feedback('coin'..(f.heads and '3' or '1'),f.heads and 1.05 or 0.9);self.sim.callbacks.jiggle(0.5) end
    end
  end
end
function Overlay:activate(i)
  local b=self.controls[i]
  if not b or b.disabled then return end
  local sim=self.sim
  local a=b.action
  if a=='card' and self.kind=='pile' then return end
  -- The 0.35 s lockout after arming stops a double click from leaving.
  if a=='leave' and self.armed and (self.time or sim.time)-self.armed<0.35 then return end
  if a=='card' then
    -- Pack cards highlight on click: lift at once (the host's re-emit
    -- confirms or reverts it) with cardSlide1, or drop with a quiet cardSlide2.
    local item=b.card.item
    item.selected=not item.selected
    self.toggled=b.card.option
    b.card:juiceUp(self.time,0.05,0.03,sim.reduced)
    sim.callbacks.feedback(item.selected and 'cardSlide1' or 'cardSlide2',1,item.selected and 1 or 0.3)
  else sim.callbacks.feedback('button') end
  if a=='invoke' or a=='card' then sim:invoke(b.token)
  elseif a=='back' then sim:closeOverlay(true)
  elseif a=='prev' or a=='next' then
    self:changePage(a=='prev' and -1 or 1)
  elseif a=='settings' then sim:closeOverlay();sim.callbacks.settings()
  elseif a=='log' then sim:command('log')
  elseif a=='choosedecks' then sim:command('choosedecks')
  elseif a=='newgame' then sim:closeOverlay();sim:command('newgame')
  elseif a=='leave' and b.confirm and not self.armed then self:arm()
  elseif a=='leave' then sim:command('leave')
  elseif a=='concede' then sim:closeOverlay();sim:command('concede')
  elseif a=='rematch' then sim:rematch()
  elseif a=='peek' then sim.peek=true
  elseif a=='cardAction' then sim:closeOverlay();sim:runCardAction(b.cardAction)
  end
end
function Overlay:keypressed(key)
  local sim=self.sim
  if key=='escape' then
    if not self.data.mandatory and self.kind~='gameover' then sim:closeOverlay(true) end
    return true
  end
  if self.kind=='log' and (key=='up' or key=='down') then
    self:readLog(key=='up' and -1 or 1)
    return true
  end
  if key=='tab' or key=='left' or key=='right' or key=='up' or key=='down' then
    local total=#self.controls;if total==0 then return true end
    self.focus=Controls.cycle(self.focus,Controls.backward(key) and -1 or 1,total,function(i) return self.controls[i].disabled end)
    local b=self.controls[self.focus]
    if self.armed and (not b or b.action~='leave') then self:disarm() end
    if b then sim.callbacks.announce(self:describe(b)) end
    return true
  elseif key=='return' or key=='space' then self:activate(self.focus);return true
  elseif key=='pageup' or key=='pagedown' then self:changePage(key=='pageup' and -1 or 1);return true end
  return false
end
function Overlay:changePage(delta)
  if (self.pages or 1)<=1 then return end
  self.page=(self.page-1+delta+self.pages)%self.pages+1
  self.sim.pressedOverlay=nil;self.hover=0;self.focus=0
  -- The log's reading cursor moves to the page shown: Up then reads its last
  -- entry and Down its first.
  if self.kind=='log' then self.logTurned=true end
  self:build()
  self.sim.callbacks.announce(Pager.page(self.page,self.pages))
end
-- A focused control as heard: a card in a tray with its selection, a pager
-- arrow with its page.
function Overlay:describe(b)
  if b.speech then return b.speech end
  local selected=b.card and b.card.item.selected or (not b.card and b.selected)
  return b.label..(selected and ', selected' or '')
end
-- Up and down step through the log's entries, newest last, turning the page
-- to the one that shows the entry. After a page turn they start from the page
-- shown: Up reads its last entry, Down its first.
function Overlay:readLog(dir)
  local n=#self.logEntries
  if n==0 then self.sim.callbacks.announce('Game log, no entries yet');return end
  local pageOf=function(e) return math.ceil(e.line/self.visible) end
  if self.logTurned then
    self.logTurned=nil
    local first,last
    for i,e in ipairs(self.logEntries) do
      if pageOf(e)<=self.page then last=i end
      if not first and pageOf(e)>=self.page then first=i end
    end
    -- An entry that starts on an earlier page and wraps onto this one is the
    -- page's first.
    if first and pageOf(self.logEntries[first])>self.page and last then first=last end
    self.logFocus=dir<0 and (last or 1) or (first or n)
  else
    self.logFocus=math.max(1,math.min(n,(self.logFocus or n)+(dir<0 and -1 or 1)))
  end
  local entry=self.logEntries[self.logFocus]
  local page=pageOf(entry)
  -- Rebuild on a page change, so the pager arrows name the page shown.
  if page~=self.page then self.page=page;self:build() end
  self.sim.callbacks.announce('Entry '..self.logFocus..' of '..n..': '..entry.text)
end
function Overlay:wheelmoved(y)
  if y~=0 and WheelPager.ready(self) then self:changePage(y>0 and -1 or 1) end
end
-- A coin `age` seconds into its flip: its spin (the face's width, -1..1), its
-- height and whether it has landed. Reduced Motion shows it landed at once.
function Overlay.coinPose(age,reduced)
  local t=reduced and 1 or math.min(age/0.9,1)
  if age>0 and t<1 then return math.cos(t*math.pi*7),math.sin(t*math.pi)*56,false end
  return 1,0,t>=1
end
local function cycle(self,x,y,w,h)
  local hovered=Button.hit({x=x,y=y,w=w,h=h},self.sim.mx or -1,(self.sim.my or -1)-self:offset())
  Button.cycleFace(x,y,w,h,hovered)
  self.pageText:draw(self.time or 0,self.sim.reduced,x,y,w,h,self.sim.boardW,0.4)
end
-- The inspector's rules text as drawn: x, y, w, h and its Interface Size scale (audit FU1).
function Overlay:popupRect()
  local p,c,k=self.sim.portrait,self.cards[1],self.popupScale or 1
  local x,y,w=self.x,self.y,self.w
  local pw=self.popup.w*k
  local px=p and x+(w-pw)/2 or x+24+D.W*(c and c.baseScale or 1.6)+24
  local py=p and y+40+D.H*(c and c.baseScale or 1.2)+12 or y+36
  return {x=px,y=py,w=pw,h=self.popup.h*k,scale=k}
end
function Overlay:draw(shaders)
  local sim=self.sim
  local p=sim.portrait
  local rw=sim.boardW
  local x,y,w,h=self.x,self.y,self.w,self.h
  local d=self.data
  g.push();g.translate(0,self:offset())
  Button.modalFrameRaised(x,y,w,h)
  local kind=self.kind
  if kind~='inspect' and kind~='gameover' and kind~='options' and (d.title or '')~='' then self.titleText:draw(x+w/2,y+38,rw) end
  if kind=='list' or kind=='confirm' then
    local top=y+74
    for i=1,math.min(4,#(self.noteLines or {})) do Dyna.static(self.noteLines[i],0.3,x+32,top+(i-1)*18,w-64,18,T.jokerGrey,{roomWidth=rw}) end
    if self.pages>1 then cycle(self,x+w/2-112,y+h-54-(d.mandatory and 0 or 50)-48,224,36) end
  elseif kind=='cards' or kind=='pile' then
    local top=y+(kind=='pile' and 64 or 66)
    for i=1,math.min(2,#(self.noteLines or {})) do Dyna.static(self.noteLines[i],0.28,x+32,top+(i-1)*16,w-64,16,T.jokerGrey,{roomWidth=rw}) end
    if (self.instructionText or '')~='' then
      -- Interface Size grows it about its line's centre (audit FU1), in the band above the cards;
      -- fit keeps it in the tray's width.
      local k=Display.tableText
      if k==1 then Dyna.static(self.instructionText,0.28,x+32,y+22,w-64,16,T.jokerGrey,{roomWidth=rw,fit=true})
      else Dyna.static(self.instructionText,0.28*k,x+32,y+30-8*k,w-64,16*k,T.jokerGrey,{roomWidth=rw,fit=true}) end
    end
    -- The pack tray: G.C.BLACK inset with a 0.05 emboss, like the collection.
    local v=self.viewport
    local tx,ty,tw,th=v.x,v.y,v.w,v.h
    Button.panel(tx,ty+3,tw,th,{T.panel[1]*0.7,T.panel[2]*0.7,T.panel[3]*0.7,1})
    Button.panel(tx,ty,tw,th,T.panel)
    local sx,sy,sw,sh=g.getScissor()
    local vx,vy=g.transformPoint(v.x,v.y)
    local ex,ey=g.transformPoint(v.x+v.w,v.y+v.h)
    g.intersectScissor(vx,vy,ex-vx,ey-vy)
    for layer=0,2 do
      for _,c in ipairs(self.cards) do
        if cardLayer(c)==layer then
          c:draw(shaders,self.time or 0,sim.mx or 0,(sim.my or 0)-self:offset(),sim.reduced,rw)
        end
      end
    end
    if sx then g.setScissor(sx,sy,sw,sh) else g.setScissor() end
    if self.paginationY then cycle(self,x+w/2-112,self.paginationY,224,36) end
  elseif kind=='coin' then
    local n=#self.flips
    local spacing=math.min(130,(w-60)/math.max(n,1))
    for i,f in ipairs(self.flips) do
      local cx=x+w/2+(i-(n+1)/2)*spacing
      local cy=y+h/2-14
      local flip,lift,landed=Overlay.coinPose(math.max(0,(self.time or 0)-f.start),sim.reduced)
      local chip=Sprites.WHITE
      if landed then chip=f.heads and Sprites.WHITE or Sprites.BLACK
      elseif lift>0 then chip=flip>=0 and Sprites.WHITE or Sprites.BLACK end
      local px=(cx-rw/2)/(rw/2)*1.5
      if not Sprites.chip(chip,cx,cy-lift,88,sim.reduced and 0 or math.sin((self.time or 0)*0.7+i)*0.06,math.max(0.08,math.abs(flip)),px,0.1+lift/120) then
        g.setColor(T.white);g.circle('fill',cx,cy-lift,40,8)
      end
      if f.landed and self.captionScale==1 then
        Dyna.static(f.heads and 'HEADS' or 'TAILS',0.42,cx-60,cy+56,120,22,f.heads and T.blue or T.red,{roomWidth=rw})
        Dyna.static(f.who,0.26,cx-70,cy+80,140,16,T.jokerGrey,{roomWidth=rw,fit=true})
      elseif f.landed then
        local k=self.captionScale
        Dyna.static(f.heads and 'HEADS' or 'TAILS',0.42*k,cx-60*k,cy+56,120*k,22*k,f.heads and T.blue or T.red,{roomWidth=rw})
        Dyna.static(f.who,0.26*k,cx-70*k,cy+56+24*k,140*k,16*k,T.jokerGrey,{roomWidth=rw,fit=true})
      end
    end
  elseif kind=='log' then
    local top=y+74
    local first=(self.page-1)*self.visible
    local seatColour={p1=T.blue,p2=T.red,system=T.jokerGrey}
    local s=self.logScale or 1
    for i=first+1,math.min(#self.logLines,first+self.visible) do
      local line=self.logLines[i]
      local ly=top+(i-first-1)*(p and 24 or 25)*s
      if line.turn then
        Dyna.static(line.turn,0.3*s,x+32,ly,w-64,20*s,T.money,{align='center',roomWidth=rw})
      elseif p then
        Dyna.static(line.text,0.3*s,x+32,ly,w-64,20*s,T.white,{align='left',roomWidth=rw})
      else
        -- Elapsed stamp, the seat's name in its colour, then the line.
        Dyna.static(line.elapsed,0.26*s,x+32,ly+1*s,56*s,20*s,T.jokerGrey,{align='left',roomWidth=rw,shadow=false})
        Dyna.static(line.name,0.3*s,x+32+60*s,ly,90*s,20*s,seatColour[line.who] or T.jokerGrey,{align='left',fit=true,roomWidth=rw})
        Dyna.static(line.text,0.3*s,x+32+150*s,ly,w-64-150*s,20*s,T.white,{align='left',roomWidth=rw})
      end
    end
    if self.pages>1 then cycle(self,x+w/2-112,y+h-54-48,224,36) end
  elseif kind=='inspect' then
    local item=d.item
    Dyna.static(item.name,0.5,x+24,y+8,w-48,30,T.white,{roomWidth=rw,fit=true})
    local c=self.cards[1]
    if c then c:draw(shaders,self.time or 0,sim.mx or 0,(sim.my or 0)-self:offset(),sim.reduced,rw) end
    if self.popup then
      local r=self:popupRect()
      if r.scale==1 then self.popup.draw(r.x,r.y)
      else
        g.push();g.translate(r.x,r.y);g.scale(r.scale);g.translate(-r.x,-r.y)
        self.popup.draw(r.x,r.y)
        g.pop()
      end
    end
  elseif kind=='gameover' then
    self.titleText:draw(x+w/2,y+60,rw)
    -- Stats: BLACK box, emboss 0.05, rows of label / value like round_scores_row.
    local k=self.rowScale or 1
    local bx,by,bw,bh=x+24,y+110,w-48,#(d.rows or {})*34*k+20
    Button.panel(bx,by+3,bw,bh,{T.panel[1]*0.7,T.panel[2]*0.7,T.panel[3]*0.7,1})
    Button.panel(bx,by,bw,bh,T.panel)
    local rows=d.rows or {}
    for i,r in ipairs(rows) do
      local ry=by+12+(i-1)*34*k
      Dyna.static(r.label,0.34*k,bx+16,ry,bw/2,24*k,T.jokerGrey,{align='left',roomWidth=rw})
      Dyna.static(r.value,0.4*k,bx+bw/2,ry-2*k,bw/2-16,28*k,r.colour or T.white,{align='right',roomWidth=rw,fit=true})
    end
    -- A refused rematch or a lost seat says why above the buttons, where the table's banner notice
    -- would be hidden.
    local notice=(sim.message or '')~='' and sim.message or sim.warning or ''
    if sim.mode=='online' and notice~='' then
      Dyna.static(notice,0.3,x+24,y+h-150-34,w-48,26,T.red,{roomWidth=rw,fit=true})
    end
  end
  -- delete_profile's warning_text: hidden until the first press.
  if self.armed and self.warningY then Dyna.static('Press again to confirm',0.4,x+24,self.warningY,w-48,42,T.white,{roomWidth=rw}) end
  for i,b in ipairs(self.controls) do
    if not b.card then
      local juice=b.action=='leave' and b.confirm
      if juice then
        local m=self.leaveJuice
        g.push();g.translate(b.x+b.w/2,b.y+b.h/2);g.rotate(m.VT.r);g.scale(m.VT.scale);g.translate(-b.x-b.w/2,-b.y-b.h/2)
      end
      Button.draw(b,not b.disabled and Controls.lit(self.hover,self.focus,i),self.sim.pressedOverlay==i and self.hover==i,self.hover==0 and self.focus==i,rw)
      if juice then g.pop() end
      if b.selected then g.setLineWidth(1.5);Button.outline(b.x-2,b.y-2,b.w+4,b.h+4,T.white,1.2) end
    end
  end
  g.pop()
end
return Overlay
