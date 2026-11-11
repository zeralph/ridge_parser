# Gran Turismo format notes for the next session

This is the Markdown handoff note for future sessions.

## Workspace

- Root: `/Volumes/Tero/ridge_racer_test`.
- Viewer: `index.html`, `Sceneview.js`, vendored legacy Three.js in `js/`.
- Main track: `DESERT.MDL` (242,868 bytes). Texture banks: `ridge_racer/TEX0.TMS` through `TEX4.TMS`.
- Other files: `MAP.RRM`, `ridge_racer/OBJ.RRO`, `CAR.RSO`, `ridge_racer/RR.VB`, `ridge_racer/RR.VH`, `ridge_racer/IDX.HED`.
- Local server: `python3 -m http.server 8001` from the workspace root. Port 8000 was already occupied.

## DESERT.MDL parsing (verified)

- PS1 address base: `0x06048000`; pointers in the MDL are big-endian.
- First 128 u32 values are object-header pointers. Convert a pointer to a file offset by subtracting the base.
- Header size 12 bytes: BE u16 vertex count, BE u16 primitive count, BE u32 vertex pointer, BE u32 primitive pointer.
- Vertex records are 6 bytes: signed BE16 X,Y,Z.
- Primitive block ends at the next object header after its primitive pointer. For the last object, use `primitivePointer + primitiveCount * 12` as an upper bound because unrelated trailer data follows.
- Primitive records are variable length: prefix 4 bytes + four BE16 vertex-offset references = 12-byte quad; prefix 4 bytes + three references = 10-byte triangle. Reference values are divisible by 16 and local vertex index is `value / 16`.
- The parser in `index.html` selects arity 4 then 3 using reference validity and remaining block length; it validated all 128 objects. End padding observed: 0 or 2 bytes.
- Verified totals: 128 objects, 17,032 vertices, 11,208 primitives (11,047 quads, 161 triangles), 22,255 rendered triangles.
- Quad triangulation selects the diagonal that minimizes the worst triangle-shape score. Object coordinates are already in one shared world frame; no per-object transform is needed.

## TMS pixel decoding and texture mapping

- Confirmed: the TMS blocks are not raw RGBA. All decoded banks have TIM-like `u32 LE 16`, flags `8`, and a 44-byte CLUT block containing 16 little-endian RGB555 words.
- Image header width is `widthWords`; height is pixels. Payload size is `4 * widthWords * height`, which is two planes of `widthWords * height * 2` bytes each. Each 4-bpp plane decodes to `widthWords * 4` pixels wide. Pixels are four low-nibble-first indices per LE 16-bit word.
- Viewer now has a page 0/1 selector, RGB555 palette expansion, palette index 0 alpha=0, and a non-lit Basic material so scene sunlight does not tint texture colors. STP/semi-transparency is not decoded yet.
- Default test is `TEX0.TMS #24`, page 0: a gray road-like image. This is a visual candidate, not a proven material assignment.
- Current UV hypothesis still maps the primitive 4-byte prefix to two opposite UV corners. 66,765/66,765 corners fit the decoded 256x256 TEX0 #24 page, but fit alone does not prove the mapping.
- Important alternate hypothesis: common prefix words `0x1054/0x1056` may be PS1 TPAGE values, followed by one UV pair. Under one TPAGE/UV-byte-order interpretation, 6,615/11,208 primitives land in TMS image rectangles; TPAGE `0x1056` often points into TEX0 #32/#33. This is suggestive but not yet enough to replace the current mapping.
- TMS block coordinates are likely VRAM placement metadata. A future decoder should assemble or address the correct page/CLUT per primitive rather than selecting any image block by numeric index.

## Trailer at end of DESERT.MDL

- Trailer begins at `0x3a7c4`; header bytes `01 9d 00 00 00 00 00 00`. Interpreted count: 413.
- Exactly 413 8-byte records start at `0x3a7cc` and end at EOF `0x3b4b4`.
- The final 143 records are indices 270-412, byte range `[0x3b03c, 0x3b4b4)`. They share the same 2-byte prefix `14 88` as the earlier records; no sub-block boundary was found.
- Trailer record fields/endianness/semantics are unresolved. The 16-bit first word is constant. Coordinate interpretations tested so far did not align with the main mesh under direct BE/LE and axis permutations.
- AI path is conceivable from the count and ordering, but the tested sequence has large jumps and does not establish a circuit line. 413 independent point lights are unlikely; not proven.
- Do not use trailer data as vertex colors without a stronger match.

## Color findings

- Main object header has only counts and pointers to XYZ vertices and primitive records; XYZ stride is exactly 6 bytes.
- Primitive prefix is currently decoded as UV endpoints, leaving no identified per-vertex color attribute in the mesh streams.
- `Vertex color - calcule` in the UI is synthetic: it bakes block color times a directional-light factor derived from vertex normals into `Face3.vertexColors`. Status text explicitly says native colors were not decoded.
- Shaded-sun mode uses a uniform light gray base color (`0xc8ccce`) with Sceneview ambient + directional light. Block-color mode stores one HSL color per object.

## Viewer behavior

- Startup loads `DESERT.MDL` and assembles all objects.
- Object index + `Charger l'objet` loads one object; `Charger le circuit complet` loads all 128.
- Render modes: wireframe, color by block, uniform gray sunlight shading, synthetic vertex color, TMS texture using UV candidates.
- `Vue de dessus` uses XZ bounds, viewport aspect and perspective FOV; `Sceneview.resize` refits while top view is active.
- Mesh array is `m_triangleObjects`; object group is `m_object`; bounds are stored as `m_object.userData.minimum/maximum`.

## Verification already performed

- `get_errors` reported no errors for `index.html` and `Sceneview.js` after the last viewer changes.
- Browser checks confirmed mode switching, 128 unique block colors, single-object and full-circuit loading, textured UV mapping, and top-down bounds inside desktop/mobile viewports.
- No formal automated test suite exists in this workspace.

## Safe next investigations

1. Resolve primitive prefix layout (TPAGE + UV vs two UV corners) and correlate per-primitive TPAGE/CLUT to TMS VRAM image regions.
2. Classify the 413-record trailer separately: check whether its 8-byte rows are a route/path, GPU command stream, or auxiliary geometry. Keep it separate from the 17,032-vertex mesh until references are found.
3. Search for native vertex colors only if a stream can be associated with object IDs/vertex indices; otherwise keep the current synthetic mode clearly labeled.
4. `export.py` is an older exporter that assumes fixed 12-byte quads and blindly divides references by 16; do not treat it as the authoritative parser for the variable 10/12-byte stream.
