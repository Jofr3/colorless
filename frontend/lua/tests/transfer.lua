package.path='frontend/lua/?.lua;'..package.path
local mailbox={}
love={math={random=function()return 0.5 end},filesystem={getInfo=function(p)return mailbox[p]~=nil end,read=function(p)return mailbox[p]end},
 graphics={newFont=function(_,size)return {getWidth=function(_,s)return #s*size/2 end,setFilter=function()end}end},keyboard={isDown=function()return false end}}
local Card=require('ui.card');Card.rebuild=function(self)self.texture={release=function()end}end
local Builder=require('ui.builder');local Codec=require('ui.codec')
local commands={};local b=Builder.new({command=function(raw)commands[#commands+1]=Codec.fields(raw)end,feedback=function()end,announce=function()end})
local function encode(fields)local out={};for i,v in ipairs(fields)do out[i]=Codec.encode(tostring(v))end;return table.concat(out,'\t')end
local rev=0
local function sync(text,importing)
 rev=rev+1
 b:sync(encode({rev,'ready','Test','standard','','',0,1,1,0,2,'','',text,'',importing and 1 or 0,0}))
end
local function control(action)
 for i,c in ipairs(b.controls)do if c.action==action then return c,i end end
 error('Missing '..action)
end
local function activate(action)local _,i=control(action);b:activate(i)end
local baseline='Pokemon: 2\n2 Pikachu SV1 1\n\nTotal Cards: 2'
for _,size in ipairs({{1280,800},{480,850}})do
 b.modal=nil;b.tab='deck';b:layout(size[1],size[2]);sync('',false)
 activate('transfer')
 assert(commands[#commands][1]=='export' and b.modal.mode=='transfer')
 assert(#b.controls==4,'Only the field, Copy, Confirm and Back remain')
 assert(control('import').disabled and control('copy').disabled,'Wait for the current decklist')
 sync(baseline,false)
 assert(b.transfer==baseline and control('import').disabled and not control('copy').disabled)
 local field=control('input');local copy=control('copy')
 assert(copy.x>=field.x and copy.x+copy.w<=field.x+field.w and copy.y>=field.y and copy.y+copy.h<field.y+52)
 for _,c in ipairs(b.controls)do assert(c.x>=b.modal.x and c.x+c.w<=b.modal.x+b.modal.w and c.y+c.h<=b.modal.y+b.modal.h)end
 activate('copy');assert(commands[#commands][1]=='copy' and commands[#commands][2]==baseline)
 for _,value in ipairs({'','  \n  ',baseline,baseline..'\n','1 Abra'})do
  rev=rev+1;mailbox['__builder_input.txt']=encode({rev,'transfer',value,0,0,'input'})
  b:update(1/60,rev,0,0,true)
  assert(control('import').disabled==(value~='1 Abra'),'Confirm is enabled only for nonempty modifications')
 end
 -- Background snapshots must not replace the draft.
 sync(baseline,false);assert(b.transfer=='1 Abra' and not control('import').disabled)
 activate('copy');assert(commands[#commands][2]=='1 Abra','Copy uses the edited text')
 activate('import');assert(commands[#commands][1]=='import' and commands[#commands][2]=='1 Abra')
 assert(control('import').disabled,'Prevent repeat confirmation while resolving')
 sync('1 Abra',false);assert(control('import').disabled,'Successful confirmation resets the comparison text')
 activate('close');assert(not b.modal)
 activate('transfer');sync('',false)
 assert(b.transfer=='' and control('import').disabled and control('copy').disabled,'Empty decks have a blank field')
end
print('PASS: single decklist modal, fresh prefill, draft preservation, changed/nonempty confirmation, clipboard contents and responsive bounds')
