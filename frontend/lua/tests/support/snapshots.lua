-- A late-game simulator snapshot: full benches carrying Energy, an armed
-- Active with a Tool on each side, a 7-card hand, 25-card discard piles, card
-- text for every distinct card, and the history buttons. Rows are built by
-- field name, so the fixture follows wire_fields.lua.
local Codec=require('ui.codec')
local W=require('ui.wire_fields').sim
local Late={}
local RS,US='\30','\31'
local LOREM='Search your deck for up to 2 Basic Pokemon and put them onto your Bench. Then, shuffle your deck. If you do, this attack does 30 more damage for each Energy attached to your opponent\'s Active Pokemon.'

function Late.row(tag,spec,fields)
  local out={}
  local width=0
  for _,column in pairs(spec) do width=math.max(width,column) end
  for i=1,width do out[i]='' end
  if tag then out[1]=tag end
  for name,value in pairs(fields) do out[assert(spec[name],name)]=Codec.encode(value) end
  return table.concat(out,'\t')
end
local row=Late.row

-- Card ids that ship a transition scan, reused so pages repeat faces.
Late.ART_IDS={'sv01-030','sv01-033','sv01-036','sv01-038','sv01-042','sv01-046','sv01-047','sv01-052'}

-- `options.revision`, `options.matchId`, `options.discard` (top card offset),
-- `options.discarded` (how many of your hand cards are now in the discard),
-- `options.extra` (rows appended at the end), `options.flipped` (the same
-- table after a hot-seat End turn: seen by Misty as p2, so owners mirror,
-- public uids stay and the hands swap which one is face down),
-- `options.hide` (uids shown face down), `options.cardIds` (uid to the
-- card id shown instead) and `options.uids` (uid to the uid sent instead, as
-- an evolved stack reports its new top card).
function Late.snapshot(options)
  options=options or {}
  local ids,order={},{}
  local function id(n)
    local cardId=string.format('sv%02d-%03d',(n%8)+1,n)
    if not ids[cardId] then ids[cardId]=true;order[#order+1]=cardId end
    return cardId
  end
  local flipped=options.flipped
  local function card(fields)
    if options.hide and options.hide[fields.uid] then fields.cardId='hidden';fields.hidden='true';fields.name='Face-down card' end
    if options.cardIds and options.cardIds[fields.uid] then fields.cardId=options.cardIds[fields.uid] end
    if options.uids and options.uids[fields.uid] then fields.uid=options.uids[fields.uid] end
    return row('C',W.card,fields)
  end
  local out={row(nil,W.header,{revision=options.revision or 1,phase='ready',you=flipped and 'Misty' or 'Ash',opponent=flipped and 'Ash' or 'Misty',turn=flipped and 10 or 9,gamePhase='turn:action',
    title='Your turn',hint='Attach Energy, play Trainers and Pokemon, then attack or end your turn.',turnIndex=0,turnCount=1,
    waitingOn='you',activePlayer='you',seat=flipped and 'p2' or 'p1',energyAttached=1,supporterPlayed=0,retreated=0,matchId=options.matchId or 'late'})}
  out[#out+1]=row('L',W.lifecycle,{mode='local',spectating='false',flags='undo,newgame,choosedecks,concede,leave',allow='full'})
  -- `player` names the seat in uids (Ash's cards are you-*), `owner` is the
  -- side of the table the viewer sees it on.
  for _,player in ipairs({'you','opponent'}) do
    local ash=player=='you'
    local owner=flipped and (ash and 'opponent' or 'you') or player
    local mine=owner=='you'
    local last=ash and 6 or 5
    out[#out+1]=row('S',W.side,{owner=owner,deck=20,prizes=4,hand=last+1,discard=25,mulligans=0})
    for i=0,last do
      if mine then
        local gone=ash and i<(options.discarded or 0)
        out[#out+1]=card({uid=player..'-h'..i,cardId=id(ash and i or 10+i),name='Hand Card '..i,owner=owner,zone=gone and 'discard' or 'hand',
          index=gone and 25+i or i,hidden='false',category='Trainer',trainerType='Item',draggable='true',displayIndex=i})
      else
        out[#out+1]=card({uid=owner..'-hand-'..i,cardId='hidden',name='Face-down card',owner=owner,zone='hand',index=i,hidden='true',draggable='false',displayIndex=i})
      end
    end
    local energy=id(40)
    out[#out+1]=card({uid=player..'-a',cardId=id(ash and 20 or 21),name='Charizard ex',owner=owner,zone='active',index=0,hidden='false',
      category='Pokemon',stage='Stage2',hp=330,damage=120,
      energies='Fire|'..player..'-e1|'..energy..',Fire|'..player..'-e2|'..energy..',Fire|'..player..'-e3|'..energy,
      tools=player..'-t1|'..id(41),status='burned',types='Fire',draggable=mine and 'true' or 'false',displayIndex=0})
    for b=0,4 do
      local water=id(42)
      out[#out+1]=card({uid=player..'-b'..b,cardId=id(22+b+(ash and 0 or 5)),name='Bench Mon '..b,owner=owner,zone='bench',index=b,hidden='false',
        category='Pokemon',stage='Basic',hp=70+b*10,damage=b*10,energies='Water|'..player..'-be'..b..'|'..water..',Water|'..player..'-bf'..b..'|'..water,
        types='Water',draggable=mine and 'true' or 'false',displayIndex=b})
    end
    for d=0,24 do
      local n=d==24 and (options.discard or 0)+50+d or 50+d
      out[#out+1]=card({uid=player..'-d'..d,cardId=id(n),name='Discard '..d,owner=owner,zone='discard',index=d,hidden='false',
        category='Trainer',trainerType='Item',draggable='false',displayIndex=d})
    end
  end
  out[#out+1]=row('C',W.card,{uid='stad',cardId='sv01-167',name='Beach Court',owner='global',zone='stadium',index=0,hidden='false',
    category='Trainer',trainerType='Stadium',draggable='false',displayIndex=0})
  for _,cardId in ipairs(order) do
    out[#out+1]=row('I',W.info,{cardId=cardId,category='Pokemon',stage='Basic',hp=120,types='Fire',retreat=2,weakness='Water:x2',
      abilities='Ability Name'..US..LOREM..US..'Ability',
      attacks='Flare'..US..'Fire,Colorless'..US..'30'..US..LOREM..RS..'Blast'..US..'Fire,Fire,Colorless'..US..'120'..US..LOREM,name='Card '..cardId})
  end
  local viewer=flipped and 'opponent' or 'you'
  for k=1,8 do
    out[#out+1]=row('K',W.cardAction,{token=k,uid=viewer..'-h'..(k%(flipped and 6 or 7)),label='Attach to Bench Mon',colour='blue',disabled='false',targetUid=viewer..'-b'..(k%5),group='attach'})
  end
  out[#out+1]=row('A',W.sidebar,{token='end',label='End turn',colour='red',disabled='false',slot='primary'})
  for i,label in ipairs({'Undo turn','Undo action','New game','Redo action','Redo turn'}) do
    out[#out+1]=row('A',W.sidebar,{token='history'..i,label=label,colour='red',disabled=i>3 and 'true' or 'false',slot='minor'})
  end
  for _,r in ipairs(options.extra or {}) do out[#out+1]=r end
  return table.concat(out,'\n'),order
end

-- A targeting prompt over the late-game board, with a long title and note.
function Late.prompt(revision)
  local extra={row('M',W.menu,{kind='board',title='Choose 1 of your Benched Pokemon to switch with your Active Pokemon. It keeps its Energy.',
    note='Click a highlighted card. The new Active Pokemon is not affected by Special Conditions from before.',mandatory='true',id='tg'})}
  for b=0,4 do
    extra[#extra+1]=row('O',W.option,{token=30+b,label='Bench '..b,colour='blue',disabled='false',selected='false',uid='you-b'..b})
  end
  return (Late.snapshot({revision=revision,extra=extra}))
end

-- The setup screen's go-first choice with the dice button.
function Late.setup(revision,matchId)
  return table.concat({
    row(nil,W.header,{revision=revision,phase='ready',you='Ash',opponent='Misty',turn=0,gamePhase='setup:chooseFirst',title='Choose who goes first',
      turnIndex=0,turnCount=0,waitingOn='you',seat='p1',energyAttached=0,supporterPlayed=0,retreated=0,matchId=matchId or 'setup'}),
    row('A',W.sidebar,{token='first',label='Go first',colour='blue',disabled='false',slot='primary'}),
    row('A',W.sidebar,{token='second',label='Go second',colour='blue',disabled='false',slot='primary'}),
    row('A',W.sidebar,{token='dice',label='Random',colour='red',disabled='false',slot='minor'}),
  },'\n')
end

-- A builder page of catalog cards and a deck list with names too long for
-- their labels.
function Late.builder(revision)
  local B=require('ui.wire_fields').builder
  local out={row(nil,B.header,{revision=revision or 1,phase='ready',name='A Deck Name Long Enough To Need Fitting',format='standard',
    busy=0,page=1,pages=3,total=20,count=60,details='',transfer='',importing=0,dirty=0,retry=0})}
  for i=1,8 do
    out[#out+1]=row('C',B.card,{cardId=Late.ART_IDS[i],name='Very Long Card Name Number '..i,supertype='Pokémon',subtype='Basic',
      quantity=i%3,remaining=4-i%3,hp=60,mark='H',number=i,copyLimit=4,illegal=i==3 and 1 or 0})
  end
  for i=1,20 do
    out[#out+1]=row('D',B.card,{cardId=Late.ART_IDS[(i-1)%8+1],name='Deck card with a long name '..i,supertype='Pokémon',subtype='Basic',
      quantity=3,remaining=1,hp=60,mark='H',number=i,copyLimit=4,illegal=i==2 and 1 or 0})
  end
  return table.concat(out,'\n')
end
return Late
