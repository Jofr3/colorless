package.path='frontend/lua/?.lua;'..package.path
local files={['__a.txt']='hello'}
love={filesystem={getInfo=function(name) return files[name] and {} or nil end,read=function(name) return files[name],#files[name] end}}
local Mailbox=require('ui.mailbox')
assert(Mailbox.read('__a.txt')=='hello' and select('#',Mailbox.read('__a.txt'))==1)
assert(Mailbox.read('__missing.txt')==nil)
local raw='7\nsv1-1\t%2Fart%2Fa.png\nsv1-2\t%2Fart%2Fb.png\nbad\nsv1-1\t%2Fart%2Fc.png'
local rows=Mailbox.artRows(raw)
assert(#rows==3 and rows[1].id=='sv1-1' and rows[1].path=='/art/a.png')
local art=Mailbox.artMap(raw)
assert(art['sv1-1']=='/art/c.png' and art['sv1-2']=='/art/b.png' and art['7']==nil)
assert(#Mailbox.artRows(nil)==0)
print('mailbox ok')
