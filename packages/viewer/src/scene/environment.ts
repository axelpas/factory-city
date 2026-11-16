import * as THREE from "three";
import type { Theme } from "../themes/index";

/** What the city stands in: the background, the ground, the light and its shadow, and the ground grid. */
export class Environment {
  private readonly ambient = new THREE.AmbientLight();
  readonly sun = new THREE.DirectionalLight();
  private readonly ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial());
  private grid: THREE.GridHelper | undefined;

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.ambient, this.sun, this.sun.target);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground);
  }

  /** The colors and the light of the theme. */
  apply(theme: Theme): void {
    const c = (key: string) => new THREE.Color(theme.colors[key] ?? "");
    this.scene.background = c("background");
    (this.ground.material as THREE.MeshLambertMaterial).color = c("ground");
    this.ambient.intensity = theme.light.ambient * Math.PI;
    this.sun.intensity = theme.light.sun * Math.PI;
    this.sun.castShadow = theme.light.shadows;
  }

  /** Sizes the ground, the grid and the sun to a city of side `size`. */
  place(size: number, theme: Theme): void {
    this.rebuildGrid(size, theme);
    this.ground.scale.set(size * 6, size * 6, 1);
    this.ground.position.set(size / 2, -0.02, size / 2);
    this.placeSun(size, theme);
  }

  /** The ground grid of the themes that have one. */
  private rebuildGrid(size: number, theme: Theme): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid = undefined;
    }
    if (!theme.effects?.grid) return;
    const line = new THREE.Color(theme.colors.gridLine ?? "");
    this.grid = new THREE.GridHelper(size * 3, 150, line, line);
    this.grid.position.set(size / 2, 0.01, size / 2);
    this.grid.raycast = () => {};
    this.scene.add(this.grid);
  }

  /** The sun and its shadow camera, over the whole city of side `s`. */
  private placeSun(s: number, theme: Theme): void {
    const sun = theme.light.sunPosition;
    this.sun.position.set(s / 2 + (sun[0] ?? 0) * s, (sun[1] ?? 1) * s, s / 2 + (sun[2] ?? 0) * s);
    this.sun.target.position.set(s / 2, 0, s / 2);
    this.sun.castShadow = theme.light.shadows;
    const cam = this.sun.shadow.camera;
    cam.left = -s * 0.85;
    cam.right = s * 0.85;
    cam.top = s * 0.85;
    cam.bottom = -s * 0.85;
    cam.near = 1;
    cam.far = s * 4;
    cam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
  }
}
