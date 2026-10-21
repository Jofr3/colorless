# COLORLESS menu wordmark

`colorless-menu.png` is the cleaned 1024 × 380 straight-alpha RGBA sprite.
`ui/menu_logo.lua` loads it directly with linear filtering. There is
no startup mask processing, shader baking, Canvas readback or format conversion.
This removes the graphics-dependent path that could leave the menu logo blank.
CRT scanlines and fringing are applied live by the game.

`colorless.png` is the 2057 × 764 approved lighter lettering from imagegen pass 3,
retained as the authoring source. `tools/logo_bake.lua` extracts its ivory and
pastel faces and renders the earlier measured source edge. Cleanup now removes
detached mask fragments, fills small extraction holes and trims hairline spurs
before beveling. Two local contour repairs remove a coral protrusion below the
C and the notch inside its upper curve. Resolution, palette, filtering and
bevel dimensions remain those of the restored version. The superseded palette
reduction and coarse-grid revision is retained locally in
`tmp/colorless-iterations/07-pixel-cleanup*`. The authoring renderer explicitly
converts GPU readback (which can be rgba4) into straight-alpha rgba8 before PNG
export, and refuses an empty result.

To rebuild the finished asset, run `node frontend/lua/tools/build-logo.mjs`,
serve the printed directory with a local HTTP server, then open its page in a
WebGL browser. Download the finished logo into this directory as
`colorless-menu.png`, inspect it, and run `bun run build:lua`.

The original main-menu screenshot and local
`balatro-source/resources/textures/2x/balatro.png` supplied the lettering reference.
`Game:main_menu` in `balatro-source/game.lua` draws `SPLASH_LOGO` as a sprite with
a separate center card. This custom wordmark contains letters only.

## Refinement

1. Reduced the original draft's oversized extrusion.
2. Rebuilt from the source sprite to recover hooked Ls, tapered R, rounded Os,
   uneven letter heights, and irregular reflections.
3. Tried a narrower beige bevel and dark outline with flatter faces and thinner
   colored streaks. In-game comparison showed that this lost too much depth.

4. Made the ivory strokes bolder, joined neighboring dark borders at selected
   shoulders and feet, and rebuilt the extrusion with flat grey/charcoal steps.
5. Reduced the new border's bulk while preserving the connections and bolder
   faces. The user found pass 6 too heavy and its border still unlike the source.
6. Returned to pass 3's face weight and replaced the border in the renderer.
   Additional imagegen border and face-only trials were rejected for halo/alpha
   artifacts. The renderer uses the clean approved asset and exact source
   palette, retaining its pastel reflections.
7. Cleaned the face mask before beveling, deepened the border, and reduced the
   bake resolution to make the edges closer to the source's logical pixel grid.
8. Moved the entire bake to authoring tools and bundled its validated PNG to
   prevent missing logos caused by runtime GPU/readback differences.
9. Undid the last visual revision: restored the earlier 1024-pixel rendering,
   original pastel colors, thinner border and linear filtering. Kept the
   direct-PNG loading fix so the restored logo remains visible.
10. Made three focused artifact-cleanup passes at the user's marked locations:
    remove detached fragments and pinholes; trim attached one-pixel spurs;
    repair the two larger C contour defects. Compared enlarged before/after
    crops and checked the exported sprite in the CRT menu. Local previews are
    `tmp/colorless-iterations/cleanup-pass{1,2,3}.png`; the pre-cleanup asset and
    baker are saved as `08-before-artifact-cleanup*` in the same directory.
11. Repaired the additional marked contour defects on the C shoulder and inner
    curve, both L tips, R inner leg and both S waists. Local control points follow
    intact edge segments; nearby clean face colours replace muddy reflection
    fragments at these joins. The bevel palette and dimensions are unchanged.
    Compared every marked region at 3× magnification in two passes. The prior
    sprite/baker are saved as `09-before-detail-cleanup*`, and the comparison is
    `tmp/colorless-iterations/detail-compare-pass2.png`. The authoring page also
    exposes `window.facePng` for inspecting the face before the bevel is drawn.
