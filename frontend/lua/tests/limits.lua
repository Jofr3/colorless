-- The generated limits keep the values the UI used before they were shared.
package.path='frontend/lua/?.lua;'..package.path
love={graphics={}}
local Limits=require('ui.limits')
assert(Limits.deckSize==60 and Limits.defaultFormat=='standard')
for _,format in ipairs({'standard','expanded','unknown'}) do assert(Limits.deckSizeFor(format)==60) end
assert(Limits.deckSizeFor(nil)==60 and tostring(Limits.deckSizeFor('standard'))=='60')
local Pile=require('ui.deck_pile')
assert(Pile.DECK_HEIGHT==0.15*52/60)
