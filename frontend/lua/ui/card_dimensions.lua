-- Match the 600×825 (8:11) Pokémon scans supplied by the card art service.
-- The scan fills the whole card: no rim and no transparent outer margin.
local D={ART_W=136,ART_H=187,INSET=0}
D.W,D.H=D.ART_W+2*D.INSET,D.ART_H+2*D.INSET
D.HALF_W,D.HALF_H=D.W/2,D.H/2
-- Settings' Card Quality, by preference value: the raster of a face that draws a scan, as a
-- multiple of W×H, and its filter. Performance is 272×374. Quality matches the screen
-- (Card.setQuality), and gives a zoomed card (item.scan=='full') the scan's own 600×825.
D.QUALITIES={{resolution=2,filter='nearest'},{filter='linear',full=600/D.W}}
-- Quality's raster, in layout pixels per face pixel: the builder's grid card with its hover
-- lift, the largest card on any page but a zoomed one.
D.SCREEN_SCALE=1.1
-- Keep Balatro's horizontal motion units, with our actual card height.
D.TILE_W=2.4*35/41
D.TILE_H=D.TILE_W*D.H/D.W
return D
