# Track-edge pack prototype (local branch trackpack-proto — NOT pushed)
Pixi only, `?trackpack=1`, Gridlock only (`js/trackpack.js`, loaded by a dynamic import only with the flag; default play
and Canvas untouched). No buildings atlas. Layers: GD grass on the ground mesh (holes follow the opaque strip parts),
asphalt grain baked into the road texture, outer edge strip (gravel / grass gap / tyre wall / armco / cyan trim) +
inner gravel strip as chunked static MeshSimples, 10 flood pools (one additive octagon mesh) + lamp heads.
Profiling switch: `&tpcut=pools,lamps,inner,outer,overlap`.

FPS (390×844, swiftshader, 4 interleaved runs, 15 s Gridlock race each): flag off 60.0/60.0/60.0/60.0 avg (p5 59.5–59.9),
flag on 59.2/59.4/59.7/59.5 avg (p5 59.5).
Perf work: MeshSimple autoUpdate off (it re-uploads vertices every frame), strips split into 24-point chunks culled to the
view, ground holes under the opaque strip bands (grass composited into the strip's grass gap at load), pools as
octagons trimmed to the visible falloff (~40 % of the quad pixels).
Shots: docs/shots/89-trackpack-{grid,straight,corner-pool,zoomout}.png
