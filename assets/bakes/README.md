# Static terrain bakes

Lossless RGBA PNG copies of the expensive procedural terrain textures. Only
the current circuit and memory tier are fetched. Missing, undecodable or
wrong-sized files leave the original procedural baker active.

These are data textures, including height or mask values in alpha. Decode
without premultiplying alpha, colour conversion or a vertical flip. Keep
the original filtering, anisotropy and GPU-generated mipmaps. Do not save
them through a canvas or an image editor that premultiplies transparent pixels.

`manifest.json` records the original source commit, dimensions, raw RGBA
SHA-256, PNG SHA-256 and byte size. The original export used three.js r170
on Edge 155 / ANGLE D3D11 / RX 7900 XT. Reuploaded base levels and every mip
were compared against procedural output at both memory tiers. Other GPU
drivers can round procedural floating-point noise differently.

High and mid tiers use 2048 x 2048; low uses 1024 x 1024. Total repository
payload is 34,876,443 bytes. High-tier transfers are approximately 8.73 MiB
for Space, 16.12 MiB for Forest, 7.38 MiB for Ice and 1.71 MiB for Desert.
Loading results measured on localhost do not establish a network-loading
gain at every connection speed.

If the procedural generators change, regenerate the corresponding images,
manifest and `src/bake-data.js` together. The PNG filename includes its
content hash; do not replace an image while retaining the old filename.
`tools/export_bakes.js` exports original GPU RGBA data from a loaded page;
`tools/pack_bakes.py` converts those exports losslessly into these assets.
Runtime remains plain ES modules with no build step.
