package.path='frontend/lua/?.lua;'..package.path
local loaded,filter
local texture={setFilter=function(_,min,mag)filter={min,mag}end}
love={graphics=setmetatable({newImage=function(path)loaded=path;return texture end},{
  __index=function(_,name)error('Logo startup must not require GPU baking: '..name)end,
})}
assert(require('ui.menu_logo').new()==texture)
assert(loaded=='assets/branding/colorless-menu.png','Load the finished, bundled sprite')
assert(filter[1]=='linear' and filter[2]=='linear','Retain the restored appearance')
print('PASS: startup loads the finished sprite without shaders, canvases or GPU readback')
