-- Card hover popup: G.UIDEF.card_h_popup. A lightened JOKER_GREY frame with a
-- 0.07 emboss, a darkened BLACK body, a white description box with TEXT_DARK
-- copy, and coloured badges with floating white DynaText.
local T=require('ui.theme')
local Button=require('ui.button')
local Dyna=require('ui.dynatext')
local Energy=require('ui.energy')
local Popup={}
local g=love.graphics
local FRAME={0.5+191/255*0.5,0.5+199/255*0.5,0.5+213/255*0.5,1} -- lighten(JOKER_GREY,0.5)
local BODY={55/255*0.9,66/255*0.9,68/255*0.9,0.8}                -- darken(BLACK,0.1) at 0.8
local TEXT_DARK={79/255,99/255,103/255,1}
local WHITE_BOX={1,1,1,1}
local RS,US='\30','\31'
Popup.badgeColours={Item=T.blue,Supporter=T.orange,Stadium=T.green,Tool={136/255,103/255,165/255,1},['Pokémon Tool']={136/255,103/255,165/255,1},Special={136/255,103/255,165/255,1}}
local function split(text,sep)
  local out={}
  for part in (tostring(text or '')..sep):gmatch('(.-)'..sep) do out[#out+1]=part end
  return out
end
function Popup.parseAbilities(raw)
  local list={}
  if raw==nil or raw=='' then return list end
  for _,entry in ipairs(split(raw,RS)) do
    if entry~='' then local f=split(entry,US);list[#list+1]={name=f[1] or '',effect=f[2] or '',type=f[3] or 'Ability'} end
  end
  return list
end
function Popup.parseAttacks(raw)
  local list={}
  if raw==nil or raw=='' then return list end
  for _,entry in ipairs(split(raw,RS)) do
    if entry~='' then
      local f=split(entry,US)
      list[#list+1]={name=f[1] or '',cost=Energy.split(f[2]),damage=f[3] or '',effect=f[4] or ''}
    end
  end
  return list
end
local function stageLabel(stage)
  stage=tostring(stage or '')
  if stage=='' then return nil end
  if stage=='Stage1' then return 'STAGE 1' elseif stage=='Stage2' then return 'STAGE 2' end
  return stage:upper()
end
-- Build a layout for `info` (the I row) and the live card item (damage, status).
-- Returns a table with w,h and a draw(x,y) closure; x,y is the top-left.
function Popup.build(info,item,maxWidth,roomWidth)
  local scale={name=0.42,body=0.3,small=0.27,badge=0.33}
  local width=math.min(maxWidth or 270,270)
  local outer,inner,pad=3,4.2,4
  local boxW=width-2*(outer+inner)
  local textW=boxW-2*pad-4
  local rows={}
  local function row(h,draw) rows[#rows+1]={h=h,draw=draw} end
  local lh=select(2,Dyna.measure('Hg',scale.body))
  local sh=select(2,Dyna.measure('Hg',scale.small))
  -- Name row (white text; HP at the right for Pokémon).
  local nameH=select(2,Dyna.measure('Hg',scale.name))+6
  -- In play, the HP readout is "remaining/max HP", red once damaged (the
  -- card itself carries no tag); in hand or the catalogue, the printed HP.
  local inPlay=item and item.hp and (item.zone=='active' or item.zone=='bench')
  row(nameH,function(x,y)
    local hp
    if inPlay then hp=tostring(math.max(0,item.hp-(item.damage or 0)))..'/'..tostring(item.hp)
    elseif info.category=='Pokemon' and info.hp~='' then hp=info.hp end
    local hpW=hp and (Dyna.measure(hp..' HP',scale.body)+8) or 0
    Dyna.static(info.name or '',scale.name,x+4,y,boxW-8-hpW,nameH,T.white,{align='left',fit=true,roomWidth=roomWidth})
    if hp then Dyna.static(hp..' HP',scale.body,x+boxW-4-hpW,y,hpW,nameH,(inPlay and (item.damage or 0)>0) and T.red or T.white,{align='right',roomWidth=roomWidth}) end
  end)
  -- Description box contents.
  local lines={}
  local function text(str,s,colour,opts)
    local wrapped,h=Dyna.wrap(str,s,textW-(opts and opts.indent or 0))
    for _,line in ipairs(wrapped) do lines[#lines+1]={kind='text',text=line,scale=s,h=h+2,colour=colour,indent=opts and opts.indent or 0,align=opts and opts.align} end
  end
  local abilities=Popup.parseAbilities(info.abilities)
  local attacks=Popup.parseAttacks(info.attacks)
  if item and item.status and item.status~='' then
    local parts={}
    for _,s in ipairs(Energy.split(item.status)) do parts[#parts+1]=s:sub(1,1):upper()..s:sub(2) end
    text(table.concat(parts,' · '),scale.small,T.red)
  end
  for _,a in ipairs(abilities) do
    lines[#lines+1]={kind='label',text=a.name,tag=a.type~='' and a.type or 'Ability',scale=scale.body,h=lh+4}
    if a.effect~='' then text(a.effect,scale.small,TEXT_DARK) end
  end
  for _,a in ipairs(attacks) do
    lines[#lines+1]={kind='attack',attack=a,scale=scale.body,h=lh+4}
    if a.effect~='' then text(a.effect,scale.small,TEXT_DARK) end
  end
  if info.effect and info.effect~='' then text(info.effect,scale.small,TEXT_DARK) end
  if info.category=='Pokemon' then
    lines[#lines+1]={kind='footer',scale=scale.small,h=sh+6}
  end
  if #lines==0 then text(info.category=='Energy' and 'Provides one Energy.' or ' ',scale.small,TEXT_DARK) end
  local boxH=2*pad+2
  for _,l in ipairs(lines) do boxH=boxH+l.h end
  row(boxH+4,function(x,y)
    -- desc_from_rows: BACKGROUND_WHITE, r=0.1, emboss 0.05, padding 0.04.
    Button.panel(x,y+3,boxW,boxH,{0.7,0.7,0.7,1},1.2)
    Button.panel(x,y,boxW,boxH,WHITE_BOX,1.2)
    local cy=y+pad+1
    for _,l in ipairs(lines) do
      if l.kind=='text' then
        Dyna.static(l.text,l.scale,x+pad+2+l.indent,cy,textW-l.indent,l.h-2,l.colour,{align=l.align or 'left',shadow=false,roomWidth=roomWidth})
      elseif l.kind=='label' then
        local tagW=Dyna.measure(l.tag,scale.small)+10
        Button.panel(x+pad+2,cy+2,tagW,l.h-4,T.red,0.9)
        Dyna.static(l.tag,scale.small,x+pad+2,cy+2,tagW,l.h-4,T.white,{roomWidth=roomWidth})
        Dyna.static(l.text,l.scale,x+pad+tagW+8,cy,textW-tagW-6,l.h-2,T.ink,{align='left',shadow=false,fit=true,roomWidth=roomWidth})
      elseif l.kind=='attack' then
        local a=l.attack
        local pipR=7.5
        local pipW=#a.cost>0 and Energy.row(a.cost,x+pad+2,cy+l.h/2-1,pipR,2,1,'left') or 0
        local dmgW=a.damage~='' and (Dyna.measure(a.damage,l.scale)+6) or 0
        if a.damage~='' then Dyna.static(a.damage,l.scale,x+boxW-pad-2-dmgW,cy,dmgW,l.h-2,T.red,{align='right',shadow=false,roomWidth=roomWidth}) end
        Dyna.static(a.name,l.scale,x+pad+2+pipW+(pipW>0 and 6 or 0),cy,textW-pipW-dmgW-8,l.h-2,T.ink,{align='left',shadow=false,fit=true,roomWidth=roomWidth})
      elseif l.kind=='footer' then
        local cx=x+pad+2
        local function part(label,types,value)
          Dyna.static(label,scale.small,cx,cy,100,l.h-4,TEXT_DARK,{align='left',shadow=false,roomWidth=roomWidth})
          cx=cx+Dyna.measure(label,scale.small)+4
          if types and #types>0 then cx=cx+Energy.row(types,cx,cy+l.h/2-2,5,2,1,'left')+3 end
          if value and value~='' then
            Dyna.static(value,scale.small,cx,cy,80,l.h-4,TEXT_DARK,{align='left',shadow=false,roomWidth=roomWidth})
            cx=cx+Dyna.measure(value,scale.small)
          end
          cx=cx+10
        end
        local wk=info.weakness or '';local rs=info.resistance or ''
        local wt,wv=wk:match('^([^:]*):?(.*)$');local rt,rv=rs:match('^([^:]*):?(.*)$')
        part('Weak',wt~='' and {wt} or nil,wt~='' and (wv~='' and wv or '×2') or '–')
        part('Resist',rt~='' and {rt} or nil,rt~='' and (rv~='' and rv or '-30') or '–')
        local retreat=tonumber(info.retreat) or 0
        local cost={};for _=1,retreat do cost[#cost+1]='Colorless' end
        part('Retreat',cost,retreat==0 and '0' or nil)
      end
      cy=cy+l.h
    end
  end)
  -- Badges: type (and stage) for Pokémon, Trainer subtype, Energy type.
  local badges={}
  if info.category=='Pokemon' then
    for _,t in ipairs(Energy.split(info.types)) do badges[#badges+1]={text=t:upper(),colour=Energy.colour(t)} end
    local st=stageLabel(info.stage)
    if st then badges[#badges+1]={text=st,colour={79/255,99/255,103/255,1}} end
  elseif info.category=='Trainer' then
    local kind=info.trainerType~='' and info.trainerType or 'Trainer'
    badges[#badges+1]={text=kind:upper(),colour=Popup.badgeColours[kind] or T.blue}
  else
    local special=(info.energyType or '')=='Special'
    local t=Energy.split(info.types)[1]
    badges[#badges+1]={text=special and 'SPECIAL ENERGY' or ((t and t:upper() or 'BASIC')..' ENERGY'),colour=special and Popup.badgeColours.Special or Energy.colour(t or 'Colorless')}
  end
  if #badges>0 then
    local bh=24
    row(#badges*(bh+3)+2,function(x,y)
      for i,b in ipairs(badges) do
        local by=y+(i-1)*(bh+3)
        local bw=math.max(120,Dyna.measure(b.text,scale.badge)+24)
        local bx=x+(boxW-bw)/2
        Button.panel(bx,by+3,bw,bh,{b.colour[1]*0.7,b.colour[2]*0.7,b.colour[3]*0.7,1},1.2)
        Button.panel(bx,by,bw,bh,b.colour,1.2)
        Dyna.static(b.text,scale.badge,bx,by-1,bw,bh,T.white,{roomWidth=roomWidth})
      end
    end)
  end
  local h=2*(outer+inner)+4
  for _,r in ipairs(rows) do h=h+r.h end
  return {w=width,h=h,draw=function(x,y)
    Button.panel(x,y+4,width,h,{FRAME[1]*0.7,FRAME[2]*0.7,FRAME[3]*0.7,1},1.5)
    Button.panel(x,y,width,h,FRAME,1.5)
    Button.panel(x+outer,y+outer,width-2*outer,h-2*outer,BODY,1.5)
    local cy=y+outer+inner+2
    for _,r in ipairs(rows) do r.draw(x+outer+inner,cy);cy=cy+r.h end
  end}
end
return Popup
