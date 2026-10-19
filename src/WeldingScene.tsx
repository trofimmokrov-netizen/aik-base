import { useEffect, useRef, useState } from "react";
import type { WeldingProject } from "./welding-project";
export default function WeldingScene({
  project,
  zoom,
  rotation,
}: {
  project: WeldingProject;
  zoom: number;
  rotation: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false,
      cleanup = () => {};
    setFailed(false);
    (async () => {
      const T = await import("three");
      const { OrbitControls } =
        await import("three/addons/controls/OrbitControls.js");
      if (disposed || !host.current) return;
      const el = host.current;
      let renderer: InstanceType<typeof T.WebGLRenderer>;
      try {
        renderer = new T.WebGLRenderer({
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
        });
      } catch {
        setFailed(true);
        return;
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setClearColor(0, 0);
      el.append(renderer.domElement);
      renderer.domElement.setAttribute(
        "aria-label",
        "3D-модель конструкции: вращайте пальцем или мышью",
      );
      const scene = new T.Scene(),
        camera = new T.PerspectiveCamera(38, 1, 0.05, 150);
      const p = project,
        w = p.width,
        d = p.depth,
        h = p.height,
        t = p.profile / 1000;
      const model = new T.Group();
      scene.add(model);
      model.rotation.y = (rotation * Math.PI) / 180;
      const steel = new T.MeshStandardMaterial({
          color: p.color,
          metalness: 0.65,
          roughness: 0.36,
        }),
        deck = new T.MeshStandardMaterial({
          color: "#9aa5aa",
          metalness: 0.35,
          roughness: 0.6,
          transparent: true,
          opacity: 0.65,
          side: T.DoubleSide,
        });
      const geometries: InstanceType<typeof T.BufferGeometry>[] = [];
      function box(
        x: number,
        y: number,
        z: number,
        a: number,
        b: number,
        c: number,
        material = steel,
      ) {
        const g = new T.BoxGeometry(a, b, c);
        geometries.push(g);
        const mesh = new T.Mesh(g, material);
        mesh.position.set(x, y, z);
        model.add(mesh);
        return mesh;
      }
      function beam(a: number[], b: number[]) {
        const from = new T.Vector3(...(a as [number, number, number])),
          to = new T.Vector3(...(b as [number, number, number])),
          delta = to.clone().sub(from);
        const mesh = box(0, 0, 0, t, delta.length(), t);
        mesh.position.copy(from.add(to).multiplyScalar(0.5));
        mesh.quaternion.setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          delta.normalize(),
        );
      }
      if (p.kind === "canopy" || p.kind === "frame") {
        for (const x of [-w / 2, w / 2])
          for (const z of [-d / 2, d / 2]) box(x, h / 2, z, t, h, t);
        for (const z of [-d / 2, d / 2]) box(0, h, z, w, t, t);
        for (const x of [-w / 2, w / 2]) box(x, h, 0, t, t, d);
        for (let i = 0; i <= p.sections; i++) {
          const z = -d / 2 + (d * i) / p.sections;
          if (p.kind === "canopy" && p.roof === "gable") {
            beam([-w / 2, h, z], [0, h + w * 0.16, z]);
            beam([0, h + w * 0.16, z], [w / 2, h, z]);
          } else box(0, h, z, w, t, t);
        }
        if (p.kind === "canopy") {
          if (p.roof === "gable") {
            const rise = w * 0.16,
              side = Math.hypot(w / 2, rise);
            for (const sign of [-1, 1]) {
              const roof = box(
                (sign * w) / 4,
                h + rise / 2 + 0.025,
                0,
                side,
                0.025,
                d + 0.25,
                deck,
              );
              roof.rotation.z = -sign * Math.atan2(rise, w / 2);
            }
          } else box(0, h + 0.05, 0, w + 0.25, 0.03, d + 0.25, deck);
        } else {
          for (const z of [-d / 2, d / 2]) box(0, 0.1, z, w, t, t);
          for (const x of [-w / 2, w / 2]) box(x, 0.1, 0, t, t, d);
          beam([-w / 2, 0, -d / 2], [w / 2, h, -d / 2]);
        }
      } else if (p.kind === "stairs") {
        for (let i = 0; i < p.sections; i++) {
          const z = -d / 2 + (d * (i + 0.5)) / p.sections,
            y = (h * (i + 1)) / p.sections;
          box(0, y, z, w, 0.06, d / p.sections, deck);
          for (const x of [-w / 2, w / 2]) box(x, y + 0.5, z, t, 1, t);
        }
        for (const x of [-w / 2, w / 2]) {
          beam([x, 0, -d / 2], [x, h, d / 2]);
          beam([x, 1, -d / 2], [x, h + 1, d / 2]);
        }
      } else {
        for (let i = 0; i <= p.sections; i++)
          box(-w / 2 + (w * i) / p.sections, h / 2, 0, t, h, t);
        for (const y of [t / 2, h - t / 2]) box(0, y, 0, w, t, t);
        if (p.infill === "vertical") {
          for (let i = 1; i < p.sections * 4; i++)
            box(
              -w / 2 + (w * i) / (p.sections * 4),
              h / 2,
              0,
              t * 0.45,
              h,
              t * 0.45,
            );
        } else {
          for (let i = 1; i < 5; i++)
            box(0, (h * i) / 5, 0, w, t * 0.5, t * 0.5);
        }
        if (p.kind === "gate") box(0, h / 2, 0.025, t * 0.7, h, 0.08);
      }
      const bounds = new T.Box3().setFromObject(model),
        size = bounds.getSize(new T.Vector3()),
        center = bounds.getCenter(new T.Vector3());
      const radius = Math.max(size.x, size.y, size.z);
      camera.position.set(radius * 1.25, center.y + radius * 0.8, radius * 1.5);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      scene.add(new T.HemisphereLight(0xffffff, 0x38404a, 3));
      const light = new T.DirectionalLight(0xffffff, 4);
      light.position.set(4, 8, 5);
      scene.add(light);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(center);
      controls.enableDamping = false;
      controls.enablePan = true;
      controls.minDistance = radius * 0.45;
      controls.maxDistance = radius * 5;
      const render = () => renderer.render(scene, camera);
      controls.addEventListener("change", render);
      const resize = new ResizeObserver(() => {
        if (!el.clientWidth || !el.clientHeight) return;
        renderer.setSize(el.clientWidth, el.clientHeight);
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
        render();
      });
      resize.observe(el);
      controls.update();
      render();
      cleanup = () => {
        resize.disconnect();
        controls.dispose();
        for (const g of geometries) g.dispose();
        steel.dispose();
        deck.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
      if (disposed) cleanup();
    })().catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [project, zoom, rotation]);
  return (
    <div className="welding-model" ref={host}>
      {failed && (
        <p className="studio-fallback">
          3D недоступно в этом браузере. Параметры, сохранение и отправка
          проекта остаются доступны.
        </p>
      )}
    </div>
  );
}
