// Build: npm i pixi.js@8.21.0 esbuild && npx esbuild vendor/pixi-lean.entry.js --bundle --format=esm --minify --target=es2020 --outfile=vendor/pixi-lean.mjs
import 'pixi.js/graphics';
import 'pixi.js/mesh';
export { WebGLRenderer, Container, Sprite, Graphics, GraphicsContext, Texture, MeshSimple, Mesh, MeshGeometry, Rectangle, Matrix, FillPattern, ImageSource, CanvasSource } from 'pixi.js';
export { default as earcut } from 'earcut';
