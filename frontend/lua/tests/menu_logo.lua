package.path='frontend/lua/?.lua;'..package.path
local loaded,draws={},{}
love={graphics=setmetatable({
  newImage=function(path)
    local star=path:find('energy%-star')~=nil
    local texture={path=path,getDimensions=function()if star then return 192,192 else return 836,322 end end,
      setFilter=function(_,min,mag)assert(min=='linear' and mag=='linear')end}
    loaded[#loaded+1]=path
    return texture
  end,
  draw=function(...)draws[#draws+1]={...}end,
},{__index=function(_,name)error('Logo must not require GPU baking: '..name)end})}
local logo=require('ui.menu_logo').new()
local layout=require('ui.menu_logo_layout')
assert(loaded[1]=='assets/branding/colorless-menu-base.png')
assert(loaded[2]=='assets/branding/colorless-energy-star.png')
local w,h=logo:getDimensions();assert(w==836 and h==322)
local function draw()
  draws={};logo:draw(.5)
  assert(#draws==2)
  assert(draws[1][1]==logo.base and draws[1][4]==0,'The disc and lettering never rotate locally')
  assert(draws[2][1]==logo.star)
  assert(draws[2][2]==(layout.starX-w/2)*.5 and draws[2][3]==(layout.starY-h/2)*.5,'Anchor the star at the disc center')
  assert(draws[2][7]==96 and draws[2][8]==96,'Rotate about the star center')
  return draws[2][4]
end
local function near(a,b)assert(math.abs(a-b)<1e-9)end
near(draw(),0)
logo:update(15,false);near(draw(),math.pi/2)
logo:update(20,true);near(draw(),math.pi/2)
logo:update(45,false);near(draw(),0)
for _=1,120 do logo:update(.125,false) end
near(draw(),math.pi/2)
print('PASS: authored layers, fixed disc/anchor, 60-second rotation and reduced-motion pause without GPU baking')
