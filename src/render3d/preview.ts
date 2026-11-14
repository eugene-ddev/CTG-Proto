// Общий рендерер 3D-превью моделей (главная, «Персонаж», сборка, «Новый противник»).
// Один WebGL-контекст на все превью: каждое рисуется в угол общего canvas и копируется в свою текстуру Phaser.
// У 3D-боя свой рендерер (Arena3D) — контекстов всего два.
import { type Camera, NoToneMapping, PCFShadowMap, PMREMGenerator, type Scene, type Texture, Vector2, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let renderer: WebGLRenderer | undefined;
let env: Texture | undefined;
const canvas = document.createElement('canvas');

function ensure(w: number, h: number): WebGLRenderer {
  if (!renderer) {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.toneMapping = NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
  }
  // canvas растёт до самого большого превью и не сжимается — без пересоздания буфера на каждый кадр
  const size = renderer.getSize(tmp);
  if (size.x < w || size.y < h) renderer.setSize(Math.max(size.x, w), Math.max(size.y, h), false);
  return renderer;
}
const tmp = new Vector2();

/** Отражения окружения для материалов блоков (как в 3D-бою). */
export function previewEnvironment(): Texture | null {
  return env ?? null;
}

/** Нарисовать сцену размером w×h px и скопировать кадр в ctx (прозрачный фон). */
export function renderPreview(scene: Scene, camera: Camera, w: number, h: number, ctx: CanvasRenderingContext2D) {
  const r = ensure(w, h);
  if (!scene.environment && env) scene.environment = env;
  const H = canvas.height;
  // область внизу-слева буфера WebGL — это верхний левый угол картинки canvas
  r.setScissorTest(true);
  r.setViewport(0, H - h, w, h);
  r.setScissor(0, H - h, w, h);
  r.clear();
  r.render(scene, camera);
  r.setScissorTest(false);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h, 0, 0, w, h);
}