12. Filled missing bevel pixels at the marked second L and E top tips. The
    eight-direction dilation left notches around their narrow faces; complete
    disk sampling in just those regions restores continuous borders. No face
    pixels or other letter regions changed. The previous sprite and baker are
    saved as `10-before-tip-repair*`; enlarged comparison: `tips-comparison.png`.
13. Sharpened both L upper tips and lower-right terminals, plus the E's upper
    and middle hooks. Small tapered face additions are applied after mask
    cleanup to preserve their intentional pointed ends; complete border
    sampling covers these terminals to avoid reintroducing notches. Original
    stroke widths, palette and bevel dimensions are retained. The prior asset
    and baker are `11-before-pointed-ends*`; comparison: `pointed-ends-comparison.png`.
14. Refined all nine letter shapes against the original sprite. The authoring
    pass in `tools/logo_shapes.lua` gives C/O shoulders and bowls subtle
    asymmetry, tapers the L/E stems, narrows the R bowl and splays its lower leg,
    and gives the two S curves distinct, slimmer waists. Face reflections move
    with each shape; the existing bevel is rebuilt afterward at the same depth.
    Two visual passes retained nine connected faces and exactly three enclosed
    counters, with no detached pixels or extraction pinholes. Previous sprite
    and baker: `12-before-shape-refinement*`; comparison: `shapes-comparison.png`.

`lua frontend/lua/tests/logo_mask.lua` checks repaired pinholes, discarded
fragments, preserved letter counters, and separation between adjacent faces.
`lua frontend/lua/tests/menu_logo.lua` guards against reintroducing GPU baking
or readback into startup.

## Measured source border

The original O at x=610 in the 2× sprite has these bottom-edge bands:

| Source rows | Color | Role |
| --- | --- | --- |
| 286–287 | `#FFFFFF` | Bright face edge |
| 288–289 | `#E6DDD3` | Light bevel lip |
| 290–295 | `#CBBBA7` | Taupe bevel |
| 296–299 | `#4F6367` | Grey sidewall |
| 300–301 | `#5B757B` | Lighter stripe within sidewall |
| 302–303 | `#435153` | Dark seam |
| 304–307 | `#313A3C` | Charcoal outer edge |

Beyond that edge, the original contains white RGB with alpha approximately
100, 59, 29, 11 and 3 in successive two-pixel bands. This is a translucent rim,
not an opaque white outline. The top of the O has only the two grey bands and
a white face highlight. The renderer reproduces this directional layering and
uses a short translucent rim. Band widths are tuned for the custom wordmark;
this is a reconstruction, not a pixel-identical copy of the original atlas.

The selected asset is checked in the CRT-rendered menu at desktop and phone
sizes (1280 × 800 and 390 × 844).

Local comparison images are retained in `tmp/colorless-iterations/` (ignored
by Git), including the previous menu logo.

## Prompts

### Pass 2: shadow weight

Use case: style-transfer. Iteration 2 of the COLORLESS game menu wordmark.
Input 1 is the existing COLORLESS edit target. Input 2 is the clean original Balatro sprite, the authoritative lettering style reference. Input 3 is the original Balatro rendered on screen, to understand the desired visual weight.
Redraw COLORLESS to match the reference LETTERS much more faithfully. Preserve exact spelling C O L O R L E S S, one line, transparent alpha, no symbols or cards.
Critical corrections: remove the huge dark block extrusion, reduce shadow depth by about 75%; use a narrow 3-step muted grey-teal bevel and thin dark outline like reference. Letters are eccentric hand-cut elongated shapes, not uniform blackletter: round rectangular O with irregular corners, a curving R bowl with a very long pointed descending leg, L with narrow near-vertical stem, a triangular top and a gently wavy broad foot. Give C, E, S that same handmade arcade lettering vocabulary. Vary letter heights and baseline subtly. Letters should have thinner and flatter OFF-WHITE faces with only a small beige edge highlight. Remove the broad cream bevel, faceted 3D lighting and repeating candy-stripe pattern. Instead match reference's very sparse thin broken cyan and dusty salmon reflections: a small cyan patch near the upper O edge, pale lavender broken bands near midheight, slender salmon streaks near the lower stems. Most faces remain flat ivory. Pixel art edges with intentional clean stair steps, small limited flat palette, not airbrushed. The original has graceful irregular strokes and a light visual weight.
Word fills a wide canvas, visible lettering width approximately 4.1 times height, modest transparent margin of 3% each edge. Keep full word uncropped. True alpha in outside and counters. Do not copy the source sprite's white exterior fringe; use only a narrow grey-teal outline. No scanlines or background: they are added live in game. No center emblem, no dollar sign, no card, no watermark.

