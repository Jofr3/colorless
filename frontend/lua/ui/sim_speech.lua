-- What the table says about its cards and buttons to a screen reader: a card's
-- place, health, attachments and conditions on focus, its printed text when
-- the inspector opens, and why Retreat is unavailable. Pure text: it never
-- draws, so the table and its overlays share one wording.
local Codec=require('ui.codec')
local Popup=require('ui.popup')
local Speech={}
local function capital(s) return (tostring(s):gsub('^%l',string.upper)) end
-- 'a', 'a and b', 'a, b and c'.
function Speech.list(parts)
  if #parts<=1 then return parts[1] or '' end
  return table.concat(parts,', ',1,#parts-1)..' and '..parts[#parts]
end
-- Counts in first-seen order: {'Fire','Fire','Water'} -> '2 Fire and 1 Water'.
local function counted(kinds,suffix)
  local order,counts={},{}
  for _,k in ipairs(kinds) do
    if not counts[k] then counts[k]=0;order[#order+1]=k end
    counts[k]=counts[k]+1
  end
  local parts={}
  for _,k in ipairs(order) do parts[#parts+1]=counts[k]..' '..k..(suffix or '') end
  return Speech.list(parts)
end
function Speech.energy(kinds) return counted(kinds or {},' Energy') end
-- An attack or retreat cost: '1 Fire and 1 Colorless', or 'free'.
function Speech.cost(types)
  if not types or #types==0 then return 'free' end
  return counted(types)
end
local ZONES={hand='hand',active='Active',prize='Prizes',played='play area',discard='discard pile'}
-- "your Active", "opponent's Bench 2", "Stadium".
function Speech.place(item)
  if item.owner=='global' or item.zone=='stadium' then return 'Stadium' end
  local whose=item.owner=='opponent' and "opponent's " or 'your '
  if item.zone=='bench' then return whose..'Bench '..((item.index or 0)+1) end
  return whose..(ZONES[item.zone] or tostring(item.zone))
end
function Speech.conditions(status)
  local out={}
  for _,s in ipairs(Codec.list(status)) do out[#out+1]=capital(s) end
  return out
end
-- 'Pikachu, opponent's Bench 2, 40 of 70 HP, 1 Lightning Energy, Paralyzed'.
-- `info` maps card ids to their I rows, for attached Tools' names.
function Speech.card(item,info)
  local parts={item.name or 'Card',Speech.place(item)}
  local inPlay=item.zone=='active' or item.zone=='bench'
  if inPlay and item.hp then parts[#parts+1]=math.max(0,item.hp-(item.damage or 0))..' of '..item.hp..' HP' end
  if inPlay and #(item.energies or {})>0 then parts[#parts+1]=Speech.energy(item.energies) end
  for _,t in ipairs(item.toolCards or {}) do
    local name=info and info[t.cardId] and info[t.cardId].name or ''
    parts[#parts+1]='Tool '..(name~='' and name or 'attached')
  end
  for _,s in ipairs(Speech.conditions(item.status)) do parts[#parts+1]=s end
  return table.concat(parts,', ')
end
local function sentence(text)
  text=tostring(text or ''):gsub('%s+$','')
  if text=='' then return '' end
  return text:find('[%.!?]$') and text or text..'.'
end
-- Parts read as sentences, each closed by one full stop.
function Speech.sentences(parts)
  local out={}
  for _,p in ipairs(parts) do p=sentence(p);if p~='' then out[#out+1]=p end end
  return table.concat(out,' ')
end
-- The printed card as one paragraph, from the I row the inspector draws.
function Speech.details(info)
  if not info then return '' end
  local out={}
  local function add(text) text=sentence(text);if text~='' then out[#out+1]=text end end
  if info.category=='Pokemon' then
    local stage=Popup.STAGES[info.stage] or (info.stage~='' and info.stage or 'Basic')
    local types=Codec.list(info.types)
    add(stage..' Pokémon'..(#types>0 and ', '..Speech.list(types)..' type' or '')..(info.hp~='' and ', '..info.hp..' HP' or ''))
    for _,a in ipairs(Popup.parseAbilities(info.abilities)) do
      add((a.type~='' and a.type or 'Ability')..': '..a.name);add(a.effect)
    end
    for _,a in ipairs(Popup.parseAttacks(info.attacks)) do
      add('Attack: '..a.name..', costs '..Speech.cost(a.cost)..(a.damage~='' and ', '..a.damage..' damage' or ''));add(a.effect)
    end
    add(info.effect)
    local wt,wv=(info.weakness or ''):match('^([^:]*):?(.*)$')
    local rt,rv=(info.resistance or ''):match('^([^:]*):?(.*)$')
    if wt~='' then add('Weakness: '..wt..' '..(wv~='' and wv or '×2')) end
    if rt~='' then add('Resistance: '..rt..' '..(rv~='' and rv or '-30')) end
    local retreat=tonumber(info.retreat) or 0
    add('Retreat cost: '..(retreat==0 and 'free' or retreat..' Colorless'))
  elseif info.category=='Trainer' then
    add((info.trainerType~='' and info.trainerType or 'Trainer')..' card');add(info.effect)
  else
    local special=(info.energyType or '')=='Special'
    local t=Codec.list(info.types)[1]
    add(special and 'Special Energy' or 'Basic '..(t or '')..' Energy');add(info.effect)
  end
  return table.concat(out,' ')
end
-- A table button as heard: an attack row's damage and cost, an ability, a
-- Retreat's cost.
function Speech.control(b)
  local parts={b.label}
  if b.damage and b.damage~='' then parts[#parts+1]=b.damage..' damage' end
  if b.hasCost or (b.cost and #b.cost>0) then parts[#parts+1]=(b.cost and #b.cost>0) and 'costs '..Speech.cost(b.cost) or 'free' end
  if b.ability then parts[#parts+1]='Ability' end
  if b.selected then parts[#parts+1]='selected' end
  return table.concat(parts,', ')
end
-- Why the engine refuses a retreat, read off what the table knows. The engine
-- also counts locks and blocking Abilities, which the table cannot see; those
-- fall to the last line.
function Speech.retreatReason(sim,item,cost)
  if sim.allow and sim.allow.retreated then return 'you already retreated this turn' end
  for _,s in ipairs(Codec.list(item.status)) do
    if s=='asleep' or s=='paralyzed' then return item.name..' is '..capital(s) end
  end
  local benched=false
  for _,it in ipairs(sim.items or {}) do if it.owner=='you' and it.zone=='bench' then benched=true;break end end
  if not benched then return 'you have no Benched Pokémon' end
  if #(item.energies or {})<#(cost or {}) then return 'it needs '..#cost..' Energy attached' end
  return 'an effect prevents it'
end
return Speech
