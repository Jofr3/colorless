package.path='frontend/lua/?.lua;'..package.path
local files={['__library.txt']='hello'}
local reads={}
love={filesystem={getInfo=function(name) return files[name] and {} or nil end,read=function(name) reads[name]=(reads[name] or 0)+1;return files[name],#files[name] end}}
local Mailbox=require('ui.mailbox')
assert(Mailbox.read('library')=='hello' and select('#',Mailbox.read('library'))==1)
assert(Mailbox.read('online')==nil)
assert(not pcall(Mailbox.read,'__library.txt'),'A file name is not a mailbox name')
local raw='7\nsv1-1\t%2Fart%2Fa.png\nsv1-2\t%2Fart%2Fb.png\nbad\nsv1-1\t%2Fart%2Fc.png'
local rows=Mailbox.artRows(raw)
assert(#rows==3 and rows[1].id=='sv1-1' and rows[1].path=='/art/a.png')
local art=Mailbox.artMap(raw)
assert(art['sv1-1']=='/art/c.png' and art['sv1-2']=='/art/b.png' and art['7']==nil)
assert(#Mailbox.artRows(nil)==0)
-- Once the host keeps a revision list, a mailbox is read again only when its revision moves.
files['__mailbox_revisions.txt']='__library.txt\t3\n__page.txt\t4'
files['__page.txt']='1\thome\t'
Mailbox.poll()
reads={}
for _=1,3 do assert(Mailbox.read('library')=='hello' and Mailbox.read('page')=='1\thome\t') end
assert(reads['__library.txt']==1 and reads['__page.txt']==1,'Unchanged mailboxes are read once')
files['__online.txt']='unlisted'
assert(Mailbox.read('online')==nil,'A mailbox missing from the list has not been written')
files['__library.txt']='changed';Mailbox.poll()
assert(Mailbox.read('library')=='hello','A write is seen once the list moves')
files['__mailbox_revisions.txt']='__library.txt\t5\n__page.txt\t4';Mailbox.poll()
assert(Mailbox.read('library')=='changed' and Mailbox.read('page')=='1\thome\t')
assert(reads['__library.txt']==2 and reads['__page.txt']==1)
files['__mailbox_revisions.txt']=nil;Mailbox.poll()
assert(Mailbox.read('online')=='unlisted','Without a list every read goes to the file')
print('mailbox ok')