### Pass 3: source letterforms

Edit the supplied Balatro sprite into a new wordmark. The output must read exactly COLORLESS: C O L O R L E S S, nine uppercase letters, one single line.
This is a strict matching lettering exercise, not a new interpretation of the style. Use the original sprite's L, O and R letter designs as precisely as possible, repeated as needed. The L has a slightly bowed slender stem, a pointed top leaning right, and a low broad gently curved foot ending in a little downward notch. The R has a bulging narrow upper bowl, angular diagonal counter, very tall descending tapered left stem and a sharply splayed right leg. O is the original rounded rectangle with thin-to-medium ivory strokes and a broad tall open counter. Design C by opening the right side of that O and making the terminals small; E from the L's stem with three subtle curved horizontal bars; S a slender soft squared serpent stroke, NOT a pointed Gothic S, with softly rounded top and lower bends. Closely reproduce original thin pale ivory outlines and subtle shallow grey-teal bottom-left bevel of about 2 to 4 logical pixels; no thick black drop shadow, no 3D blocks.
Original's letterforms have an uneven playful silhouette, tilted and pinched sides, variable cap heights and projecting tapered descenders. Make COLORLESS carry this uneven hand-drawn quality, NOT rigid repeated straight stems, NOT blackletter, NOT a regular font. Source L O R are the controlling designs. White-ivory faces are FLAT with subtle thin taupe inner rim. Match the reference's sparse irregular pale blue, dusty lavender and salmon broken reflections at DIFFERENT heights and angles; these are erratic thin shards, not repeating diagonal stripes. Most face area ivory. Low resolution pixel art sprite with well-defined little staircase edges and small flat palette, no shading gradients or texture.
Remove the entire middle dollar/staff emblem. Do not add a playing card. Remove the thick white outside halo, retaining just original thin grey teal contour. Everything outside letters and inside counters must be truly transparent. Fit COLORLESS into a horizontal centered transparent image with at least 4 percent clear margin on all sides, approximate visible word aspect 3.8:1. No screen, background, CRT, glow, scanlines, extra typography or watermark.

### Pass 4: thinner-outline alternative (not selected)

Final refinement of this COLORLESS logo. Image 1 is the edit target, image 2 is the original Balatro lettering reference. Preserve the exact nine letters COLORLESS and the improved shapes of image 1: tall hooked Ls, tapered descending R, rounded rectangular Os, gently curved C and Ss, asymmetric E. Preserve one-line composition and true transparent background, all counters transparent.
Change ONLY the finish and subtle proportions toward image 2: make the beige inner bevel substantially narrower, like a single thin edge instead of a broad sculpted ribbon. Make the dark teal exterior outline roughly half as thick and the bottom shadow shallower, retaining the original reference's fine grey, taupe and teal stepped edges. The faces should be flat warm white, with NO rounded embossed lighting. Keep the existing colored reflection positions but break them into irregular thin shards: reduce coral stripe thickness, desaturate lavender, retain the cyan arc around the top O. Do not put the same exact bands on every letter. Keep generous open counters. Slightly pinch/bow the long stems, as in reference, and keep the individual letters' uneven top and bottom endpoints. Authentic small-palette pixel sprite finish, clean intentional stepped edges, no rough alpha fringe, no noise, no glossy 3D effects, no broad black shadow, no white outer sticker border. Keep the word complete and centered with transparent margin. No card, no dollar sign, no background, no scanlines, no glow.


