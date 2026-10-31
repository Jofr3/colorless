local D=require('ui.card_dimensions')
local WheelPager=require('ui.wheel_pager')
-- The online lobby is one generic-options modal that changes step in place,
-- as Settings swaps in its auth form: create_tabs (Create/Join), the seed row's
-- black pill and Copy buttons, blind-choice seat panels, Sandbox's deck grid
-- with a create_option_cycle filter and an
-- attention_text countdown. src/lua/online.ts owns the socket.
local T=require('ui.theme')
local Controls=require('ui.controls')
local Button=require('ui.button')
local Modal=require('ui.modal')
local Motion=require('ui.motion')
local Codec=require('ui.codec')
local W=require('ui.wire_fields').online
local Mailbox=require('ui.mailbox')
local Input=require('ui.text_input')
local Dyna=require('ui.dynatext')
local Fx=require('ui.fx')
local PageText=require('ui.page_text')
local Alert=require('ui.card_alert')
local DeckGrid=require('ui.deck_grid')
local DeckPicker=require('ui.deck_picker')
local Seats=require('ui.lobby_seats')
local LobbyCode=require('ui.host_constants').lobbyCode
local g=love.graphics
local Online={}
Online.__index=Online
local heights={menu=540,joining=420,waiting=540,starting=420}
local info={
  invalid={'Invalid lobby code',"That code doesn't look right. Head back and try again."},
  full={'Lobby is full','Lobby %s already has two players.'},
  ['not-found']={'Lobby not found','No open lobby with the code %s. Ask for a fresh code, or create your own.'},
  unreachable={"Can't reach the lobby","Couldn't connect to lobby %s. Check your connection, then try again."},
  kicked={'Removed from the lobby','The host removed you from this lobby.'},
}
local backs={menu={'Back','home'},joining={'Cancel','leave'},waiting={'Leave','home'},versus={'Leave','leave'},
  countdown={'Leave','leave'},starting={'Leave','home'}}
-- Regulation view filter. A deck not legal in its own format is listed but can't be chosen.
local filters={{'All decks'},{'Standard legal','standard',true},{'Not Standard legal','standard',false},
  {'Expanded legal','expanded',true},{'Not Expanded legal','expanded',false}}
local function darken(c,t) return {c[1]*(1-t),c[2]*(1-t),c[3]*(1-t),c[4] or 1} end
local function spell(code) return (code:gsub('.','%0 '):gsub('%s+$','')) end
-- Mirrors normalizeLobbyCode: upper-case, drop look-alikes, cap at the code's length.
function Online.normalize(raw)
  local out=''
  for c in tostring(raw or ''):upper():gmatch('.') do
    if LobbyCode.alphabet:find(c,1,true) then out=out..c end
    if #out==LobbyCode.length then break end
  end
  return out
end
function Online.new(callbacks)
  local self=setmetatable({callbacks=callbacks,items={},cards={},decks={},seats={},piles={},dyna={},tab=1,joinCode='',
    query='',page=1,pages=1,filter=1,focus=0,hover=0,time=0,step='menu',code='',message='',notice='',status='',
    deckPhase='idle',name='',account='loading',pageText=PageText.new()},Online)
  self.juice={you=Motion.new(0,0),opponent=Motion.new(0,0),youPill=Motion.new(0,0),opponentPill=Motion.new(0,0)}
  self.fx=Fx.new({feedback=function(name,pitch) callbacks.feedback(name,pitch) end,jiggle=function(amount) callbacks.jiggle(amount) end})
  self.motion=Modal.motion(true)
  return self
end
function Online:command(...)
  Codec.command(self.callbacks.command,...)
end
function Online:offset() return self.motion.VT.y*60 end
-- The box the field a text proxy edits is drawn in, the lobby's slide included, for main.lua to
-- hand the page (audit BR6); nothing while none edits.
function Online:editBox()
  for _,item in ipairs(self.editing and self.items or {}) do
    if item.kind=='field' and item.field==self.editing then return item.x,item.y+self:offset(),item.w,item.h end
  end
