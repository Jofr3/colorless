-- The shared deck picker's search: case folded as the deck library folds it, accents included.
package.path='frontend/lua/?.lua;'..package.path
love={graphics={}}
local DeckPicker=require('ui.deck_picker')
local function names(decks,query,keep)
  local out={}
  for i,d in ipairs(DeckPicker.matches(decks,query,keep)) do out[i]=d.name end
  return table.concat(out,',')
end
local decks={{name='POKÉMON Box'},{name='Éclair'},{name='Łódź Ŷ'},{name='Plain'},{name='ŸES'}}
assert(names(decks,'pokémon')=='POKÉMON Box','A small é finds a capital É')
assert(names(decks,'  ÉCL ')=='Éclair','The query is trimmed and folded too')
assert(names(decks,'éclair')=='Éclair')
assert(names({{name='Árbol\t%'}},'ÁRBOL')=='Árbol\t%','The search library.test.ts makes finds the same deck here')
assert(names(decks,'łódź ŷ')=='Łódź Ŷ','Latin Extended-A capitals fold')
assert(names(decks,'ÿes')=='ŸES','Ÿ folds to ÿ')
assert(names(decks,'')=='POKÉMON Box,Éclair,Łódź Ŷ,Plain,ŸES')
assert(names(decks,'%a')=='','The query is taken literally')
assert(names(decks,'box',function(d) return d.name~='POKÉMON Box' end)=='','keep still filters')
assert(DeckPicker.fold('ÀÞ×ß İ')=='àþ×ß İ','The multiplication sign, ß and İ stay as they are')
print('PASS: deck picker search folds case like the deck library, accents included')