### Pass 5: bolder faces, joined borders and revised extrusion

Use case: precise-object-edit. Refine the COLORLESS wordmark in image 1. Image 2 is the original Balatro sprite, a reference for the border's shallow 3D construction and tight overlapping lettering.
Preserve the approved nine-letter design and exact text COLORLESS, the hooked tall Ls, tapered descending R, rounded rectangular Os, curved C and Ss, asymmetric E, uneven cap heights and baseline, existing ivory/cyan/lavender/salmon palette and reflection placement. Keep one horizontal word, fully visible, centered on true transparent alpha with transparent counters. This is a targeted refinement, NOT a redesign.
Requested changes:
1. Make the ivory letter strokes about 12–15% thicker. Grow the ivory faces slightly into their counters and outward; keep the counters generous and every character legible. Keep the same width/height character and all distinctive shapes.
2. Tighten kerning selectively and let neighboring DARK OUTLINES/EXTRUDED SIDES touch and merge in several small places, like the original. Connect the dark contour of C to O near their upper shoulders, O to the first L near the lower portion, R to the second L near the right leg, second L foot to E foot, and the two S silhouettes where their bends approach. Ivory faces remain visually separate. Dark contours should form a connected organic word silhouette in these areas, with narrow triangular transparent notches elsewhere; NOT a solid rectangular plaque or giant black background behind the word.
3. Revise the 3D black/grey border carefully: replace the current rounded bevel with CRISP PIXEL-STEPPED extrusion in a consistent shallow DOWN-LEFT direction, following original sprite. Use distinct narrow flat layers: thin light warm-grey/taupe lip at face, medium desaturated slate-grey exposed side, deep charcoal-teal outer edge. Depth about 3–4% of letter height, present along lower/left edges and inside upper/right counter edges. Unequal edge thickness from consistent depth direction, not concentric strokes of equal width. Join these dark sidewalls where close letters meet. Small light-grey edge accents make depth readable. Source-like sculpted flat pixel bands, NOT soft pillowy shading, NOT glossy gradients, NOT huge black shadows, NOT inflated cream borders.
Keep face reflections sparse broken shards. Clean pixel-art silhouettes with a limited flat palette; no noisy alpha fringe. No card, no dollar symbol, no other text, no white sticker halo, no glow, no CRT scanlines or background. Preserve transparent padding and approximately the same overall proportions as image 1.

### Pass 6: reduce border bulk while preserving connections (superseded)

Targeted final correction of image 1 COLORLESS wordmark. Image 2 is reference for border depth. Keep the exact nine-letter word COLORLESS, same letter shapes, same layout and image framing, same ivory faces and pastel reflective markings. Keep the letters bold, but make their ivory strokes 5% narrower than image 1, a subtle adjustment only. Most importantly PRESERVE the small shared dark connections between adjacent letters at their shoulders/feet and the two S letters, so the logo remains a connected wordmark. Ivory faces stay separate and readable.
Revise ONLY the over-heavy border finish: cut the depth/width of the entire grey/black extrusion by approximately 40% compared with image 1, especially the large lower band and thick dark top outline. The original reference has a fine dark outer contour and delicate stacked grey edge bands, not a thick dark rubber rim. Make outer contour thin, sharp charcoal with a muted green-grey mid-side, a fine pale grey edge highlight and a very narrow taupe lip touching the ivory. Use two or three crisp flat pixel steps, all casting consistently down-left. Preserve SOME visible depth at the bottom so it is clearly 3D, not just an outline. Connections between letters must remain even with reduced border thickness by moving close neighbors a tiny bit closer if needed; do not erase all joins. Open counters fully transparent. No broad dark backing plate. No soft shading, gradients or blurry fringes.
All other details invariant. Keep transparent alpha outside the word and in counters, modest clear margin, no background, no cards/symbols, no extra text, no glow or CRT, no white sticker outline.