end
function Online:open(reduced,code)
  self.motion=Modal.motion(reduced);self.reduced=reduced
  self.code=code or '';self.tab=1;self.joinCode='';self.editing=nil;self.picker=false;self.query='';self.page=1;self.filter=1
  self.focus=0;self.hover=0;self.pressed=nil;self.busy=false;self.message='';self.notice='';self.seats={}
  self.synced=false;self.fx:clear()
  local say=self:enter(self.code~='' and 'joining' or 'menu')
  self:build()
  if self.code~='' then self:command('open',self.code) else self:command('open');self:create() end
  self.callbacks.announce(say)
end
-- The Create tab is the lobby: opening on it, or returning to it, makes one.
function Online:create()
  if self.busy or self.step~='menu' or self.tab~=1 then return end
  self.busy=true;self.message='';self:command('create');self:build()
end
-- Create/Join put the code into the URL; the lobby itself is already live.
function Online:retarget(code) self.code=code or '' end
function Online:finish() if self.editing then self:command('finish-input');self.editing=nil end end
function Online:close() self:finish();self.picker=false;self:command('close') end
function Online:leave() self:finish();self:command('leave','home');self.callbacks.home() end
function Online:layout(w,h)
  self.width,self.height,self.portrait=w,h,w<600
  self.pressed=nil;self.pileKey=nil
  self:makeCards(false);self:build()
end
function Online:deck(id) for _,d in ipairs(self.decks) do if d.id==id then return d end end end
function Online:matches()
  local f=filters[self.filter]
  return DeckPicker.matches(self.decks,self.query,f[2] and function(d) return d[f[2]]==f[3] end)
end
function Online:frame()
  local w,h=self.width,self.height
  local versus=not self.picker and (self.step=='versus' or self.step=='countdown')
  -- The versus card keeps a wider margin than the other steps; its side
  -- margin grows the card, not the seats (392 / 424 wide).
  self.pad=versus and (self.portrait and 24 or 20) or 16
  self.padX=versus and (self.portrait and 36 or 52) or 16
  self.w=versus and (self.portrait and 392 or 424)+2*self.padX or self.portrait and 440 or 780
  if self.picker then self.h=h-72
  elseif versus then
    -- Your seat grows a deck preview once you have chosen one.
    self.youH=(self.seats.you or {}).hasDeck and 432 or 208
    self.h=math.min(2*self.pad+262+self.youH,h-40)
  else self.h=heights[self.step] or 440 end
  self.x,self.y=(w-self.w)/2,(h-self.h)/2
  local x,y=self.x,self.y
  -- One column: the opponent's seat, VS, then yours.
  local pad,px=self.pad,self.padX
  self.panels={opponent={x=x+px,y=y+pad,w=self.w-2*px,h=112},you={x=x+px,y=y+pad+176,w=self.w-2*px,h=self.youH or 208}}
  self.vs={x=x+self.w/2,y=y+pad+144}
  if self.portrait then self.area={x=x+16,y=y+136,w=self.w-32,h=self.h-312}
  else self.area={x=x+16,y=y+90,w=self.w-32,h=self.h-260} end
end
-- The picker's pile size, which your seat's preview shares.
function Online:pickerScale()
  local ah=self.height-72-(self.portrait and 312 or 260)
  return math.min(0.82,(ah/2-84)/D.H)
end
function Online:makeCards(entering)
  DeckGrid.release(self)
  if not self.width or not self.picker then return end
  self:frame()
  DeckGrid.fill(self,self:matches(),self.portrait and 4 or 10,self.portrait and 2 or 5,self:pickerScale(),entering)
