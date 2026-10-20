-- Balatro Card:start_dissolve (card.lua:2130), engine/particles.lua and
-- globals.lua's default burn palette. The unmodified dissolve.fs is bundled
-- by build.mjs; this supplies its animation, juice and attached square embers.
local Dissolve={};Dissolve.__index=Dissolve
local g=love.graphics
local palette={
  {55/255,66/255,68/255,1}, -- BLACK
  {253/255,162/255,0,1}, -- ORANGE
  {254/255,95/255,85/255,1}, -- RED
  {234/255,192/255,88/255,1}, -- GOLD
  {191/255,199/255,213/255,1}, -- JOKER_GREY
}
Dissolve.duration=0.7
Dissolve.removeAfter=1.05*Dissolve.duration
function Dissolve.new(card,time)
  card.dissolve=0;card.burn1=palette[1];card.burn2=palette[2]
  card:juiceUp(time)
  return setmetatable({start=time,lastEmission=-0.007,particles={},alpha=1},Dissolve)
end
function Dissolve:update(card,dt,time)
  local age=math.max(0,time-self.start)
  card.dissolve=math.min(1,age/Dissolve.duration)
  self.alpha=1-math.min(1,math.max(0,(age-0.49)/0.21))
  local added=0
  while self.alpha>0 and age>self.lastEmission+0.007 and added<20 do
    self.lastEmission=self.lastEmission+0.007;added=added+1
    local x=(0.5-love.math.random())*142*card.baseScale/card.unit
    local y=(0.5-love.math.random())*190*card.baseScale/card.unit
    local r=card.motion.T.r
    if math.abs(r)<0.1 then x,y=math.sin(r)*y+math.cos(r)*x,math.sin(r)*x+math.cos(r)*y end
    self.particles[#self.particles+1]={
      x=x,y=y,dir=love.math.random()*2*math.pi,facing=love.math.random()*2*math.pi,
      age=0,velocity=2*love.math.random()*0.7,rvel=0.2*(0.5-love.math.random()),
      colour=palette[math.floor(love.math.random()*#palette)+1],scale=0,
    }
  end
  for i=#self.particles,1,-1 do
    local p=self.particles[i]
    p.age=p.age+dt
    -- Particles:move assigns this triangular envelope after its velocity ease.
    p.scale=math.min(2*math.min(p.age/0.49*0.1,0.1*(0.49-p.age)/0.49),0.1)
    if p.scale<0 then table.remove(self.particles,i)
    else
      p.x=p.x+p.velocity*math.sin(p.dir)*dt;p.y=p.y+p.velocity*math.cos(p.dir)*dt
      p.facing=p.facing+p.rvel*dt;p.velocity=math.max(0,p.velocity-p.velocity*0.07*dt)
    end
  end
  return age>=Dissolve.removeAfter
end
function Dissolve:draw(card)
  g.setShader()
  g.push();g.translate(card.x,card.y);g.rotate(card.angle);g.scale(card.unit*card.motion.VT.scale)
  for _,p in ipairs(self.particles) do
    local c=p.colour
    g.setColor(c[1],c[2],c[3],c[4]*self.alpha)
    g.push();g.translate(p.x,p.y);g.rotate(p.facing)
    g.rectangle('fill',-p.scale/2,-p.scale/2,p.scale,p.scale);g.pop()
  end
  g.pop()
end
return Dissolve
