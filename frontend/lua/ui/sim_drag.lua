local D=require('ui.card_dimensions')
-- Dragging on the table, mixed into ui/simulator.lua's Simulator: reordering the held card
-- within its own hand or Bench row, and the drop zone under the pointer.
local Layout=require('ui.sim_layout')
local Simulator={}
local prefix=Layout.prefix
function Simulator:rowCards(card)
  local row={}
  for _,c in ipairs(self.cards) do
    if c.item.owner==card.item.owner and c.item.zone==card.item.zone then row[#row+1]=c end
  end
  table.sort(row,function(a,b) return a.item.displayIndex<b.item.displayIndex end)
  return row
end
function Simulator:alignRow(row)
  if #row==0 then return end
  local kind=row[1].item.zone
  local zone=self.L.zones[prefix(row[1].item.owner)..kind]
  local items={}
  for i,c in ipairs(row) do c.item.displayIndex=i-1;items[i]=c.item end
  local positions=kind=='bench' and Layout.benchPositions(zone,items)
  for i,c in ipairs(row) do
    local x,y,r
    if kind=='hand' then x,y,r=Layout.hand(zone,#row,i-1)
    else x,y,r=positions[c.item.index],zone.y,0 end
    c.homeX,c.homeY,c.baseY,c.baseRotation=x,y,y,r
    c.motion.T.r=r+(c.statusRotation or 0)
    c.fan=kind=='hand' and (i-1-(#row-1)/2)/#row or nil
  end
  self:sortRows()
end
function Simulator:overOwnRow(card,x,y)
  local item=card.item
  if item.owner~='you' or item.hidden then return false end
  -- Classify the held card's centre, not the grabbed edge. Highlighted cards
  -- lift above the row, so their top edge can overlap a playable board zone.
  if self.drag and self.drag.card==card then x,y=x-self.drag.dx,y-self.drag.dy end
  if item.zone=='hand' then
    local zone=self.L.zones.you_hand
    return x>=self.L.table.x and x<=self.boardW and y>=zone.y-D.HALF_H*zone.scale-18 and y<=self.boardH+30
  elseif item.zone=='bench' then
    local well=self.L.zones.you_bench.well
    return x>=well.x-30 and x<=well.x+well.w+30 and y>=well.y-12 and y<=well.y+well.h+12
  end
  return false
end
function Simulator:updateReorder(x,y)
  local d=self.drag
  if not d.originalRow then return end
  if not self:overOwnRow(d.card,x,y) then
    if d.reordering then self:alignRow(d.originalRow);d.reordering=false end
    return
  end
  d.reordering=true
  local row=self:rowCards(d.card)
  local at=d.card.item.displayIndex+1
  local center=x-d.dx
  -- CardArea:align_cards sorts by target centres, not the trailing visible
  -- positions: neighbors move aside as soon as the held card crosses them.
  while at>1 and center<row[at-1].homeX do row[at],row[at-1]=row[at-1],row[at];at=at-1 end
  while at<#row and center>row[at+1].homeX do row[at],row[at+1]=row[at+1],row[at];at=at+1 end
  self:alignRow(row)
end
function Simulator:dropZoneAt(x,y,card)
  local L=self.L;local item=card.item
  local Z=L.zones
  if self:overOwnRow(card,x,y) then return {zone='reorder',index=item.displayIndex} end
  if not item.draggable then return nil end
  if item.zone=='hand' then
    if item.category=='Trainer' and (item.trainerType=='Item' or item.trainerType=='Supporter') then
      for _,zone in ipairs({Z.you_bench,Z.opp_bench}) do
        if Layout.inside(zone.well,x,y) then return {zone='playmat',index=0,well=zone.well} end
      end
    end
    if Layout.inside(Z.you_active.well,x,y) then return {zone='active',index=0,well=Z.you_active.well} end
    if Layout.inside(Z.you_bench.well,x,y) then
      local count=0;local onto
      for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='bench' then count=count+1;if c~=card and c:hit(x,y) then onto=c end end end
      local index=onto and onto.item.index or Layout.benchIndex(Z.you_bench,count,x)
      return {zone='bench',index=index,well=Z.you_bench.well,card=onto}
    end
    if Layout.inside(Z.stadium.well,x,y) then return {zone='stadium',index=0,well=Z.stadium.well} end
    if Layout.inside(Z.played.well,x,y) then return {zone='playmat',index=0,well=Z.played.well} end
    if Layout.inside(Z.playmat.well,x,y) or Layout.inside(Z.opp_active.well,x,y) then return {zone='playmat',index=0,well=Z.playmat.well} end
  elseif item.zone=='bench' then
    if Layout.inside(Z.you_bench.well,x,y) then
      local count=0;for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='bench' then count=count+1 end end
      return {zone='bench',index=math.min(count-1,Layout.benchIndex(Z.you_bench,count,x)),well=Z.you_bench.well}
    end
    -- A Benched Pokémon dropped on the Active spot swaps in: the Active
    -- retreats to this one, paying its cost from the attached Energy.
    if Layout.inside(Z.you_active.well,x,y) then return {zone='retreat',index=item.index,well=Z.you_active.well} end
  elseif item.zone=='active' then
    for _,c in ipairs(self.cards) do if c.item.owner=='you' and c.item.zone=='bench' and c:hit(x,y) then return {zone='retreat',index=c.item.index,well=Z.you_bench.well,card=c} end end
    if Layout.inside(Z.you_bench.well,x,y) then return {zone='retreat',index=-1,well=Z.you_bench.well} end
  end
  return nil
end
return Simulator
