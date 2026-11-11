package.path='frontend/lua/?.lua;'..package.path
local Account=require('ui.account')
local Codec=require('ui.codec')
local a=Account.new()
assert(Codec.utf16Prefix('Zoë😀x',5)=='Zoë😀')
assert(Codec.utf16Prefix('Zoë😀x',4)=='Zoë')
local function snapshot(fields)
  local result={}; for _,v in ipairs(fields) do result[#result+1]=Codec.encode(v) end
  return table.concat(result,'\t')
end
local raw=snapshot({1,'authenticated',0,'','user-1','Zoë','zoe@example.com'})
assert(a:sync(raw) and not a:sync(raw))
assert(a.draftName=='Zoë' and not a:canSave())
a.draftName=' A\tB% '; assert(Codec.fields(a:command('save'))[2]==a.draftName)
a:input(snapshot({1,'name','Ashley',6,6,'input'})); assert(a.editing and a.draftName=='Ashley')
a:input(snapshot({2,'name','Ash',3,3,'done'})); assert(not a.editing and a.draftName=='Ash')
assert(not a:input(snapshot({2,'name','Ash',3,3,'done'})),'A repeated record changes nothing')
assert(not a:input(snapshot({3,'name','Misty',5,5})) and a.draftName=='Ash','A record missing its action is ignored')
a:sync(snapshot({2,'authenticated',1,'Saving...','user-1','Zoë','zoe@example.com'}))
assert(a.draftName=='Ash' and not a:canSave())
a:sync(snapshot({3,'authenticated',0,'Saved.','user-1','Ash','zoe@example.com'}))
assert(not a:canSave())
a:update(2); assert(a.message=='Saved.')
a:update(1.1); assert(a.message=='')
a:sync(snapshot({4,'authenticated',0,'Could not save. Try again.','user-1','Ash','zoe@example.com'}))
a:update(10); assert(a.message=='Could not save. Try again.')
a:sync(snapshot({5,'anonymous',0,'','','',''}))
assert(a.draftName=='' and not a.editing)
assert(a:sync(snapshot({6,'authenticated',0,'','user-1','Ash','zoe@example.com',1})) and a.hasPassword)
assert(a:sync(snapshot({7,'authenticated',0,'','user-2','Brock','brock@example.com',0})) and not a.hasPassword)
print('PASS: account mailbox, unicode, draft preservation, edit, saved-message timeout, session reset and password flag')
-- A failed sign-in: the refused fields are marked anew on each failure, and its message is
-- to be said again even when it repeats the last one.
do
  local b=Account.new()
  local function failed(revision,message,invalid,failures)
    return b:sync(snapshot({revision,'anonymous',0,message,'','','',0,0,invalid,failures}))
  end
  assert(failed(1,'',' ',0) and not b.refused and not b.fresh and next(b.invalid)==nil)
  assert(failed(2,'Enter a valid email address. Enter your password.','email password',1))
  assert(b.refused and b.fresh and b.invalid.email and b.invalid.password and not b.invalid.name)
  b:clearInvalid('email'); assert(not b.invalid.email and b.invalid.password)
  -- A snapshot that is no new failure leaves the marks the user cleared.
  assert(failed(3,'Enter a valid email address. Enter your password.','email password',1))
  assert(not b.refused and not b.fresh and not b.invalid.email and b.invalid.password)
  -- The same failure again marks both again and is said again.
  assert(failed(4,'Enter a valid email address. Enter your password.','email password',2))
  assert(b.refused and b.fresh and b.invalid.email)
  -- A server failure marks no field; a cleared message clears the marks.
  assert(failed(5,'Wrong email or password.','',3) and b.refused and b.fresh and next(b.invalid)==nil)
  assert(failed(6,'Enter your password.','password',4) and b.invalid.password)
  assert(failed(7,'','',4) and not b.fresh and next(b.invalid)==nil)
  -- A new message that is no failure is said once, as before.
  assert(failed(8,'Signed out on every device.','',4) and b.fresh and not b.refused)
  assert(failed(9,'Signed out on every device.','',4) and not b.fresh)
  -- An older host without the fields marks nothing.
  assert(b:sync(snapshot({10,'anonymous',0,'Enter your password.','','',''})) and not b.refused and next(b.invalid)==nil)
end
print('PASS: failed submits mark their fields anew and are said again')
assert(Codec.join('a b',1,'é')=='a%20b\t1\t%C3%A9')
local rows=Codec.rows('a\tb\n\nc%0A')
assert(#rows==2 and rows[1][2]=='b' and rows[2][1]=='c\n')
local list=Codec.list(' x, ,y ')
assert(#list==2 and list[1]=='x' and list[2]=='y')