end
function Online:build()
  if not self.width then return end
  self:frame();self:makePiles()
  local x,y,w,h=self.x,self.y,self.w,self.h
  self.items={}
  local function add(item)
    item.fontSize=item.fontSize or 26;item.colour=item.colour or T.red
    self.items[#self.items+1]=item;return item
  end
  local step=self.step
  if self.picker then
    local portrait=self.portrait
    local ready=self.deckPhase=='ready'
    add({kind='field',field='search',label='',placeholder='Search decks',x=x+16,y=y+(portrait and 78 or 30),w=portrait and w-32 or w-348,h=42,disabled=not ready})
    add({kind='cycle',x=portrait and x+(w-300)/2 or x+w-316,y=y+(portrait and 24 or 32),w=300,h=38.4,disabled=not ready})
    if ready then
      for i,card in ipairs(self.cards) do
        local b=card.bounds
        -- A deck that can't be played online stays focusable so its reason is read out.
        add({kind='card',card=i,label=card.item.name,x=b.x,y=b.y,w=b.w,h=b.h,blocked=not card.item.online})
      end
      DeckPicker.arrows(self,y+h-158,function(label,ax,ay,aw,ah,dir)
        return add({kind='button',action=dir<0 and 'previous' or 'next',label=label,x=ax,y=ay,w=aw,h=ah})
      end)
    elseif self.deckPhase=='anonymous' or self.deckPhase=='error' then
      local anonymous=self.deckPhase=='anonymous'
      add({kind='button',action=anonymous and 'signin' or 'decks',label=anonymous and 'Sign in' or 'Try again',x=x+(w-280)/2,y=self.area.y+180,w=280,h=48})
    end
  elseif step=='menu' or step=='waiting' then
    -- A created lobby fills the Create tab in place; Join gives it up.
    local waiting=step=='waiting'
    local left=x+(w-312)/2
    for i,label in ipairs({'Create','Join'}) do add({kind='tab',tab=i,label=label,x=left+(i-1)*162,y=y+34,w=150,h=48,fontSize=30}) end
    if waiting then
      for i,kind in ipairs({'code','link'}) do
        local label=(self.copied==kind and self.notice~='') and self.notice or (kind=='code' and 'Copy code' or 'Copy link')
        add({kind='button',action='copy',copy=kind,label=label,x=x+(w-320)/2,y=y+272+(i-1)*50,w=320,h=40,fontSize=24})
      end
    elseif self.tab==1 then
      local bw=math.min(420,w-64)
      add({kind='button',action='create',label=self.busy and 'Please wait...' or 'Create lobby',x=x+(w-bw)/2,y=y+214,w=bw,h=56,fontSize=40,colour=T.blue,disabled=self.busy})
    else
      add({kind='field',field='code',label='Lobby code',placeholder='CODE',x=x+(w-260)/2,y=y+162,w=260,h=56})
      add({kind='button',action='join',label='Join',x=x+(w-260)/2,y=y+238,w=260,h=48,fontSize=30,disabled=self.busy or #self.joinCode<LobbyCode.length})
    end
    if self.account=='anonymous' and not waiting then add({kind='button',action='signin',label='Sign in',x=x+(w-160)/2,y=y+h-116,w=160,h=36,fontSize=22,colour=T.blue}) end
  elseif step=='versus' or step=='countdown' then
    -- The countdown keeps the panels on screen but only Leave stays live.
    local locked=step=='countdown'
    local you=self.seats.you or {}
    local p=self.panels.you
    add({kind='button',action='choose',label=you.hasDeck and 'Change deck' or 'Choose deck',x=p.x+12,
      y=p.y+p.h-100,w=p.w-24,h=40,disabled=locked or you.ready})
    add({kind='button',action='ready',label=you.ready and 'Cancel ready' or 'Ready',x=p.x+12,
      y=p.y+p.h-52,w=p.w-24,h=40,colour=you.ready and T.orange or T.red,disabled=locked or not you.hasDeck})
  elseif info[step] then
    add({kind='button',action='online',label='Back to online',x=x+(w-300)/2,y=y+h-124,w=300,h=46,fontSize=30})
  end
  local back=self.picker and {'Back','versus'} or backs[step] or {'Back','home'}
  -- Back/Leave spans the card on every step, past the seats' side margin.
  local pad=self.pad
  add({kind='back',label=back[1],action=back[2],x=x+16,y=y+h-pad-42+(pad==16 and 0 or 4),w=w-32,h=38,fontSize=30,colour=T.orange})
  if self.focus>#self.items then self.focus=0 end
end
-- Step entry: fresh DynaTexts, the entry cue, and what to announce.
function Online:enter(step)
  self.step=step;self.focus=0;self.pressed=nil
  if step~='versus' then self.picker=false end
  if (step~='menu' and self.editing=='code') or (self.editing=='search' and not self.picker) then self:finish() end
  local t=self.time
  local function dyna(cfg)
    cfg.time=t;cfg.colours=cfg.colours or {T.white};cfg.shadow=true
    return Dyna.new(cfg)
  end
  self.dyna={}
  if step=='menu' then return 'Online. '..(self.tab==1 and 'Create' or 'Join')..' tab. Left and right switch tabs. Escape closes.'
  elseif step=='joining' then
    self.dyna.title=dyna({string='Joining lobby',scale=0.8,bump=true,pop_in=0.5})
    return 'Joining lobby '..spell(self.code)
  elseif step=='waiting' then
    self.tab=1
    -- round_scores_row seed value, at wipe_on's pop_in rate and pulse.
    self.dyna.code=dyna({string=self.code,scale=1.6,colours={T.gold},float=true,pop_in=0,pop_in_rate=2})
    self.dyna.code:pulse(0.2,t)
    self.dyna.prompt=dyna({string='Waiting for an opponent to join...',scale=0.5,bump=true,pop_in=0.5})
    self.callbacks.feedback('highlight1')
    return 'Lobby code '..spell(self.code)..'. Waiting for an opponent to join.'
  elseif step=='versus' then
    self.dyna.vs=dyna({string='VS',scale=0.9,float=true})
    local opp=self.seats.opponent
    return 'Versus.'..(opp and opp.present and ' '..opp.name..' joined.' or '')
  elseif step=='countdown' then
    self.dyna.title=dyna({string='BATTLE STARTING',scale=0.6,spacing=2,float=true})
    return 'Battle starting.'
  elseif step=='starting' then
    self.dyna.title=dyna({string='The match is set',scale=0.8,bump=true})
  elseif info[step] then
    self.dyna.title=dyna({string=info[step][1],scale=0.8,colours={T.red},pop_in=0,pop_in_rate=4})
    if step=='kicked' then
      -- Blind:alert_debuff's stinger, with the shipped whoosh.
      local feedback=self.callbacks.feedback
      feedback('whoosh');self.fx:after(0.1,function() feedback('cancel',0.8) end);self.fx:after(0.1,function() feedback('cancel',0.85) end)
    else self.callbacks.feedback('cancel',0.8) end
    return info[step][1]..'. '..info[step][2]:format(self.code)
  end
end
-- One attention_text per countdown second; GO! gets the blue cover.
function Online:tick()
  local n=self.countdown
  if self.vs then
    self.fx.time=self.time
    self.fx:attention({text=n>0 and tostring(n) or 'GO!',scale=2,hold=0.6,x=self.vs.x,y=self.vs.y+20,
      backdrop=n>0 and T.orange or T.blue,sound=n>0 and 'generic1' or 'whoosh2',jiggle=n>0 and 1 or 2})
  end
  return n>0 and tostring(n) or 'Go!'
end
function Online:sync(raw)
  if not raw or raw==self.raw then return end
  self.raw=raw
  local rows=Codec.rows(raw)
  local H,P,K=W.header,W.seat,W.deck
  local f=rows[1];if not f or #f<H.status then return end
  local was={step=self.step,seats=self.seats,status=self.status,message=self.message,notice=self.notice,
    countdown=self.countdown,deckPhase=self.deckPhase,link=self.link}
  self.busy,self.message,self.code,self.role,self.link=f[H.busy]=='1',f[H.message],f[H.code],f[H.role],f[H.link]
  self.countdown,self.notice,self.deckPhase=tonumber(f[H.countdown]),f[H.notice],f[H.deckPhase]
  self.name,self.account,self.status=f[H.name],f[H.account],f[H.status]
  local seats,decks,signature={},{},{}
  for i=2,#rows do
    local r=rows[i]
    if r[1]=='P' and #r>=P.deckName then
      -- deckId: your own pick, when this client still knows it; hasDeck: whether one is picked.
      seats[r[P.seat]]={present=r[P.present]=='1',name=r[P.name],connected=r[P.connected]=='1',ready=r[P.ready]=='1',
        deckId=r[P.deckId],deckName=r[P.deckName],hasDeck=r[P.hasDeck]=='1'}
    elseif r[1]=='D' and #r>=K.count then
      decks[#decks+1]={id=r[K.id],name=r[K.name],count=tonumber(r[K.count]) or 0,standard=r[K.standard]=='1',
        expanded=r[K.expanded]=='1',online=r[K.online]=='1',formatName=r[K.formatName] or ''}
      signature[#signature+1]=table.concat(r,'\t')
    end
  end
  self.seats=seats
  if seats.you and seats.you.ready then self.picker=false end
  if self.editing=='search' and not self.picker then self:finish() end
  signature=table.concat(signature,'\n')
  local changed=signature~=self.signature
  if changed then self.signature=signature;self.decks=decks end
  local say=self:react(was,f[H.step])
  if changed then self:makeCards(true) end
  self:build()
  if #say>0 then self.callbacks.announce(table.concat(say,' ')) end
  -- Leaving a lobby lands back on the Create tab, which is a fresh lobby.
  if f[H.step]=='menu' and was.step~='menu' then self:create() end
end
-- The steps that draw the Reconnecting... marker while the lobby link reconnects.
local seatedStep={waiting=true,versus=true,countdown=true}
function Online:react(was,step)
  local say={}
  local function add(text) if text and text~='' then say[#say+1]=text end end
  if step~=was.step then add(self:enter(step)) end
  local opp,old=self.seats.opponent or {},was.seats.opponent or {}
  if self.synced and (step=='versus' or step=='waiting' or step=='countdown') then
    if opp.present and not old.present then
      -- play_area_status_text: cardFan2 with the seat's juice and a jiggle.
      self.callbacks.feedback('cardFan2');self.callbacks.jiggle(1)
      self.juice.opponent:juice_up(self.time,0.05,0.02,self.reduced)
      if was.step=='versus' then add(opp.name..' joined.') end
    elseif old.present and (not opp.present or (old.connected and not opp.connected)) then
      self.callbacks.feedback('chips1',0.6,0.12)
      add(opp.present and opp.name..' disconnected.' or old.name..' left.')
    end
    for _,tag in ipairs({'you','opponent'}) do
      local s,o=self.seats[tag],was.seats[tag]
      if s and o and s.present and s.ready~=o.ready then
        self.juice[tag..'Pill']:juice_up(self.time,0.3,0.1,self.reduced)
        add(tag=='you' and (s.ready and 'You are ready.' or 'You are no longer ready.')
          or s.name..(s.ready and ' is ready.' or ' is no longer ready.'))
      end
    end
  end
  -- The Reconnecting... marker's speech: a seated lobby's link dropping and coming back.
  if self.link~=was.link and seatedStep[step] and seatedStep[was.step] then
    if self.link=='connecting' then add('Connection lost, reconnecting.')
    elseif was.link=='connecting' and self.link=='connected' then add('Reconnected.') end
  end
  if step=='versus' and self.status~=was.status then add(self.status) end
  if self.message~=was.message then add(self.message) end
  if self.notice~=was.notice and self.notice~='' then
    if self.notice=='Copied' then self.callbacks.feedback('paper1') end
    add(self.notice)
  end
  if step=='countdown' and self.countdown and self.countdown~=was.countdown then add(self:tick()) end
  -- The server can flip to in-game before a zero second is ever published.
  if step=='starting' and was.step=='countdown' and was.countdown~=0 then self.countdown=0;add(self:tick()) end
  if self.picker and self.deckPhase~=was.deckPhase then add(self:summary()) end
  self.synced=true
  return say
end
function Online:summary()
  if self.deckPhase=='ready' then return 'Choose your deck. '..#self:matches()..' decks.' end
  if self.deckPhase=='anonymous' then return 'Choose your deck. Sign in to use your decks.' end
  if self.deckPhase=='error' then return "Choose your deck. Couldn't load your decks." end
  return 'Choose your deck. Loading decks.'
end
function Online:input(raw)
  if not raw or raw==self.inputRaw then return end
  self.inputRaw=raw
  local f=Codec.fields(raw);if #f<6 then return end
  local field,action=f[2],f[6]
  self.first,self.last=tonumber(f[4]),tonumber(f[5])
  if field=='code' then
    self.editing=action=='input' and 'code' or nil
    self.joinCode=Online.normalize(f[3])
    self:build()
    if action=='enter' and #self.joinCode==LobbyCode.length and self.step=='menu' and not self.busy then self:join() end
  elseif field=='search' then
    self.editing=action=='input' and 'search' or nil
    if self.query~=f[3] then self.query=f[3];self.page=1;self:makeCards(true);self.focus=0;self.pressed=nil end
    self:build()
  end
end
function Online:hit(x,y,hoverOnly)
  y=y-self:offset()
  for i,item in ipairs(self.items) do
    if not item.disabled and not item.blocked and Button.hit(item,x,y) then
      if item.kind=='cycle' then
        if x<=item.x+28.8 then return i,'left' end
        if x>=item.x+item.w-28.8 then return i,'right' end
        if hoverOnly then return i,'center' end
      else return i end
    end
  end
  return 0
end
function Online:update(dt,time,mx,my,reduced)
  self.time,self.reduced=time,reduced
  self:sync(Mailbox.read('online'))
  self:input(Mailbox.read('onlineInput'))
  self.motion:update(dt,time,false,false,reduced)
  self.mx,self.my=mx,my-self:offset()
  self.hover,self.hoverPart=self:hit(mx,my,true)
  for _,d in pairs(self.dyna) do d:update(time,reduced) end
  for _,m in pairs(self.juice) do m:update(dt,time,false,false,reduced) end
  for _,pile in pairs(self.piles) do pile:update(dt,time,false,reduced,self.width) end
  DeckPicker.update(self,self.items,dt,time,reduced,true)
  self.fx:update(dt,time,reduced,false)
end
function Online:describe(item)
  if item.kind=='tab' then return item.label..' tab' end
  if item.kind=='field' and item.field=='code' then
    return 'Lobby code, '..(self.joinCode~='' and spell(self.joinCode) or 'empty')..'. Enter to edit.'
  end
  if item.kind=='field' then return 'Search decks'..(self.query~='' and ', '..self.query or '')..'. Enter to edit.' end
  if item.kind=='cycle' then return 'Deck filter: '..filters[self.filter][1]..'. Left and right change it.' end
  if item.kind=='card' then
    local d=self.cards[item.card].item
    return d.name..'. '..d.count..' cards.'..(d.id==(self.seats.you or {}).deckId and ' Selected.' or '')
      ..(d.online and '' or ' Not legal in '..d.formatName..', so it can\'t be played online.')
  end
  return (item.speech or item.displayLabel or item.label)..'. Button.'
end
function Online:join()
  if self.busy or #self.joinCode<LobbyCode.length then return end
  self:finish();self.busy=true;self:command('join',self.joinCode);self:build()
end
function Online:openPicker()
  self.picker=true;self.query='';self.page=1;self.focus=0;self.pressed=nil
  self:command('decks');self:makeCards(true);self:build()
  self.callbacks.announce(self:summary())
end
function Online:changePage(delta)
  if not self.picker or self.deckPhase~='ready' then return end
  DeckPicker.turn(self,delta)
end
function Online:activate(i,dir)
  local item=self.items[i]
  if not item or item.disabled then return end
  if item.blocked then
    local d=self.cards[item.card].item
    self.callbacks.announce(d.name.." can't be played online. It isn't legal in "..d.formatName..'.')
    return
  end
  local a=item.action
  self.callbacks.feedback('button');self.callbacks.jiggle(0.5)
  if item.kind=='tab' then
    local switched=item.tab~=self.tab
    self:finish();self.tab=item.tab;self:build()
    if self.focus>0 then self.focus=i end
    self.callbacks.announce(self:describe(item))
    -- Joining someone else gives up the lobby you were waiting in.
    if switched and self.step=='waiting' then self:command('leave') elseif switched then self:create() end
  elseif item.kind=='field' then
    self.focus=i;self.editing=item.field
    self:command('input',item.field,item.field=='code' and self.joinCode or self.query)
  elseif item.kind=='cycle' then
    self.filter=(self.filter-1+(dir or 1))%#filters+1;self.page=1;self:makeCards(true);self:build()
    self.callbacks.announce(self:describe(item))
  elseif item.kind=='card' then
    local card=self.cards[item.card]
    card:click(self.time,self.reduced);self.callbacks.feedback('cardSlide1')
    self:command('select',card.item.id);self:finish();self.picker=false;self.focus=0;self:build()
    self.callbacks.announce('Deck chosen: '..card.item.name)
  elseif a=='create' then self:create()
  elseif a=='join' then self:join()
  elseif a=='signin' then self:finish();self.callbacks.signin()
  elseif a=='copy' then self.copied=item.copy;self:command('copy',item.copy)
  elseif a=='choose' then self:openPicker()
  elseif a=='ready' then self:command('ready',(self.seats.you or {}).ready and '0' or '1')
  elseif a=='previous' or a=='next' then self:changePage(a=='previous' and -1 or 1)
  elseif a=='decks' then self:command('decks')
  elseif a=='online' or a=='leave' then self:finish();self:command('leave')
  elseif a=='versus' then
    self:finish();self.picker=false;self.focus=0;self:build();self.callbacks.announce('Versus')
  elseif a=='home' then self:leave() end
end
function Online:cancelInteractions() self.pressed=nil;self.pressedPart=nil end
function Online:mousepressed(x,y)
  self.pressed,self.pressedPart=self:hit(x,y);self.focus=0
end
function Online:mousereleased(x,y)
  local hit,part=self:hit(x,y)
  if self.pressed and self.pressed>0 and self.pressed==hit and self.pressedPart==part then self:activate(hit,part=='left' and -1 or 1) end
  self.pressed=nil;self.pressedPart=nil
end
function Online:keypressed(key)
  if self.editing then return end
  if key=='escape' then
    if self.step~='countdown' or self.picker then self:activate(#self.items) end
    return
  end
  local item=self.items[self.focus]
  if (key=='left' or key=='right') and item and item.kind=='cycle' then self:activate(self.focus,key=='left' and -1 or 1)
  elseif (key=='left' or key=='right') and self.step=='menu' then self:activate(self.tab==1 and 2 or 1)
  elseif key=='tab' or key=='up' or key=='down' or key=='left' or key=='right' then
    local found
    self.focus,found=Controls.move(self.focus,key,self.items)
    if found then self.callbacks.announce(self:describe(self.items[self.focus])) end
  elseif key=='pageup' or key=='pagedown' then self:changePage(key=='pageup' and -1 or 1)
  elseif key=='return' or key=='space' then self:activate(self.focus)
  elseif #key==1 and key:match('%w') and self.step=='menu' and self.tab==2 then
    -- Typing into the unfocused code field starts editing with that letter.
    for i,it in ipairs(self.items) do
      if it.field=='code' then
        self.focus=i;self.editing='code';self.joinCode=Online.normalize(self.joinCode..key)
        self:command('input','code',self.joinCode);self:build()
      end
    end
  end
end
function Online:wheelmoved(y) if y~=0 and not self.editing and WheelPager.ready(self) then self:changePage(y>0 and -1 or 1) end end
-- create_text_input at the PLAY button's scale: centred, letter by letter.
function Online:drawCode(item,hovered)
  local editing=self.editing=='code'
  T.text(item.label,24,item.x,item.y-32,item.w)
  Input.background(item,editing,false,hovered)
  local font,value=T.font(40),self.joinCode
  local top=item.y+(item.h-font:getHeight())/2
  local left=item.x+(item.w-font:getWidth(value))/2
  if value=='' then
    T.text(item.placeholder,40,item.x,top,item.w,T.profile)
  else
    if editing then
      local first,last=font:getWidth(Codec.utf16Prefix(value,self.first or 0)),font:getWidth(Codec.utf16Prefix(value,self.last or 0))
      if last>first then g.setColor(T.blue);g.rectangle('fill',left+first,top,last-first,font:getHeight()) end
    end
    T.text(value,40,left,top,font:getWidth(value)+8,T.white,'left')
  end
  if editing and math.floor(self.time*2)%2==0 then
    g.setColor(T.white);g.rectangle('fill',left+font:getWidth(Codec.utf16Prefix(value,self.last or #value)),top+4,3,font:getHeight()-8)
  end
end
-- Settings' create_option_cycle with five pips.
function Online:drawCycle(item,i)
  local colour=item.disabled and T.panel or T.red
  local live=not item.disabled
  Button.optionCycle(item.x+36,item.y,item.w-72,38.4,{colour=colour,label=filters[self.filter][1],
    hovered=live and self.hover==i and self.hoverPart=='center',
    pips={count=#filters,index=self.filter,off=T.ink,span=#filters*7.2-2.4}})
  Button.cycleArrows(item.x,item.y,item.w,colour,live and self.hover==i and self.hoverPart,live and self.hover==0 and self.focus==i,
    live and self.pressed==i and self.pressedPart==self.hoverPart and self.pressedPart,self.width)
end
function Online:drawPicker()
  local y,h,a=self.y,self.h,self.area
  DeckPicker.drawTray(a)
  if self.deckPhase=='ready' then
    -- A deck that can't be played online carries the card alert.
    DeckPicker.drawPiles(self,(self.seats.you or {}).deckId,function(card)
      if not card.item.online then Alert.drawOnCard(card,self.time,self.reduced,self.width,Alert.pile) end
    end)
    if #self.cards==0 then T.text(#self.decks==0 and 'No decks yet. Build one in Decks.' or 'No matches',28,a.x+16,a.y+80,a.w-32) end
    DeckPicker.drawPager(self,y+h-158)
  else
    local text=self.deckPhase=='anonymous' and 'Sign in to use your decks.' or self.deckPhase=='error' and "Couldn't load your decks." or 'Loading decks...'
    T.text(text,self.portrait and 26 or 30,a.x+16,a.y+100,a.w-32)
  end
end
function Online:draw()
  local x,y,w,h=self.x,self.y,self.w,self.h
  if not x then return end
  g.push();g.translate(0,self:offset())
  Button.modalFrameRaised(x,y,w,h)
  local step,d=self.step,self.dyna
  if self.link=='connecting' and seatedStep[step] then
    T.text('Reconnecting...',18,x+16,y+8,w-32,T.gold,'right')
  end
  if self.picker then self:drawPicker()
  elseif step=='menu' then
    if self.tab==1 then T.text('Get a code to share, then wait for your opponent to join.',26,x+48,y+118,w-96,T.paper) end
    if self.message~='' then Button.errorLine(self.message,20,x+24,y+300,w-48) end
    if self.account=='anonymous' then T.text('Sign in to play with your decks.',20,x+24,y+h-148,w-48,T.white) end
  elseif step=='joining' then
    d.title:draw(x+w/2,y+130,self.width)
    if not self.reduced then T.text(string.rep('.',math.floor(self.time*2)%4),40,x+w/2+d.title.W/2+2,y+108,60,T.white,'left') end
    T.text('Connecting to lobby '..self.code..'.',26,x+24,y+196,w-48,T.paper)
  elseif step=='waiting' then
    T.text('Lobby code',26,x,y+112,w,T.paper)
    local pw,ph=320,100
    local px,py=x+(w-pw)/2,y+156
    Button.panel(px,py+3,pw,ph,darken(T.panel,0.3));Button.panel(px,py,pw,ph,T.panel)
    d.code:draw(x+w/2,py+ph/2,self.width)
    d.prompt:draw(x+w/2,y+420,self.width)
  elseif step=='versus' or step=='countdown' then
    self:drawSeat('opponent');self:drawSeat('you')
    if step=='versus' then d.vs:draw(self.vs.x,self.vs.y,self.width) end
    local pad,px=self.pad,self.padX
    if self.message~='' then Button.errorLine(self.message,20,x+px,y+h-pad-78,w-2*px) end
  elseif step=='starting' then
    d.title:draw(x+w/2,y+130,self.width)
    T.text('Starting the match...',26,x+24,y+196,w-48,T.paper)
  elseif info[step] then
    d.title:draw(x+w/2,y+78,self.width)
    local bx,by,bw,bh=x+40,y+128,w-80,160
    Button.panel(bx,by+6,bw,bh,darken(T.panel,0.3));Button.panel(bx,by,bw,bh,T.panel)
    T.text(info[step][2]:format(self.code),26,bx+20,by+24,bw-40,T.paper)
  end
  for i,item in ipairs(self.items) do
    local lit=Controls.lit(self.hover,self.focus,i)
    local active=not item.disabled and lit
    local pressed=not item.disabled and self.pressed==i and self.hover==i
    if item.kind=='field' and item.field=='code' then self:drawCode(item,lit)
    elseif item.kind=='field' then Input.draw(item,self.query,self.editing=='search',self.first,self.last,self.time,item.disabled,lit)
    elseif item.kind=='cycle' then self:drawCycle(item,i)
    elseif item.kind~='card' then
      local colour=item.colour
      if item.disabled then item.colour=T.panel end
      Button.draw(item,active,pressed,lit and self.hover==0,self.width)
      item.colour=colour
      if item.kind=='tab' and item.tab==self.tab then Button.chosen(item,self.time,pressed,self.width,self.reduced) end
    end
  end
  if step=='countdown' and not self.picker then
    Button.panel(x+12,y+12,w-24,h-82,{T.panel[1],T.panel[2],T.panel[3],0.55},2.4)
    d.title:draw(self.vs.x,self.vs.y-90,self.width)
  end
  self.fx:draw(self.width)
  g.pop()
end
-- The seats' methods (ui/lobby_seats.lua).
for name,method in pairs(Seats.methods) do Online[name]=method end
return Online
