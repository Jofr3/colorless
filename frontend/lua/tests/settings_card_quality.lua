-- Settings' Graphics tab ends with a Card Quality cycle (Performance / Quality) under Max Frame
-- Rate, clear of Back; keyboard and pointer reach it, it shows and says its value, and its value
-- picks the scan raster card faces are built at (card.lua Card.quality).
package.path='frontend/lua/?.lua;frontend/lua/tests/?.lua;'..package.path
local Stub=require('support.draw_stub').install()
local T=require('ui.theme')
local texts={}
T.text=function(text) texts[#texts+1]=tostring(text) end
local D=require('ui.card_dimensions')
local Card=require('ui.card')
local Preferences=require('ui.preferences')
local Settings=require('ui.settings')
local function check(ok,message) if not ok then error(message,2) end end
local p=Preferences.new()
check(p.cardQuality==0,'Performance is the default')
local changes,announcements=0,{}
local popup=Settings.new(p,{
  changed=function() changes=changes+1 end,close=function() end,
  announce=function(text) announcements[#announcements+1]=text end,
  feedback=function() end,reduced=function() return false end,
},false,true)
local function byLabel(label)
  for i,item in ipairs(popup.items) do if item.label==label then return item,i end end
end
local function drawn(text)
  texts={};popup:draw()
  for _,t in ipairs(texts) do if t==text then return true end end
  return false
end
for _,size in ipairs({{1280,800},{480,850}}) do
  popup:layout(size[1],size[2])
  popup.tab=Settings.tabs.graphics;popup:build()
  local rate,back=byLabel('Max Frame Rate'),byLabel('Back')
  local quality,index=byLabel('Card Quality')
  check(quality and quality.kind=='cycle' and quality.key=='cardQuality','Graphics has a Card Quality cycle')
  check(quality.w==rate.w and quality.h==rate.h and quality.x==rate.x,'It is a cycle the size of Max Frame Rate, in its column')
  check(quality.y==rate.y+91,'It takes the next row under Max Frame Rate')
  check(quality.y-32>rate.y+rate.h+6 and quality.y+quality.h+6<back.y,'It fits between Max Frame Rate and Back')
  check(index==#popup.items-1,'Tab reaches it after Max Frame Rate and before Back')
end
-- Audio keeps its four rows where they were.
popup.tab=Settings.tabs.audio;popup:build()
check(byLabel('Master Volume').y==popup.y+134 and byLabel('Mute').y==popup.y+134+3*91,'Audio keeps its rows')
popup:layout(1280,800);popup.tab=Settings.tabs.graphics;popup:build()
check(drawn('Card Quality') and drawn('Performance') and not drawn('Quality'),'It shows Performance by default')
local quality,index=byLabel('Card Quality')
popup.focus=index
popup:keypressed('right')
check(p.cardQuality==1 and changes==1,'Right picks Quality and saves')
check(announcements[#announcements]=='Card Quality: Quality','It says its new value')
check(drawn('Quality') and not drawn('Performance'),'It shows Quality')
popup:keypressed('left')
check(p.cardQuality==0,'Left goes back to Performance')
check(popup:describe(quality)=='Card Quality: Performance','It describes its value')
popup:update(1/60,20,-1000,-1000,true)
popup:mousepressed(quality.x+quality.w-10,quality.y+15);popup:mousereleased(quality.x+quality.w-10,quality.y+15)
check(p.cardQuality==1,'Its arrow toggles it')
print('PASS: Settings Graphics adds Card Quality under Max Frame Rate, clear of Back')

-- The raster: Performance builds a scan face at 272×374 with nearest filtering. Quality matches
-- the screen, with linear filtering, and a zoomed card (scan 'full') the scan's own 600×825; a
-- face that draws no scan stays at 136×187.
check(Card.quality==D.QUALITIES[1],'Cards start at Performance')
check(select(1,Card.scanSize())==272 and select(2,Card.scanSize())==374,'Performance is 272×374')
local scan=Card.new({scan=true,edition='dissolve',drawFace=function() end},1)
local zoomed=Card.new({scan='full',edition='dissolve',drawFace=function() end},1)
local plain=Card.new({edition='dissolve',drawFace=function() end},1)
local function size(c) local w,h,filter=c:raster() return w..'x'..h..' '..filter end
check(size(scan)=='272x374 nearest' and scan.resolution==2,'A Performance scan face')
check(size(zoomed)=='272x374 nearest','Performance zooms the same raster')
check(size(plain)=='136x187 nearest' and plain.resolution==1,'A face without a scan')
-- 2880x1800 lays out at 2.25 device pixels per layout pixel: 2.25 x 1.1, up to a quarter step.
Card.setQuality(D.QUALITIES[2],2.25)
check(size(scan)=='340x468 linear' and size(plain)=='136x187 nearest','Quality changes only scan faces, to the screen')
check(size(zoomed)=='600x825 linear','A zoomed card takes the full scan')
Card.setQuality(D.QUALITIES[2],2.2)
check(size(scan)=='340x468 linear','A slightly smaller window keeps the same quarter step')
Card.setQuality(D.QUALITIES[2],1)
check(size(scan)=='272x374 linear','A small screen never goes below Performance')
Card.setQuality(D.QUALITIES[2],8)
check(size(scan)=='600x825 linear','A large one never goes above the scan')
Card.setQuality(D.QUALITIES[1],2.25)
check(size(scan)=='272x374 nearest','Performance ignores the screen')
Card.setQuality(D.QUALITIES[2],2.25)
check(scan.resolution==2,'A built canvas keeps the resolution it was built at')
scan:rebuild()
check(scan.resolution==2.5,'A rebuild takes the new one')
local adopted=Card.new({scan=true},1,nil,scan)
check(adopted.texture==scan.texture and adopted.resolution==scan.resolution,'An adopted canvas keeps its resolution')
print('PASS: Card Quality picks the scan raster; built canvases keep theirs until rebuilt')

-- A zoomed card draws `<id>@full` once host.js stages it, and asks for it only under Quality.
local art={a='a.png',['a@full']='a-full.png',b='b.png'}
check(Card.scanPath(art,{scan='full'},'a')=='a-full.png','A zoomed card draws its full scan')
check(Card.scanPath(art,{scan='full'},'b')=='b.png','Until it arrives, its ordinary one')
check(Card.scanPath(art,{scan=true},'a')=='a.png','Other cards draw the ordinary scan')
local printed={}
local print0=print;print=function(line) printed[#printed+1]=line end
Card.wantFull('a');Card.wantFull('hidden');Card.wantFull('')
Card.setQuality(D.QUALITIES[1],2.25)
Card.wantFull('a')
check(Card.scanPath(art,{scan='full'},'a')=='a.png','Performance draws the ordinary scan')
print=print0
check(#printed==1 and printed[1]=='COLORLESS:art-full:a','Quality asks for a known card\'s full scan, Performance never')
Card.quality=D.QUALITIES[1]
print('PASS: a zoomed card asks for and draws the full scan under Quality only')
