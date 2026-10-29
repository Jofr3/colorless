-- One simulator mailbox snapshot as plain tables. Pure: it never calls LÖVE,
-- so the parse runs headless against the fixtures TypeScript publishes.
local Codec=require('ui.codec')
local T=require('ui.theme')
local W=require('ui.wire_fields').sim
local Model={}
local function colour(name) return T[name] or T.blue end
-- Attached cards: "type|uid|cardId" per Energy, "uid|cardId" per Tool.
local function energies(field)
  local kinds,cards={},{}
  for _,part in ipairs(Codec.list(field)) do
    local kind,uid,cardId=part:match('^([^|]*)|?([^|]*)|?(.*)$')
    kinds[#kinds+1]=kind
    if uid and uid~='' then cards[#cards+1]={id=uid,cardId=cardId,kind=kind} end
  end
  return kinds,cards
end
local function tools(field)
  local cards={}
  for _,part in ipairs(Codec.list(field)) do
    local uid,cardId=part:match('^([^|]*)|?(.*)$')
    if uid and uid~='' then cards[#cards+1]={id=uid,cardId=cardId} end
  end
  return cards
end
local parse={}
function parse.S(m,r) local s=W.side
  m.sides[r[s.owner]]={deck=tonumber(r[s.deck]) or 0,prizes=tonumber(r[s.prizes]) or 0,hand=tonumber(r[s.hand]) or 0,discard=tonumber(r[s.discard]) or 0,mulligan=tonumber(r[s.mulligans]) or 0}
end
function parse.C(m,r) local c=W.card
  local kinds,energyCards=energies(r[c.energies])
  local toolCards=tools(r[c.tools])
  m.items[#m.items+1]={id=r[c.uid],cardId=r[c.cardId],name=r[c.name],owner=r[c.owner],zone=r[c.zone],index=tonumber(r[c.index]) or 0,hidden=r[c.hidden]=='true',
    category=r[c.category] or '',trainerType=r[c.trainerType] or '',stage=r[c.stage] or '',hp=tonumber(r[c.hp]),damage=tonumber(r[c.damage]) or 0,
    energies=kinds,energyCards=energyCards,tools=#toolCards,toolCards=toolCards,status=r[c.status] or '',types=r[c.types] or '',
    draggable=r[c.draggable]=='true',displayIndex=tonumber(r[c.displayIndex]) or 0}
end
function parse.D(m,r)
  local uid=r[W.knockedOut.uid]
  if not m.knockedOutSeen[uid] then m.knockedOutSeen[uid]=true;m.knockedOut[#m.knockedOut+1]=uid end
end
function parse.R(m,r) m.rareCandy=r[W.rareCandy.uid] end
-- Mode, away player and flags are absent (nil) unless an L row sets them.
function parse.L(m,r) local l=W.lifecycle
  if (r[l.mode] or '')~='' then m.mode=r[l.mode] end
  m.away={name=r[l.awayName] or '',ms=r[l.awayMs] or ''}
  m.flags={};for _,flag in ipairs(Codec.list(r[l.flags])) do m.flags[flag]=true end
  m.allow.partial=r[l.allow]=='partial'
end
function parse.I(m,r) local n=W.info
  m.info[r[n.cardId]]={category=r[n.category] or '',trainerType=r[n.trainerType] or '',stage=r[n.stage] or '',hp=r[n.hp] or '',types=r[n.types] or '',
    retreat=r[n.retreat] or '',weakness=r[n.weakness] or '',resistance=r[n.resistance] or '',effect=r[n.effect] or '',abilities=r[n.abilities] or '',
    attacks=r[n.attacks] or '',energyType=r[n.energyType] or '',name=r[n.name] or ''}
end
function parse.A(m,r) local a=W.sidebar
  m.actions[#m.actions+1]={token=r[a.token],label=r[a.label],colour=colour(r[a.colour]),disabled=r[a.disabled]=='true',slot=r[a.slot] or 'minor'}
end
function parse.K(m,r) local k=W.cardAction
  local uid=r[k.uid]
  local list=m.cardActions[uid] or {};m.cardActions[uid]=list
  list[#list+1]={token=r[k.token],uid=uid,label=r[k.label],colour=colour(r[k.colour]),disabled=r[k.disabled]=='true',targetUid=r[k.targetUid] or '',
    group=r[k.group] or '',cost=Codec.list(r[k.cost]),damage=r[k.damage] or '',hasCost=r[k.hasCost]=='true'}
end
function parse.M(m,r) local n=W.menu
  m.menu={kind=r[n.kind],title=r[n.title],note=r[n.note],mandatory=r[n.mandatory]=='true',id=r[n.id] or r[n.title],hideTargetOutline=r[n.hideTargetOutline]=='true',
    counterSourceUid=r[n.counterSourceUid] or '',counterTransfer=r[n.counterTransfer]=='true',options={},footer={}}
end
-- Options and footer buttons belong to the menu row before them.
local function option(list,r) local o=W.option
  list[#list+1]={token=r[o.token],label=r[o.label],colour=colour(r[o.colour]),disabled=r[o.disabled]=='true',selected=r[o.selected]=='true',
    cardId=r[o.cardId] or '',uid=r[o.uid] or '',dimmed=r[o.dimmed]=='true'}
end
function parse.O(m,r) if m.menu then option(m.menu.options,r) end end
function parse.F(m,r) if m.menu then option(m.menu.footer,r) end end
-- Card text rows repeat in every snapshot, so their decoded fields are kept
-- by raw line (read only, never mutated); the memo starts over past a bound.
local textRows,textCount={},0
local function snapshotRows(raw)
  local list={}
  for line in raw:gmatch('[^\n]+') do
    local fields
    if line:byte(1)==73 and line:byte(2)==9 then -- 'I\t'
      fields=textRows[line]
      if not fields then
        if textCount>=512 then textRows,textCount={},0 end
        fields=Codec.fields(line);textRows[line]=fields;textCount=textCount+1
      end
    else fields=Codec.fields(line) end
    list[#list+1]=fields
  end
  return list
end
-- Returns nil for an empty snapshot.
function Model.parse(raw)
  local rows=snapshotRows(raw)
  local f=rows[1];if not f then return nil end
  local H=W.header
  local m={
    revision=tonumber(f[H.revision]) or 0,phase=f[H.phase],you=f[H.you],opponent=f[H.opponent],
    turn=tonumber(f[H.turn]) or 0,gamePhase=f[H.gamePhase] or '',message=f[H.message] or '',title=f[H.title] or '',hint=f[H.hint] or '',
    turnIndex=tonumber(f[H.turnIndex]) or 0,turnCount=tonumber(f[H.turnCount]) or 0,
    waiting=f[H.waitingOn] or '',activePlayer=f[H.activePlayer] or '',viewerSeat=f[H.seat] or '',
    allow={energy=f[H.energyAttached]=='1',supporter=f[H.supporterPlayed]=='1',retreated=f[H.retreated]=='1'},
    outcome=f[H.outcome] or '',outcomeDetail=f[H.outcomeDetail] or '',shuffled=f[H.shuffled] or '',matchId=f[H.matchId],
    announce=f[H.announce] or '',messageSerial=f[H.messageSerial] or '',warning=f[H.warning] or '',
    items={},sides={},actions={},cardActions={},info={},knockedOut={},knockedOutSeen={},
  }
  for i=2,#rows do
    local r=rows[i]
    local read=parse[r[1]]
    if read then read(m,r) end
  end
  m.knockedOutSeen=nil
  return m
end
return Model
