-- Compare the option cycle's pop/bump motion to Balatro's DynaText itself.
package.path='frontend/lua/?.lua;'..package.path
love={graphics={}}
local Text=require('ui.page_text')
Moveable={extend=function() return {} end}
dofile((os.getenv('BALATRO_SOURCE') or '../balatro-source')..'/engine/text.lua')
local checks=0
local function near(a,b) assert(math.abs(a-b)<1e-9,tostring(a)..' != '..tostring(b)); checks=checks+1 end
for _,fps in ipairs({30,60,144}) do
  for _,value in ipairs({'Page 1/10','Page 10/10','Page 2/3'}) do
    local ref={config={pop_in=0,float=true,bump=true},created_time=4,scale=0.5,bump_amount=1,bump_rate=2.666,
      font={FONTSCALE=0.1},pop_in_rate=8,silent=true,focused_string=1,strings={{string=value,letters={}}}}
    for i=1,#value do ref.strings[1].letters[i]={pop_in=0,offset={x=0,y=0}} end
    for frame=0,fps*3 do
      local time=4+frame/fps
      G={TIMERS={REAL=time},SETTINGS={reduced_motion=false},TILESIZE=20}
      DynaText.align_letters(ref)
      for i,letter in ipairs(ref.strings[1].letters) do
        local pop,offset=Text.letter(time,4,i,#value,false)
        near(pop,letter.pop_in); near(offset,letter.offset.y)
      end
    end
  end
end
local label=Text.new(); label:set('Page 1/2',10); label:set('Page 1/2',11)
assert(label.created==10,'Unchanged state must not restart text animation')
label:set('Page 2/2',12); assert(label.created==12)
local pop,offset=Text.letter(12,12,1,8,true); assert(pop==1 and offset==0)
print('PASS: '..checks..' original DynaText pop/bump comparisons, page-change reset and reduced motion')
