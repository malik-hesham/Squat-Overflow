// Types for the tree-shaken three.js r186 bundle next to this file. TypeScript reads
// this instead of type-checking the minified three.js. Keep the export list in sync
// with the `export {...}` at the end of three.js, and the @types/three version in
// extension/package.json with the bundle's three.js version.
export {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  OrthographicCamera,
  PMREMGenerator,
  SRGBColorSpace,
  Scene,
  Shape,
  ShapeUtils,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
export { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
export { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
