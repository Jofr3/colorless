-- Match the 600×825 (8:11) Pokémon scans supplied by the card art service.
-- One visible rim pixel on every side, with no transparent outer margin.
local D={ART_W=136,ART_H=187,INSET=1}
D.W,D.H=D.ART_W+2*D.INSET,D.ART_H+2*D.INSET
D.HALF_W,D.HALF_H=D.W/2,D.H/2
-- Keep Balatro's horizontal motion units, with our actual card height.
D.TILE_W=2.4*35/41
D.TILE_H=D.TILE_W*D.H/D.W
return D
