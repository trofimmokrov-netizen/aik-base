import { useEffect, useRef, useState } from "react";
import WeldingScene from "./WeldingScene";
import {
  defaultProject,
  normalizeProject,
  encodeProject,
  decodeProject,
  projectKinds,
  projectLink,
  projectBrief,
  type WeldingProject,
} from "./welding-project";
const storageKey = "aik-welding-projects-v1";
type Saved = { id: string; project: WeldingProject; at: string };
function readSaved(): Saved[] {
  const list = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (!Array.isArray(list)) throw Error("storage");
  return list
    .slice(0, 20)
    .map((x: Saved) => ({ ...x, project: normalizeProject(x.project) }));
}
function initialProject() {
  try {
    const code = new URLSearchParams(location.hash.slice(1)).get("studio");
    return code ? decodeProject(code) : { ...defaultProject };
  } catch {
    return { ...defaultProject };
  }
}
export default function WeldingStudio() {
  const [project, setProject] = useState<WeldingProject>(initialProject),
    [saved, setSaved] = useState<Saved[]>([]),
    [activeId, setActiveId] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [camera, setCamera] = useState(false),
    [photo, setPhoto] = useState<string | null>(null),
    [zoom, setZoom] = useState(1),
    [rotation, setRotation] = useState(0),
    [savedCard, setSavedCard] = useState<WeldingProject | null>(null);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    photoRef = useRef<string | null>(null),
    requestId = useRef(0),
    photoRequest = useRef(0),
    scene = useRef<HTMLDivElement>(null),
    saveDialog = useRef<HTMLDialogElement>(null);
  const update = <K extends keyof WeldingProject>(
    key: K,
    value: WeldingProject[K],
  ) => {
    setProject((p) => ({ ...p, [key]: value }));
    setNotice("");
  };
  function stopCamera() {
    requestId.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera(false);
  }
  useEffect(() => {
    try {
      setSaved(readSaved());
    } catch {
      setNotice(
        "Локальное хранилище недоступно. Проект можно передать ссылкой.",
      );
    }
    const hash = () => {
      try {
        const code = new URLSearchParams(location.hash.slice(1)).get("studio");
        if (code) {
          setProject(decodeProject(code));
          setActiveId(null);
          document
            .querySelector("#constructor")
            ?.scrollIntoView({ behavior: "instant" });
        }
      } catch {
        setNotice("Не удалось открыть ссылку проекта. Проверьте её целиком.");
      }
    };
    hash();
    if (location.hash === "#constructor")
      document
        .querySelector("#constructor")
        ?.scrollIntoView({ behavior: "instant" });
    addEventListener("hashchange", hash);
    const visibility = () => {
      if (document.hidden) stopCamera();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      removeEventListener("hashchange", hash);
      document.removeEventListener("visibilitychange", visibility);
      requestId.current++;
      photoRequest.current++;
      stream.current?.getTracks().forEach((t) => t.stop());
      if (photoRef.current) URL.revokeObjectURL(photoRef.current);
    };
  }, []);
  useEffect(() => {
    if (savedCard && !saveDialog.current?.open) saveDialog.current?.showModal();
  }, [savedCard]);
  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice(
        "Камера недоступна. Откройте сайт в браузере через HTTPS или загрузите фото.",
      );
      return;
    }
    const token = ++requestId.current;
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (token !== requestId.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = next;
      setCamera(true);
      if (video.current) {
        video.current.srcObject = next;
        await video.current.play();
      }
      setNotice("Камера включена. Подберите ракурс, поворот и масштаб модели.");
    } catch {
      stopCamera();
      setNotice(
        "Не удалось открыть камеру. Разрешите доступ в настройках или загрузите фото помещения.",
      );
    }
  }
  async function loadPhoto(file?: File) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 15 * 1024 * 1024
    ) {
      setNotice("Нужен JPG, PNG или WebP до 15 МБ.");
      return;
    }
    const token = ++photoRequest.current,
      url = URL.createObjectURL(file),
      image = new Image();
    image.onload = () => {
      if (token !== photoRequest.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (image.width * image.height > 40e6) {
        URL.revokeObjectURL(url);
        setNotice("Слишком большое фото. Уменьшите его до 40 мегапикселей.");
        return;
      }
      stopCamera();
      if (photoRef.current) URL.revokeObjectURL(photoRef.current);
      photoRef.current = url;
      setPhoto(url);
      setNotice(
        "Фото используется только на устройстве и не передаётся со ссылкой.",
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setNotice("Не удалось открыть изображение.");
    };
    image.src = url;
  }
  function shareUrl(p = project) {
    return (
      "https://t.me/+79349999779?text=" +
      encodeURIComponent(
        "Здравствуйте! Хочу обсудить проект.\n" +
          projectBrief(p) +
          "\nОткрыть 3D: " +
          projectLink(p),
      )
    );
  }
  function telegramClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (window.Telegram?.WebApp?.initData) {
      e.preventDefault();
      window.Telegram.WebApp.openTelegramLink(e.currentTarget.href);
    }
  }
  function save() {
    try {
      const p = normalizeProject(project),
        list = readSaved(),
        index = list.findIndex(
          (x) =>
            x.id === activeId || encodeProject(x.project) === encodeProject(p),
        );
      if (index < 0 && list.length >= 20) {
        setNotice("Сохранено 20 проектов. Удалите ненужный проект.");
        return;
      }
      const item = {
        id: index >= 0 ? list[index].id : crypto.randomUUID(),
        project: p,
        at: new Date().toISOString(),
      };
      if (index >= 0) list.splice(index, 1);
      list.unshift(item);
      localStorage.setItem(storageKey, JSON.stringify(list));
      setSaved(list);
      setActiveId(item.id);
      setSavedCard(p);
      setNotice("Проект «" + p.name + "» сохранён в этом браузере.");
    } catch {
      setNotice(
        "Не удалось сохранить в браузере. Скопируйте ссылку или скачайте файл проекта.",
      );
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(projectLink(project));
      setNotice(
        "Ссылка скопирована: она открывает название и все параметры проекта.",
      );
    } catch {
      setNotice("Буфер обмена недоступен. Скопируйте ссылку из поля ниже.");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(normalizeProject(project), null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "aik-base-project.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function capture() {
    try {
      const canvas = scene.current?.querySelector("canvas");
      if (!canvas) throw Error();
      const output = document.createElement("canvas");
      output.width = canvas.width;
      output.height = canvas.height;
      const ctx = output.getContext("2d")!;
      ctx.fillStyle = "#1c1e1e";
      ctx.fillRect(0, 0, output.width, output.height);
      const background = camera
        ? video.current
        : scene.current?.querySelector<HTMLImageElement>(".studio-photo");
      if (background) {
        const w =
            background instanceof HTMLVideoElement
              ? background.videoWidth
              : background.naturalWidth,
          h =
            background instanceof HTMLVideoElement
              ? background.videoHeight
              : background.naturalHeight;
        if (w && h) {
          const k = Math.max(output.width / w, output.height / h);
          ctx.drawImage(
            background,
            (output.width - w * k) / 2,
            (output.height - h * k) / 2,
            w * k,
            h * k,
          );
        }
      }
      ctx.drawImage(canvas, 0, 0);
      ctx.fillStyle = "white";
      ctx.font = Math.max(14, Math.round(output.width / 50)) + "px sans-serif";
      ctx.fillText(
        "AIK BASE · концепция / визуальный ориентир",
        18,
        output.height - 20,
      );
      const a = document.createElement("a");
      a.download = "aik-base-preview.png";
      a.href = output.toDataURL();
      a.click();
      setNotice(
        "Примерка подготовлена в PNG. Прикрепите её к сообщению мастеру.",
      );
    } catch {
      setNotice("Снимок пока недоступен. Дождитесь загрузки 3D.");
    }
  }
  return (
    <section className="section welding-studio" id="constructor">
      <div className="container">
        <div className="eyebrow">
          <span className="section-number">AIK / КОНСТРУКТОР 3D</span>
        </div>
        <h2>
          Сначала — ваш замысел.
          <br />
          <span className="muted">Затем — точный металл.</span>
        </h2>
        <p className="studio-intro">
          Соберите конструкцию, рассмотрите её со всех сторон и примерьте на
          месте. Сохраните проект или передайте мастеру для расчёта.
        </p>
        <div className="studio-layout">
          <div className="studio-settings">
            <label>
              Название проекта
              <input
                maxLength={70}
                value={project.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <div className="studio-kinds" aria-label="Тип конструкции">
              {Object.entries(projectKinds).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={project.kind === key}
                  onClick={() => update("kind", key as WeldingProject["kind"])}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="studio-dimensions">
              {(
                [
                  ["width", "Длина / ширина, м", 0.5, 12, 0.1],
                  ["depth", "Глубина / пролёт, м", 0.3, 10, 0.1],
                  ["height", "Высота, м", 0.4, 6, 0.1],
                  ["profile", "Профиль, мм", 20, 150, 5],
                  [
                    "sections",
                    project.kind === "stairs" ? "Ступени" : "Секции",
                    2,
                    12,
                    1,
                  ],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <label key={key} htmlFor={"studio-" + key}>
                  {label}
                  <input
                    id={"studio-" + key}
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={project[key]}
                    onChange={(e) => update(key, Number(e.target.value))}
                  />
                  <output htmlFor={"studio-" + key}>{project[key]}</output>
                </label>
              ))}
            </div>
            {project.kind === "canopy" && (
              <label>
                Крыша
                <select
                  aria-label="Крыша"
                  value={project.roof}
                  onChange={(e) =>
                    update("roof", e.target.value as WeldingProject["roof"])
                  }
                >
                  <option value="gable">Двускатная</option>
                  <option value="flat">Плоская</option>
                </select>
              </label>
            )}
            {["fence", "gate"].includes(project.kind) && (
              <label>
                Заполнение
                <select
                  aria-label="Заполнение"
                  value={project.infill}
                  onChange={(e) =>
                    update("infill", e.target.value as WeldingProject["infill"])
                  }
                >
                  <option value="vertical">Вертикальное</option>
                  <option value="horizontal">Горизонтальное</option>
                </select>
              </label>
            )}
            <div className="studio-finishes">
              <label>
                Цвет металла
                <input
                  type="color"
                  value={project.color}
                  onChange={(e) => update("color", e.target.value)}
                />
              </label>
              <label>
                Покрытие
                <select
                  aria-label="Покрытие"
                  value={project.finish}
                  onChange={(e) =>
                    update("finish", e.target.value as WeldingProject["finish"])
                  }
                >
                  {[
                    "Матовая окраска",
                    "Грунт под покраску",
                    "Обсудить покрытие",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <small>
              Размеры — в метрах. Профиль — условный размер в модели, не
              рекомендация по несущей способности. Для лестницы высота задаёт
              подъём, для навеса — высоту стоек. Глубина у ворот и ограждения
              справочная: модель показывает одну плоскую секцию.
            </small>
          </div>
          <div className="studio-visual">
            <div className="studio-stage" ref={scene}>
              <video
                ref={video}
                className="studio-camera"
                autoPlay
                muted
                playsInline
                hidden={!camera}
              />
              {photo && !camera && (
                <img
                  className="studio-photo"
                  src={photo}
                  alt="Ваше помещение для примерки"
                />
              )}
              <WeldingScene project={project} zoom={zoom} rotation={rotation} />
              <span className="studio-stage-label">КОНЦЕПЦИЯ / 3D</span>
              <span className="studio-stage-hint">
                Вращайте пальцем · двумя пальцами меняйте положение
              </span>
            </div>
            <div className="studio-scene-tools">
              <button type="button" onClick={camera ? stopCamera : startCamera}>
                {camera ? "Выключить камеру" : "Примерить через камеру"}
              </button>
              <label className="studio-upload">
                Загрузить фото
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    loadPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <button type="button" onClick={capture}>
                Сохранить примерку PNG
              </button>
              {photo && (
                <button
                  type="button"
                  onClick={() => {
                    if (photoRef.current) URL.revokeObjectURL(photoRef.current);
                    photoRef.current = null;
                    setPhoto(null);
                  }}
                >
                  Убрать фото
                </button>
              )}
            </div>
            <div className="studio-dimensions">
              <label htmlFor="studio-zoom">
                Масштаб на экране
                <input
                  id="studio-zoom"
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
              </label>
              <label htmlFor="studio-rotation">
                Поворот конструкции
                <input
                  id="studio-rotation"
                  type="range"
                  min="0"
                  max="360"
                  value={rotation}
                  onChange={(e) => setRotation(Number(e.target.value))}
                />
              </label>
            </div>
            <p className="studio-notice">
              Камера и фото остаются на устройстве. Примерка накладывает модель
              на изображение: она не определяет поверхность, масштаб и
              перспективу автоматически. Это не AR-замер и не производственный
              чертёж.
            </p>
          </div>
        </div>
        <div className="studio-result">
          <div>
            <span className="caption-code">ВАШ ПРОЕКТ / AIK BASE</span>
            <h3>{project.name || defaultProject.name}</h3>
            <pre>{projectBrief(project)}</pre>
            <p>
              Стоимость — после расчёта мастера. Контакты и другие персональные
              данные в название проекта не добавляйте.
            </p>
          </div>
          <div className="studio-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={save}
            >
              Сохранить проект
            </button>
            <a
              className="button button-outline"
              href={shareUrl()}
              onClick={telegramClick}
              target="_blank"
              rel="noopener noreferrer"
            >
              Отправить мастеру в Telegram ↗
            </a>
            <a
              className="button button-outline"
              href={
                "https://t.me/share/url?url=" +
                encodeURIComponent(projectLink(project)) +
                "&text=" +
                encodeURIComponent("AIK BASE · " + project.name)
              }
              onClick={telegramClick}
              target="_blank"
              rel="noopener noreferrer"
            >
              Сохранить / переслать в Telegram
            </a>
            <button type="button" onClick={copy}>
              Скопировать ссылку
            </button>
            <button type="button" onClick={download}>
              Скачать файл проекта
            </button>
            <label className="studio-upload">
              Открыть файл проекта
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 10000) throw Error();
                    setProject(normalizeProject(JSON.parse(await file.text())));
                    setActiveId(null);
                    setNotice("Проект открыт из файла.");
                  } catch {
                    setNotice("Нужен файл проекта AIK BASE до 10 КБ.");
                  } finally {
                    e.target.value = "";
                  }
                }}
              />
            </label>
            <label>
              Ссылка на 3D-проект
              <input
                readOnly
                value={projectLink(project)}
                onClick={(e) => e.currentTarget.select()}
              />
            </label>
            <small>
              Кнопка откроет сообщение мастеру. Проверьте текст и нажмите
              отправку в Telegram. Чтобы сохранить себе, выберите «Избранное».
              Фото комнаты и снимок камеры со ссылкой не передаются.
            </small>
          </div>
        </div>
        <p role="status" aria-live="polite" className="studio-status">
          {notice}
        </p>
        <details className="studio-library">
          <summary>Мои проекты · {saved.length}</summary>
          <p>
            До 20 проектов в этом браузере. Для переноса на другое устройство
            сохраните ссылку в Telegram или скачайте файл.
          </p>
          {saved.map((item) => (
            <article key={item.id}>
              <h3>{item.project.name}</h3>
              <p>
                {projectKinds[item.project.kind]} · {item.project.width} ×{" "}
                {item.project.depth} × {item.project.height} м
              </p>
              <button
                type="button"
                onClick={() => {
                  setProject(item.project);
                  setActiveId(item.id);
                  setNotice("Открыт проект «" + item.project.name + "».");
                }}
              >
                Открыть
              </button>
              <a
                href={shareUrl(item.project)}
                onClick={telegramClick}
                target="_blank"
                rel="noopener noreferrer"
              >
                Отправить мастеру
              </a>
              <button
                type="button"
                onClick={() => {
                  try {
                    const next = readSaved().filter((x) => x.id !== item.id);
                    localStorage.setItem(storageKey, JSON.stringify(next));
                    setSaved(next);
                    if (item.id === activeId) setActiveId(null);
                  } catch {
                    setNotice("Не удалось удалить проект.");
                  }
                }}
              >
                Удалить
              </button>
            </article>
          ))}
        </details>
        <dialog
          className="studio-saved-dialog"
          ref={saveDialog}
          onClose={() => setSavedCard(null)}
          aria-label="Проект сохранён"
        >
          <button
            className="studio-close"
            type="button"
            aria-label="Закрыть сохранённый проект"
            onClick={() => saveDialog.current?.close()}
          >
            ×
          </button>
          <span className="caption-code">ПРОЕКТ СОХРАНЁН НА УСТРОЙСТВЕ</span>
          <h3>{savedCard?.name}</h3>
          {savedCard && (
            <>
              <pre>{projectBrief(savedCard)}</pre>
              <a
                className="button button-primary"
                href={shareUrl(savedCard)}
                onClick={telegramClick}
                target="_blank"
                rel="noopener noreferrer"
              >
                Отправить мастеру в Telegram ↗
              </a>
              <a
                className="button button-outline"
                href={
                  "https://t.me/share/url?url=" +
                  encodeURIComponent(projectLink(savedCard)) +
                  "&text=" +
                  encodeURIComponent(savedCard.name)
                }
                onClick={telegramClick}
                target="_blank"
                rel="noopener noreferrer"
              >
                Сохранить в Telegram
              </a>
              <p>
                Выберите «Избранное», чтобы сохранить ссылку себе. Проект
                открывается с теми же параметрами на другом устройстве.
              </p>
            </>
          )}
        </dialog>
      </div>
    </section>
  );
}
