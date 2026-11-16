import type { CameraRig } from "./camera-rig";

/** The orbit controls of the city: damped, kept above the ground, and a camera moved by hand is left alone. */
export function configureControls(rig: CameraRig, requestRender: () => void): void {
  const controls = rig.controls;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.autoRotateSpeed = 0.6;
  controls.addEventListener("change", requestRender);
  // no automatic framing until Reset or Top view; a plain click starts and ends an interaction without
  // changing the view: it does not count
  let byHand = false;
  controls.addEventListener("start", () => {
    byHand = true;
  });
  controls.addEventListener("end", () => {
    byHand = false;
  });
  controls.addEventListener("change", () => {
    if (byHand) rig.framed = null;
  });
}
