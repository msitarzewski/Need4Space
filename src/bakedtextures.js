// Lossless copies of the slow static bakes; failed loads use the procedural path.
import * as THREE from 'three';
import { bakeLater } from './bake.js';
import { Q } from './quality.js';
import { BAKED_TEXTURES } from './bake-data.js';

const ready = new Map();
const MAPS = {
  space: ['rock-normal'],
  forest: ['rock-normal', 'island-normal'],
  ice: ['ice-mask', 'ice-normal'],
  desert: ['sand-normal'],
};
const keyFor = (name) => `${Q.tier === 'low' ? 'low' : 'high'}-${name}`;

export async function preloadBakedTextures(map) {
  if (!MAPS[map] || typeof createImageBitmap === 'undefined') return;
  await Promise.all(MAPS[map].map(async (name) => {
    const key = keyFor(name), entry = BAKED_TEXTURES[key];
    if (!entry) return;
    try {
      const response = await fetch(new URL(`../assets/bakes/${entry.file}`, import.meta.url));
      if (!response.ok) return;
      const image = await createImageBitmap(await response.blob(), {
        premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none',
      });
      if (image.width === entry.width && image.height === entry.height) ready.set(key, image);
      else image.close();
    } catch { /* A missing or undecodable asset leaves the original bake active. */ }
  }));
}

export function cachedBake(renderer, name, size, anisotropy) {
  const key = keyFor(name), image = ready.get(key), entry = BAKED_TEXTURES[key];
  if (!image || entry.width !== size || entry.height !== size) return null;
  ready.delete(key);
  const texture = new THREE.Texture(image);
  texture.colorSpace = entry.colorSpace;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.userData.bakeAsset = key;
  texture.onUpdate = () => {
    image.close();
    texture.image = { width: size, height: size };
  };
  texture.needsUpdate = true;
  bakeLater([], () => renderer.initTexture(texture));
  return texture;
}
