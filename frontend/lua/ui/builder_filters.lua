-- The builder's filters dialog: its Cards, Print and Text tabs, each filter's option cycle and
-- the HP sliders. Its functions are Builder methods (builder.lua installs them).
local T=require('ui.theme')
local Fit=require('ui.text_fit')
local PageText=require('ui.page_text')
local Filters={methods={}}
local Builder=Filters.methods
Filters.SORT_LABELS={name='Name',['hp-desc']='HP',set='Set'}
local SORT_LABELS=Filters.SORT_LABELS
local SORT_ORDER={'name','hp-desc','set'}
function Builder:filterCycle(label,value,key,y,count,index,selected,x,width)
  width=width or 264;x=x or self.width/2-width/2
  local centreWidth=width-72
  -- Format and sort step through their own commands; every other filter cycles.
  local action=(key=='format' or key=='sort') and key or 'cycle'
  local own=action~='cycle'
  -- One focus stop per filter: '>' takes focus and Left/Right step it; '<' answers the pointer.
  self:add('<',x,y,28.8,38.4,action,T.red,own and -1 or {key,-1},{skipFocus=true,cycleKey=key,optionTitle=label,optionValue=value}).fontSize=24
  self.filterTexts=self.filterTexts or {}
  local text=self.filterTexts[key] or PageText.new();self.filterTexts[key]=text
  -- Keep long catalog values within the original narrow cycle.
  local display=value
  local limit=(centreWidth-12)/(0.4*0.3)
  if T.font(200):getWidth(display)>limit then
    display=Fit.ellipsize(value,limit,function(s) return T.font(200):getWidth(s) end)
  end
  text:set(display,self.time)
  self:add(value,x+36,y,centreWidth,38.4,'filter-value',T.red,key,
    {cycleCentre=true,inert=true,cycleWidth=width,optionTitle=label,cycleText=text,pipCount=count or 0,pipIndex=index or 1,pipSelected=selected})
  self:add('>',x+width-28.8,y,28.8,38.4,action,T.red,own and 1 or {key,1},{cycleKey=key,optionTitle=label,optionValue=value}).fontSize=24
end
-- The dialog's controls, in the dialog `m` with its content `bw` wide from `x`.
function Builder:buildFilters(m,x,bw)
  local p=self.portrait
  local labels={'Cards','Print','Text'}
  local tw,gap=p and 114 or 150,p and 8 or 12
  local left=m.x+(m.w-3*tw-2*gap)/2
  for i,label in ipairs(labels)do self:add(label,left+(i-1)*(tw+gap),m.y+34,tw,48,'filter-tab',T.red,i).fontSize=p and 24 or 30 end
  if self.filterPage<3 then
    local inputs={}
    if self.filterPage==1 then inputs[1]={label='Format',value=self.format=='standard' and 'Standard' or 'Expanded',key='format',count=2,index=self.format=='standard' and 1 or 2}end
    local first=self.filterPage==1 and 1 or 7;local last=self.filterPage==1 and 6 or 10
    for i=first,last do if self.options[i]then inputs[#inputs+1]=self.options[i]end end
    -- Portrait has no room for Sort beside Filters, so the Cards tab cycles it in its free last slot.
    if self.filterPage==1 and p then
      local sort=self.fields.sort or 'name';local index=1
      for i,key in ipairs(SORT_ORDER)do if key==sort then index=i end end
      inputs[#inputs+1]={label='Sort',value=SORT_LABELS[sort] or sort,key='sort',count=#SORT_ORDER,index=index}
    end
    local columnGap=p and 12 or 24
    local columnWidth=(bw-columnGap)/2
    local cycleWidth=math.min(264,columnWidth)
    for i,o in ipairs(inputs)do
      local cx=x+((i-1)%2)*(columnWidth+columnGap)+(columnWidth-cycleWidth)/2
      local cy=m.y+124+math.floor((i-1)/2)*90
      self:filterCycle(o.label,o.value,o.key,cy,o.count,o.index,o.selected,cx,cycleWidth)
    end
  else
    local fw=math.min(360,bw);local fx=m.x+(m.w-fw)/2
    self:field('text','Rules text',fx,m.y+164,fw,44,'Search abilities and attacks')
    self:add('Minimum HP',self.width/2-148,m.y+270,240,40,'hp-slider',T.red,'hpMin')
    self:add('Maximum HP',self.width/2-148,m.y+376,240,40,'hp-slider',T.red,'hpMax')
  end
  self:add('Reset filters',x,m.y+m.h-106,bw,34,'reset',T.profile)
end
-- The Text tab's field and slider titles.
function Builder:drawFilters(m,bw)
  if self.filterPage==3 then
    local fw=math.min(360,bw);local fx=m.x+(m.w-fw)/2
    for i,label in ipairs({'Rules text','Minimum HP','Maximum HP'})do T.text(label,24,fx,m.y+130+(i-1)*106,fw)end
  end
end
-- Ten-HP steps; the minimum's left endpoint and maximum's right endpoint
-- restore the unbounded filter (Any), including cards with no HP field.
function Builder:hpValue(key)
  return tonumber(self.fields[key]) or (key=='hpMin' and 0 or 400)
end
function Builder:setHP(key,value)
  value=math.max(0,math.min(400,math.floor(value/10+0.5)*10))
  if key=='hpMin' and tonumber(self.fields.hpMax)then value=math.min(value,tonumber(self.fields.hpMax))end
  if key=='hpMax' and tonumber(self.fields.hpMin)then value=math.max(value,tonumber(self.fields.hpMin))end
  local text=(key=='hpMin' and value==0 or key=='hpMax' and value==400) and '' or tostring(value)
  if text~=(self.fields[key] or '')then self.fields[key]=text;self:command('filter',key,text)end
end
function Builder:slideHP(control,x)
  self:setHP(control.arg,400*(x-control.x)/control.w)
end
return Filters
