-- The online opponent's presence (audit SM14), mixed into ui/simulator.lua's Simulator.
local T=require('ui.theme')
local Dyna=require('ui.dynatext')
local Simulator={}
-- boss_warning_text: two floating DynaTexts over the table while the opponent
-- is disconnected. The forfeit clock counts down from receipt, so presence
-- never needs per-second snapshots (each would invalidate click tokens).
function Simulator.clock(seconds)
  seconds=math.max(0,math.ceil(seconds))
  return string.format('%d:%02d',math.floor(seconds/60),seconds%60)
end
function Simulator:awayDetail()
  local a=self.away
  if not a.deadline then return 'Waiting for them to reconnect...' end
  local left=a.deadline-self.time
  return left>0 and 'Forfeits in '..Simulator.clock(left) or 'Forfeiting...'
end
function Simulator:syncAway(row)
  local a=self.away
  if row.name=='' or self.outcome~='' then
    if a and not a.leaving then
      a.leaving=true;a.title:pop_out(3,self.time);a.detail:pop_out(3,self.time)
      if self.outcome=='' then
        self.fx:attention({text=a.name..' is back',scale=0.6,colour=T.white,backdrop=T.blue,x=self.L and self.L.banner.x or 0,y=self.L and self.L.banner.y or 0,hold=0.9,sound='highlight1'})
        self.callbacks.announce(a.name..' is back')
      end
    end
    return
  end
  local ms=tonumber(row.ms)
  local deadline=ms and ms>=0 and self.time+ms/1000 or nil
  if a and not a.leaving then
    if a.name~=row.name then a.name=row.name;a.title:set(row.name..' disconnected',self.time) end
    a.deadline=deadline;a.detail:set(self:awayDetail(),self.time)
    return
  end
  local function text(s,scale) return Dyna.new({string=s,scale=scale,colours={T.white},float=true,shadow=true,pop_in=0,pop_in_rate=6,time=self.time,maxw=self.L and self.L.table.w-40}) end
  a={name=row.name,deadline=deadline};self.away=a
  a.title=text(row.name..' disconnected',0.7);a.detail=text(self:awayDetail(),0.6)
  -- Later ticks swap the clock's letters in place instead of popping it again.
  a.detail.cfg.pop_in=nil
  local feedback=self.callbacks.sourceFeedback or self.callbacks.feedback
  feedback('chips1',0.55+love.math.random()*0.1,0.12)
  self.callbacks.announce(a.name..' disconnected. '..a.detail.string)
end
return Simulator
