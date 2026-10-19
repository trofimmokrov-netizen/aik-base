import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  Check,
  X,
  Menu,
  Plus,
  Minus,
  Flame,
  MoveUpRight,
  Layers3,
  Fence,
  Warehouse,
  Ruler,
  Wrench,
  Truck,
  Sparkles,
  ShieldCheck,
  Clock3,
  ChevronRight,
  Send,
  CircleHelp,
  LoaderCircle,
  Box,
  Copy,
  CheckCheck,
} from "lucide-react";
import services from "../shared/services.json" with { type: "json" };
import portfolioContent from "./content/portfolio.json";
import site from "../shared/site.json";
import { api } from "./api";
import { SERVER_ENABLED } from "./mode";
import { initializeTelegram, telegramInitData } from "./telegram";
import { formatDraft, downloadText } from "./draft";
import { orderSchema } from "../shared/validation.mjs";
import { calculateEstimate } from "../shared/estimate.mjs";
import rates from "../shared/rates.json";
import type { EstimateInput, Estimate, Order, PublicConfig } from "./types";
import type { PortfolioWork } from "./types";

const portfolio: PortfolioWork[] = portfolioContent;

const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;
const initialInput: EstimateInput = {
  serviceId: "welding",
  metal: "steel",
  width: 1,
  height: 1,
  quantity: 1,
  onsite: false,
};
const iconMap = {
  spark: Flame,
  box: Layers3,
  gate: Fence,
  roof: Warehouse,
  stairs: Ruler,
  tool: Wrench,
  ruler: Sparkles,
  truck: Truck,
};
const statusNames: Record<string, string> = {
  new: "Принята",
  reviewing: "На рассмотрении",
  agreed: "Согласована",
  in_progress: "В работе",
  completed: "Завершена",
  cancelled: "Отменена",
};
const faq = [
  [
    "Как узнать точную стоимость?",
    "Выберите услугу и укажите размеры в калькуляторе. Отправьте описание задачи: мастер уточнит материал, объём, монтаж и согласует итоговую стоимость до начала работы.",
  ],
  [
    "Можно заказать работу по своему эскизу?",
    "Да. Опишите идею и укажите размеры в заявке. Эскизы и фотографии можно обсудить с мастером в Telegram после первого контакта.",
  ],
  [
    "Вы работаете с выездом?",
    "Выезд предусмотрен в форме заявки. Географию, условия на объекте, наличие электричества и удобное время мастер подтвердит при обсуждении.",
  ],
  [
    "Какие материалы используются?",
    "В форме можно выбрать сталь, нержавеющую сталь или алюминий. Подходящую технологию и доступность работы с конкретным материалом мастер уточнит до согласования заказа.",
  ],
  [
    SERVER_ENABLED
      ? "Как отследить свою заявку?"
      : "Как передать заявку мастеру?",
    SERVER_ENABLED
      ? "После отправки откройте «Мои заявки» в той же вкладке. В Mini App заявки, оформленные с подтверждённой Telegram-авторизацией, доступны вашему аккаунту."
      : "Заполните форму и подготовьте текст заявки. Скопируйте его в переписку с мастером или отправьте SMS на указанный номер. Сам сайт ничего не отправляет. Уточнить получение, цену и сроки можно по телефону.",
  ],
];

function Modal({
  open,
  onClose,
  label,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-label={label}
      onCancel={onClose}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content">
        <button
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X size={22} />
        </button>
        {children}
      </div>
    </dialog>
  );
}

function Brand() {
  return (
    <a href="#home" className="brand" aria-label="AIK BASE — на главную">
      <span className="brand-mark">
        A<span>↗</span>
      </span>
      <span>
        AIK<span className="brand-light">BASE</span>
        <small>МЕТАЛЛ. ХАРАКТЕР. ДЕЛО.</small>
      </span>
    </a>
  );
}

function InputFields({
  value,
  onChange,
  compact = false,
}: {
  value: EstimateInput;
  onChange: (value: EstimateInput) => void;
  compact?: boolean;
}) {
  function set<K extends keyof EstimateInput>(key: K, next: EstimateInput[K]) {
    onChange({ ...value, [key]: next });
  }
  return (
    <>
      <div className="field-grid">
        <label className="field">
          Вид работ
          <select
            value={value.serviceId}
            onChange={(e) => set("serviceId", e.target.value)}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Тип металла
          <select
            value={value.metal}
            onChange={(e) => set("metal", e.target.value)}
          >
            <option value="steel">Сталь</option>
            <option value="stainless">Нержавеющая сталь</option>
            <option value="aluminum">Алюминий</option>
          </select>
        </label>
      </div>
      <div className={`field-grid ${compact ? "" : "three"}`}>
        <label className="field">
          Длина, м
          <input
            required
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={Number.isNaN(value.width) ? "" : value.width}
            onChange={(e) => set("width", e.target.valueAsNumber)}
          />
        </label>
        <label className="field">
          Ширина / высота, м
          <input
            required
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={Number.isNaN(value.height) ? "" : value.height}
            onChange={(e) => set("height", e.target.valueAsNumber)}
          />
        </label>
        <label className="field">
          Количество
          <input
            required
            type="number"
            min="1"
            max="100"
            step="1"
            value={Number.isNaN(value.quantity) ? "" : value.quantity}
            onChange={(e) => set("quantity", e.target.valueAsNumber)}
          />
        </label>
      </div>
      <label className="check-field">
        <input
          type="checkbox"
          checked={value.onsite}
          onChange={(e) => set("onsite", e.target.checked)}
        />
        <span>Нужен выезд на объект</span>
        <Truck size={18} />
      </label>
    </>
  );
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [input, setInput] = useState<EstimateInput>(initialInput);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [apiState, setApiState] = useState<"loading" | "online" | "offline">(
    "loading",
  );
  const [filter, setFilter] = useState("all");
  const [activeProjectPhoto, setActiveProjectPhoto] = useState<string | null>(null);
  const [photo, setPhoto] = useState<(typeof portfolio)[number] | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [contact, setContact] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const [success, setSuccess] = useState<{
    order: Order;
    message: string;
    accessToken: string;
  } | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const [draftValues, setDraftValues] = useState<{
    name: string;
    contact: string;
    description: string;
    comment: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [trackingId, setTrackingId] = useState("");
  const [trackingKey, setTrackingKey] = useState("");
  const [tracked, setTracked] = useState<Order | null>(null);
  const [trackingError, setTrackingError] = useState("");
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [copied, setCopied] = useState(false);
  const idempotency = useRef("");
  const submittedBody = useRef("");
  const estimateVersion = useRef(0);

  useEffect(() => {
    if (SERVER_ENABLED)
      api
        .config()
        .then((data) => {
          setConfig(data);
          setApiState("online");
        })
        .catch(() => setApiState("offline"));
    void initializeTelegram();
    try {
      const last = sessionStorage.getItem("aik-last-order");
      if (last) setTrackingId(last);
    } catch {
      /* Storage may be disabled in a WebView. */
    }
  }, []);

  useEffect(() => {
    if (!SERVER_ENABLED || !tracking || !telegramInitData()) return;
    api
      .myOrders()
      .then(({ orders }) => setMyOrders(orders))
      .catch((e) => setTrackingError(e.message));
  }, [tracking]);

  useEffect(() => {
    if (orderOpen) {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label="Оформить заявку"]');
      if (dialog) dialog.scrollTop = 0;
    }
  }, [orderOpen, draftText, success]);

  function changeInput(next: EstimateInput) {
    estimateVersion.current++;
    setInput(next);
    setEstimate(null);
    setEstimateError("");
  }
  function openOrder(serviceId?: string) {
    if (serviceId) changeInput({ ...input, serviceId });
    setSuccess(null);
    setDraftText("");
    setDraftNotice("");
    setDraftValues(null);
    setSubmitError("");
    setOrderOpen(true);
    setMenuOpen(false);
  }
  function navigate() {
    setMenuOpen(false);
  }
  async function calculate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEstimateLoading(true);
    setEstimateError("");
    const snapshot = { ...input };
    const version = estimateVersion.current;
    try {
      const result = SERVER_ENABLED
        ? await api.estimate(snapshot)
        : calculateEstimate(snapshot, rates);
      if (version === estimateVersion.current) setEstimate(result);
    } catch (error) {
      if (version === estimateVersion.current)
        setEstimateError((error as Error).message);
    } finally {
      setEstimateLoading(false);
    }
  }
  async function submitOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const data = new FormData(e.currentTarget);
    const payload = {
      ...input,
      name: String(data.get("name") || "").trim(),
      contact: String(data.get("contact") || "").trim(),
      description: String(data.get("description") || "").trim(),
      comment: String(data.get("comment") || "").trim(),
      consent: data.get("consent") === "on",
      website: String(data.get("website") || ""),
    };
    if (!SERVER_ENABLED) {
      const parsed = orderSchema.safeParse(payload);
      if (!parsed.success) {
        setSubmitError(
          "Проверьте имя, контакт, описание и размеры. Контакт — телефон, email или Telegram @username.",
        );
        return;
      }
      setDraftValues(payload);
      setDraftText(formatDraft(payload));
      setDraftNotice("");
      setSubmitError("");
      return;
    }
    const encoded = JSON.stringify(payload);
    if (!idempotency.current) idempotency.current = crypto.randomUUID();
    if (submittedBody.current && submittedBody.current !== encoded)
      idempotency.current = "";
    submittedBody.current = encoded;
    setSending(true);
    setSubmitError("");
    try {
      const result = await api.createOrder(payload, idempotency.current);
      setSuccess(result);
      setTrackingId(result.order.id);
      try {
        sessionStorage.setItem(
          `aik-order:${result.order.id}`,
          result.accessToken,
        );
        sessionStorage.setItem("aik-last-order", result.order.id);
      } catch {
        /* Still show the order number if storage is disabled. */
      }
      idempotency.current = crypto.randomUUID();
      submittedBody.current = "";
    } catch (error) {
      setSubmitError((error as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function findOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTrackingLoading(true);
    setTrackingError("");
    setTracked(null);
    let token: string | undefined = trackingKey.trim() || undefined;
    try {
      token ||=
        sessionStorage.getItem(`aik-order:${trackingId.trim()}`) || undefined;
    } catch {
      /* Use Telegram identity if available. */
    }
    try {
      const result = await api.order(trackingId.trim(), token);
      setTracked(result.order);
    } catch (error) {
      setTrackingError((error as Error).message);
    } finally {
      setTrackingLoading(false);
    }
  }
  const visibleWorks = portfolio.filter(
    (work) => filter === "all" || work.category === filter,
  );
  const botUrl = `https://t.me/${site.botUsername}`;
  const phone = config?.phone || site.phone;
  const phoneDisplay = phone === site.phone ? site.phoneDisplay : phone;
  const masterTelegramUrl = `https://t.me/+${phone.replace(/\D/g, "")}`;
  const realWorks = portfolio.some((work) => !work.demo);

  function saveReceipt() {
    if (!success) return;
    const receipt = {
      orderId: success.order.id,
      accessToken: success.accessToken,
      note: "Личный ключ заявки AIK BASE. Не передавайте другим людям. Введите номер и ключ в разделе «Мои заявки».",
    };
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(receipt, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = href;
    link.download = `aik-base-${success.order.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <>
      <a className="skip-link" href="#main">
        К содержимому
      </a>
      <div className="topline">
        <span>МЕТАЛЛ ПРИНИМАЕТ ФОРМУ. ИДЕИ — ВОПЛОЩЕНИЕ.</span>
        <span className="topline-right">
          <i /> Индивидуальные проекты из металла
        </span>
      </div>
      <header className="header">
        <div className="container header-inner">
          <Brand />
          <nav
            aria-label="Основная навигация"
            className={menuOpen ? "nav open" : "nav"}
          >
            <a href="#services" onClick={navigate}>
              Услуги
            </a>
            <a href="#portfolio" onClick={navigate}>
              Проекты
            </a>
            <a href="#process" onClick={navigate}>
              Как работаем
            </a>
            <a href="#calculator" onClick={navigate}>
              Калькулятор
            </a>
            {SERVER_ENABLED && (
              <button
                className="nav-orders"
                onClick={() => {
                  setTracking(true);
                  navigate();
                }}
              >
                Мои заявки
              </button>
            )}
          </nav>
          <button className="button header-cta" onClick={() => openOrder()}>
            Обсудить проект <ArrowUpRight size={17} />
          </button>
          <button
            className="icon-button mobile-menu"
            aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="home">
          <div className="hero-grid" aria-hidden="true" />
          <div
            className="hero-image"
            role="img"
            aria-label="Художественная иллюстрация сварщика за работой в мастерской"
          />
          <div className="container hero-content">
            <div className="eyebrow">
              <span className="orange-line" /> СВАРКА И МЕТАЛЛОКОНСТРУКЦИИ
            </div>
            <h1>
              Сварка,
              <br />
              которая <span>держит.</span>
            </h1>
            <p className="hero-description">
              Превращаем металл в надёжные решения.
              <br />
              От аккуратного шва до конструкции,
              <br className="desktop-break" /> созданной под вашу задачу.
            </p>
            <div className="hero-buttons">
              <button
                className="button button-primary"
                onClick={() => openOrder()}
              >
                Заказать сварку <ArrowUpRight size={20} />
              </button>
              <a href="#calculator" className="button button-outline">
                Рассчитать стоимость <Plus size={18} />
              </a>
            </div>
            <div className="hero-trust">
              <ShieldCheck size={17} />
              <span>Индивидуальный подход</span>
              <span className="dot">·</span>
              <span>Внимание к деталям</span>
            </div>
          </div>
          <div className="hero-caption">
            <span className="crosshair">+</span>
            <div>
              ТОЧНОСТЬ В ДЕТАЛЯХ.
              <br />
              <strong>ПРОЧНОСТЬ В ОСНОВЕ.</strong>
            </div>
            <span className="caption-code">AIK / 001</span>
          </div>
          <div className="container hero-bottom">
            <a href="#services">
              ОТКРОЙТЕ ВОЗМОЖНОСТИ МЕТАЛЛА <ArrowDown size={17} />
            </a>
            <span>01 — 06</span>
          </div>
        </section>

        <div className="specialty-strip">
          <div className="container">
            <span>
              <span className="small-star">✳︎</span> СВАРОЧНЫЕ РАБОТЫ
            </span>
            <span>
              <span className="small-star">✳︎</span> МЕТАЛЛОКОНСТРУКЦИИ
            </span>
            <span>
              <span className="small-star">✳︎</span> ИНДИВИДУАЛЬНЫЕ РЕШЕНИЯ
            </span>
            <span className="strip-last">
              <span className="small-star">✳︎</span> ВЫЕЗД НА ОБЪЕКТ
            </span>
          </div>
        </div>

        <section className="section services-section" id="services">
          <div className="container">
            <div className="section-heading">
              <div>
                <div className="eyebrow">
                  <span className="section-number">01 /</span> ЧТО МЫ ДЕЛАЕМ
                </div>
                <h2>
                  Есть задача.
                  <br />
                  <span className="muted">Есть решение из металла.</span>
                </h2>
              </div>
              <p>
                Создаём, соединяем, восстанавливаем.
                <br />
                Подберём подходящий способ работы
                <br />
                под ваш проект.
              </p>
            </div>
            <div className="services-grid">
              {services.map((s) => {
                const Icon = iconMap[s.icon as keyof typeof iconMap] || Box;
                return (
                  <button
                    className="service-card"
                    key={s.id}
                    onClick={() => openOrder(s.id)}
                    aria-label={`Заказать: ${s.title}`}
                  >
                    <div className="service-top">
                      <Icon size={28} strokeWidth={1.4} />
                      <span>{s.number}</span>
                    </div>
                    <h3>{s.title}</h3>
                    <p>{s.short}</p>
                    <div className="service-bottom">
                      <span>Обсудить задачу</span>
                      <ArrowUpRight size={20} />
                    </div>
                    <span className="service-description">{s.description}</span>
                  </button>
                );
              })}
            </div>
            <div className="services-note">
              <CircleHelp size={19} />
              <span>
                Не нашли нужную услугу? Расскажите о своей идее — найдём
                решение.
              </span>
              <button className="text-link" onClick={() => openOrder("custom")}>
                Написать мастеру <ArrowUpRight size={17} />
              </button>
            </div>
          </div>
        </section>

        <section className="section portfolio-section" id="portfolio">
          <div className="container">
            <div className="section-heading">
              <div>
                <div className="eyebrow">
                  <span className="section-number">02 /</span> ВОЗМОЖНОСТИ В
                  МЕТАЛЛЕ
                </div>
                <h2>
                  Дело видно
                  <br />
                  <span className="muted">в деталях.</span>
                </h2>
              </div>
              <div className="portfolio-intro">
                <p>
                  {realWorks ? (
                    <>
                      Проекты, в которых идеи обрели форму.
                      <br />
                      Материалы с объектов и детали наших работ.
                    </>
                  ) : (
                    <>
                      Место для будущих проектов.
                      <br />
                      Пока здесь — иллюстрации направлений,
                      <br />а не фотографии выполненных заказов.
                    </>
                  )}
                </p>
                <span className="demo-label">
                  <span />{" "}
                  {realWorks
                    ? "ПОРТФОЛИО AIK BASE"
                    : "ДЕМОНСТРАЦИОННАЯ ГАЛЕРЕЯ"}
                </span>
              </div>
            </div>
            <div
              className="filter-row"
              role="group"
              aria-label="Категории проектов"
            >
              {[
                ["all", "Все направления"],
                ...[...new Set(portfolio.map((work) => work.category))].map(
                  (category) => [
                    category,
                    portfolio.find((work) => work.category === category)!.label,
                  ],
                ),
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "filter active" : "filter"}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  {value === "all" && (
                    <span>{String(portfolio.length).padStart(2, "0")}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="portfolio-grid">
              {visibleWorks.map((work, i) => (
                <button
                  key={work.id}
                  className={`project-card project-${i}`}
                  onClick={() => { setActiveProjectPhoto(null); setPhoto(work); }}
                >
                  <div
                    className={`project-image ${work.id === "assembly" ? "detail-image" : ""}`}
                  >
                    <img
                      src={asset(work.image)}
                      alt={work.description}
                      style={{ objectPosition: work.position }}
                      loading="lazy"
                    />
                    <span className="project-demo">
                      {work.demo
                        ? "ИЛЛЮСТРАЦИЯ"
                        : work.video
                          ? "ВИДЕО С ОБЪЕКТА"
                          : "ФОТО ПРОЕКТА"}
                    </span>
                    <span className="project-expand">
                      {work.video ? (
                        <span
                          className="video-play"
                          aria-label="Смотреть видео"
                        >
                          ▶
                        </span>
                      ) : (
                        <MoveUpRight size={22} />
                      )}
                    </span>
                  </div>
                  <div className="project-info">
                    <div>
                      <small>{work.label}</small>
                      <h3>{work.title}</h3>
                    </div>
                    <ArrowUpRight size={24} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="section process-section" id="process">
          <div className="container">
            <div className="section-heading">
              <div>
                <div className="eyebrow">
                  <span className="section-number">03 /</span> БЕЗ ЛИШНИХ
                  СЛОЖНОСТЕЙ
                </div>
                <h2>
                  От идеи —<br />
                  <span className="muted">к готовой конструкции.</span>
                </h2>
              </div>
              <p>
                Понятный процесс.
                <br />
                Прямая связь с мастером.
                <br />
                Все детали — до начала работ.
              </p>
            </div>
            <div className="process-grid">
              {[
                [
                  "01",
                  "Расскажите о задаче",
                  "Выберите услугу, укажите размеры и оставьте заявку. Эскиз или идея тоже подойдут.",
                ],
                [
                  "02",
                  "Согласуем детали",
                  "Обсудим материалы, особенности, стоимость и сроки. При необходимости — замер на объекте.",
                ],
                [
                  "03",
                  "Приступим к работе",
                  "Изготовим, сварим и соберём конструкцию по согласованному проекту.",
                ],
                [
                  "04",
                  "Проверим результат",
                  "Обсудим готовую работу, детали монтажа и рекомендации по эксплуатации.",
                ],
              ].map(([num, title, desc]) => (
                <div className="process-step" key={num}>
                  <div className="step-line">
                    <span>{num}</span>
                    <ArrowRight size={20} />
                  </div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section calculator-section" id="calculator">
          <div className="container calculator-layout">
            <div className="calculator-copy">
              <div className="eyebrow">
                <span className="section-number">04 /</span> ОТ ЗАДАЧИ К РАСЧЁТУ
              </div>
              <h2>
                Каждый проект
                <br />
                начинается
                <br />
                <span>с вашей идеи.</span>
              </h2>
              <p>
                Расскажите, что нужно сделать.
                <br />
                Калькулятор поможет собрать параметры,
                <br />а мастер — уточнить стоимость.
              </p>
              <div className="calculator-note">
                <Ruler size={23} />
                <span>
                  Нет точных размеров?
                  <br />
                  <strong>Начните с приблизительных.</strong>
                </span>
              </div>
              <div className="outline-monogram" aria-hidden="true">
                AIK<span>+</span>
              </div>
            </div>
            <form className="calculator-card" onSubmit={calculate}>
              <div className="calculator-title">
                <h3>Параметры проекта</h3>
                <span>01 / РАСЧЁТ</span>
              </div>
              <InputFields value={input} onChange={changeInput} />
              <div className="estimate-result" aria-live="polite">
                <span>ПРЕДВАРИТЕЛЬНАЯ СТОИМОСТЬ</span>
                <strong>
                  {estimate?.amount != null
                    ? `${new Intl.NumberFormat("ru-RU").format(estimate.amount)} ₽`
                    : "Рассчитывается индивидуально"}
                </strong>
                <p>
                  {estimate?.amount != null
                    ? estimate.message
                    : "Тарифы пока не настроены. Мастер подготовит расчёт после уточнения деталей."}
                </p>
              </div>
              {estimateError && (
                <p className="form-error" role="alert">
                  {estimateError}
                </p>
              )}
              <div className="calc-actions">
                <button
                  type="submit"
                  className="button button-outline"
                  disabled={estimateLoading}
                >
                  {estimateLoading ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Ruler size={18} />
                  )}{" "}
                  Проверить расчёт
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => openOrder()}
                >
                  Оставить заявку <ArrowUpRight size={20} />
                </button>
              </div>
              <p className="form-footnote">
                <ShieldCheck size={14} /> Цена и сроки согласуются до начала
                работ
              </p>
            </form>
          </div>
        </section>

        <section className="section telegram-section">
          <div className="container telegram-layout">
            <div className="telegram-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="telegram-icon">
                <Send size={58} strokeWidth={1.5} />
              </div>
              <span className="floating-tag tag-one">
                <Check size={14} />{" "}
                {SERVER_ENABLED ? "Задача принята" : "Параметры собраны"}
              </span>
              <span className="floating-tag tag-two">
                <Flame size={14} /> AIK BASE / MINI APP
              </span>
            </div>
            <div>
              <div className="eyebrow">
                <span className="section-number">ВСЕГДА ПОД РУКОЙ</span>
              </div>
              <h2>
                Ваш проект.
                <br />
                <span className="muted">Напрямую мастеру.</span>
              </h2>
              <p>
                {SERVER_ENABLED ? (
                  <>
                    Те же услуги и калькулятор — прямо в мессенджере.
                    <br />
                    Оформляйте заявки и следите за их статусом
                    <br className="desktop-break" /> в AIK BASE Mini App.
                  </>
                ) : (
                  <>
                    Соберите параметры проекта в удобной форме.
                    <br />
                    Скопируйте текст, отправьте его мастеру
                    <br className="desktop-break" /> в Telegram или обсудите всё по
                    телефону.
                  </>
                )}
              </p>
              <a
                className="button button-primary"
                href={SERVER_ENABLED ? botUrl : masterTelegramUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {SERVER_ENABLED ? "Открыть Telegram-бота" : "Написать мастеру в Telegram"}{" "}
                <ArrowUpRight size={20} />
              </a>
              <small className="telegram-handle">
                {SERVER_ENABLED ? "@AikBaseOrder_Bot" : phoneDisplay}
              </small>
            </div>
          </div>
        </section>

        <section className="section faq-section" id="faq">
          <div className="container faq-layout">
            <div>
              <div className="eyebrow">
                <span className="section-number">05 /</span> ВАЖНО ЗНАТЬ
              </div>
              <h2>
                Остались
                <br />
                <span className="muted">вопросы?</span>
              </h2>
              <p>Разберёмся в деталях вместе.</p>
              <button className="text-link" onClick={() => setContact(true)}>
                Связаться с мастером <ArrowUpRight size={18} />
              </button>
            </div>
            <div className="faq-list">
              {faq.map(([question, answer], i) => (
                <div
                  className={`faq-item ${activeFaq === i ? "expanded" : ""}`}
                  key={question}
                >
                  <button
                    aria-expanded={activeFaq === i}
                    aria-controls={`faq-${i}`}
                    onClick={() => setActiveFaq(activeFaq === i ? null : i)}
                  >
                    <span>{question}</span>
                    {activeFaq === i ? <Minus size={20} /> : <Plus size={20} />}
                  </button>
                  <div id={`faq-${i}`} hidden={activeFaq !== i}>
                    <p>{answer}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta">
          <div className="container">
            <div>
              <div className="eyebrow">
                06 / ДАВАЙТЕ СОЗДАДИМ ЧТО-ТО ПРОЧНОЕ
              </div>
              <h2>
                Есть идея? <span>Сварим.</span>
              </h2>
            </div>
            <button className="button button-dark" onClick={() => openOrder()}>
              Обсудить мой проект <ArrowUpRight size={22} />
            </button>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <div className="footer-main">
            <div>
              <Brand />
              <p>
                Сварка, которая держит.
                <br />
                Решения из металла — под вашу задачу.
              </p>
            </div>
            <div className="footer-column">
              <span>НАВИГАЦИЯ</span>
              <a href="#services">Услуги</a>
              <a href="#portfolio">Проекты</a>
              <a href="#calculator">Калькулятор</a>
            </div>
            <div className="footer-column">
              <span>НА СВЯЗИ</span>
              <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>{phoneDisplay}</a>
              {SERVER_ENABLED && (
                <a href={botUrl} target="_blank" rel="noopener noreferrer">
                  Telegram <ArrowUpRight size={14} />
                </a>
              )}
              <a href={masterTelegramUrl} target="_blank" rel="noopener noreferrer">Написать мастеру в Telegram <ArrowUpRight size={14} /></a>
              <button onClick={() => setContact(true)}>Контакты мастера</button>
              {SERVER_ENABLED && (
                <button onClick={() => setTracking(true)}>Мои заявки</button>
              )}
            </div>
            <div className="footer-statement">
              СДЕЛАНО
              <br />С <span>ХАРАКТЕРОМ.</span>
              <span className="footer-spark">✳︎</span>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} AIK BASE · АЙК БАЗА</span>
            <button onClick={() => setPrivacy(true)}>
              Обработка персональных данных
            </button>
            <a href="#home">
              НАВЕРХ <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      </footer>

      <Modal
        open={orderOpen}
        onClose={() => {
          if (!sending) setOrderOpen(false);
        }}
        label="Оформить заявку"
        wide
      >
        {draftText ? (
          <div className="draft-screen">
            <div className="eyebrow">ТЕКСТ ЗАЯВКИ ГОТОВ</div>
            <h2>Осталось передать мастеру.</h2>
            <p className="notice">
              Заявка ещё не отправлена. Скопируйте текст в переписку с мастером
              или отправьте SMS. Получение, цену и сроки можно уточнить по
              телефону.
            </p>
            <label className="field">
              Текст заявки
              <textarea
                className="draft-text"
                value={draftText}
                readOnly
                rows={12}
              />
            </label>
            <div className="draft-actions">
              <button
                className="button button-primary"
                onClick={async () => {
                  try {
                    if (!navigator.clipboard) throw new Error();
                    await navigator.clipboard.writeText(draftText);
                    setDraftNotice(
                      "Текст скопирован. Отправьте его мастеру самостоятельно.",
                    );
                  } catch {
                    setDraftNotice(
                      "Выделите и скопируйте текст вручную или сохраните его файлом.",
                    );
                  }
                }}
              >
                <Copy size={17} />
                Скопировать текст
              </button>
              <button
                className="button button-outline"
                onClick={() => downloadText(draftText)}
              >
                <ArrowDown size={17} />
                Сохранить текст
              </button>
              <a className="button button-primary" href={`${masterTelegramUrl}?text=${encodeURIComponent(draftText)}`} target="_blank" rel="noopener noreferrer"><Send size={17} />Передать в Telegram</a>
              <a
                className="button button-outline"
                href={`sms:${phone}?body=${encodeURIComponent(draftText)}`}
              >
                <Send size={17} />
                Открыть SMS
              </a>
              <a className="button button-outline" href={`tel:${phone}`}>
                Позвонить мастеру <ArrowUpRight size={17} />
              </a>
              {typeof navigator.share === "function" && (
                <button
                  className="button button-outline"
                  onClick={async () => {
                    try {
                      await navigator.share({
                        title: "Заявка AIK BASE",
                        text: draftText,
                      });
                    } catch (error) {
                      if ((error as Error).name !== "AbortError")
                        setDraftNotice(
                          "Не удалось открыть отправку. Скопируйте или сохраните текст.",
                        );
                    }
                  }}
                >
                  Поделиться <ArrowUpRight size={17} />
                </button>
              )}
            </div>
            {draftNotice && (
              <p className="notice" role="status">
                {draftNotice}
              </p>
            )}
            <button
              className="text-link draft-back"
              onClick={() => {
                setDraftText("");
                setDraftNotice("");
              }}
            >
              Вернуться к форме <ArrowRight size={16} />
            </button>
          </div>
        ) : success ? (
          <div className="success-screen">
            <span className="success-icon">
              <CheckCheck size={35} />
            </span>
            <div className="eyebrow">ЗАЯВКА СОХРАНЕНА</div>
            <h2>Начало положено.</h2>
            <p>{success.message}</p>
            <div className="order-number">
              <small>НОМЕР ЗАЯВКИ</small>
              <strong>{success.order.id}</strong>
              <button
                className="text-link"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(success.order.id)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2500);
                    })
                    .catch(() => {});
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Скопировано" : "Скопировать номер"}
              </button>
            </div>
            <p className="form-footnote">
              Ключ доступа хранится до закрытия вкладки. Сохраните файл доступа,
              чтобы открыть заявку позже. В Telegram заявка также привязана к
              вашему аккаунту.
            </p>
            <button
              className="button button-outline full-width"
              onClick={saveReceipt}
            >
              Сохранить файл доступа <ArrowDown size={17} />
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                setOrderOpen(false);
                setTracking(true);
              }}
            >
              Посмотреть статус <ArrowRight size={18} />
            </button>
          </div>
        ) : (
          <>
            <div className="eyebrow">НАЧНЁМ С ВАШЕЙ ЗАДАЧИ</div>
            <h2>Обсудим проект.</h2>
            <p className="modal-intro">
              Заполните детали — они помогут мастеру подготовиться к разговору.
            </p>
            {!SERVER_ENABLED && (
              <div className="notice">
                Форма подготовит текст заявки на вашем устройстве. Затем вы сами
                отправите его мастеру. Автоматической отправки и отслеживания
                статуса здесь нет.
              </div>
            )}
            {SERVER_ENABLED && apiState === "offline" && (
              <div className="notice" role="status">
                API сейчас недоступно. Отправка заявки может не работать. Можно
                написать в{" "}
                <a href={botUrl} target="_blank" rel="noopener noreferrer">
                  Telegram
                </a>
                .
              </div>
            )}
            {SERVER_ENABLED &&
              apiState === "online" &&
              !config?.notificationsReady && (
                <div className="notice">
                  Уведомления мастеру пока не подключены. Заявка сохранится на
                  сервере; для связи также используйте Telegram.
                </div>
              )}
            <form
              className="order-form"
              onSubmit={submitOrder}
              aria-busy={sending}
            >
              <fieldset disabled={sending}>
                <InputFields value={input} onChange={changeInput} />
                <div className="form-divider" />
                <div className="field-grid">
                  <label className="field">
                    Ваше имя
                    <input
                      name="name"
                      defaultValue={draftValues?.name || ""}
                      autoComplete="name"
                      required
                      minLength={2}
                      maxLength={80}
                      placeholder="Как к вам обращаться"
                    />
                  </label>
                  <label className="field">
                    Телефон, email или Telegram
                    <input
                      name="contact"
                      defaultValue={draftValues?.contact || ""}
                      required
                      minLength={5}
                      maxLength={160}
                      placeholder="+7 … или @username"
                      autoComplete="off"
                    />
                  </label>
                </div>
                <label className="field">
                  Что нужно сделать?
                  <textarea
                    name="description"
                    defaultValue={draftValues?.description || ""}
                    required
                    minLength={10}
                    maxLength={3000}
                    rows={3}
                    placeholder="Опишите задачу: конструкция, назначение, особенности…"
                  />
                </label>
                <label className="field">
                  Пожелания и сроки{" "}
                  <span className="optional">необязательно</span>
                  <textarea
                    name="comment"
                    defaultValue={draftValues?.comment || ""}
                    maxLength={1000}
                    rows={2}
                    placeholder="Адрес объекта, удобное время или другие детали"
                  />
                </label>
                <div className="honeypot" aria-hidden="true">
                  <label>
                    Ваш сайт
                    <input name="website" tabIndex={-1} autoComplete="off" />
                  </label>
                </div>
                <label className="check-field consent-field">
                  <input name="consent" type="checkbox" required />
                  <span>
                    {SERVER_ENABLED
                      ? "Согласен на обработку указанных данных для ответа на заявку."
                      : "Понимаю, что текст нужно самостоятельно передать мастеру."}{" "}
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => setPrivacy(true)}
                    >
                      Подробнее
                    </button>
                  </span>
                </label>
                {submitError && (
                  <p className="form-error" role="alert">
                    {submitError}
                  </p>
                )}
                <button
                  className="button button-primary full-width"
                  type="submit"
                  disabled={sending}
                >
                  {sending ? (
                    <>
                      <LoaderCircle size={20} className="spin" /> Сохраняем
                      заявку…
                    </>
                  ) : (
                    <>
                      {SERVER_ENABLED
                        ? "Отправить заявку"
                        : "Подготовить текст заявки"}{" "}
                      <ArrowUpRight size={20} />
                    </>
                  )}
                </button>
                <p className="form-footnote">
                  <ShieldCheck size={14} />{" "}
                  {SERVER_ENABLED
                    ? "Данные доступны только вам и мастеру"
                    : "Данные формы не отправляются на сервер"}
                </p>
              </fieldset>
            </form>
          </>
        )}
      </Modal>

      {SERVER_ENABLED && (
        <Modal
          open={tracking}
          onClose={() => setTracking(false)}
          label="Мои заявки"
        >
          <div className="eyebrow">НА СВЯЗИ С ПРОЕКТОМ</div>
          <h2>Мои заявки</h2>
          <p className="modal-intro">
            Заявки доступны в исходной вкладке или в вашем Telegram-аккаунте.
          </p>
          {myOrders.length > 0 && (
            <div className="my-orders">
              {myOrders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => {
                    setTrackingId(order.id);
                    setTracked(order);
                  }}
                >
                  <span>
                    {services.find((s) => s.id === order.serviceId)?.title}
                    <small>
                      {new Date(order.createdAt).toLocaleDateString("ru-RU")}
                    </small>
                  </span>
                  <span className="status-badge">
                    {statusNames[order.status] || order.status}
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
          <form onSubmit={findOrder}>
            <label className="field">
              Номер заявки
              <input
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value)}
                placeholder="Вставьте полный номер заявки"
                required
                maxLength={36}
              />
            </label>
            <label className="field">
              Личный ключ доступа{" "}
              <span className="optional">если открыли новую вкладку</span>
              <input
                type="password"
                autoComplete="off"
                value={trackingKey}
                onChange={(e) => setTrackingKey(e.target.value)}
                placeholder="Из сохранённого файла доступа"
                maxLength={128}
              />
            </label>
            <button
              className="button button-primary full-width"
              disabled={trackingLoading}
            >
              {trackingLoading ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Clock3 size={18} />
              )}{" "}
              Проверить статус
            </button>
          </form>
          {trackingError && (
            <p className="form-error" role="alert">
              {trackingError}
            </p>
          )}
          {tracked && (
            <div className="tracked-order" aria-live="polite">
              <span className="status-badge">
                {statusNames[tracked.status] || tracked.status}
              </span>
              <h3>{services.find((s) => s.id === tracked.serviceId)?.title}</h3>
              <p>{tracked.description}</p>
              <small>
                {new Date(tracked.createdAt).toLocaleString("ru-RU")}
              </small>
              <p className="form-footnote">
                {tracked.notificationStatus === "sent"
                  ? "Уведомление мастеру отправлено."
                  : "Уведомление мастеру ожидает отправки."}
              </p>
            </div>
          )}
        </Modal>
      )}

      <Modal
        open={!!photo}
        onClose={() => setPhoto(null)}
        label="Просмотр проекта"
        wide
      >
        {photo && (
          <div className="photo-view">
            {photo.video && !activeProjectPhoto ? (
              <video
                key={photo.id}
                controls
                playsInline
                preload="metadata"
                poster={asset(photo.image)}
                aria-label={photo.title}
              >
                <source src={asset(photo.video)} type="video/mp4" />
                Ваш браузер не поддерживает видео.{" "}
                <a href={asset(photo.video)}>Открыть видео</a>
              </video>
            ) : (
              <img src={asset(activeProjectPhoto || photo.image)} alt={photo.description} />
            )}
            {photo.photos?.length ? <div className="project-media-switch" aria-label="Материалы проекта">
              <button type="button" aria-pressed={!activeProjectPhoto} onClick={() => setActiveProjectPhoto(null)}>{photo.video ? "Видео с объекта" : "Главное фото"}</button>
              {photo.photos.map((image, index) => <button type="button" key={image} aria-pressed={activeProjectPhoto === image} onClick={() => setActiveProjectPhoto(image)}>Фото {index + 1} · монтаж</button>)}
            </div> : null}
            <span className="demo-label">
              {photo.demo
                ? "ИЛЛЮСТРАЦИЯ · НЕ ВЫПОЛНЕННЫЙ ЗАКАЗ"
                : photo.video && !activeProjectPhoto
                  ? "ВИДЕО С ОБЪЕКТА"
                  : "ФОТОГРАФИЯ ПРОЕКТА"}
            </span>
            <h2>{photo.title}</h2>
            <p>{photo.description}</p>
            <button
              className="button button-primary"
              onClick={() => {
                setPhoto(null);
                openOrder(photo.category);
              }}
            >
              Обсудить похожий проект <ArrowUpRight size={18} />
            </button>
          </div>
        )}
      </Modal>
      <Modal
        open={contact}
        onClose={() => setContact(false)}
        label="Контакты мастера"
      >
        <div className="eyebrow">ДАВАЙТЕ ОБСУДИМ</div>
        <h2>На связи.</h2>
        <p className="modal-intro">
          Позвоните мастеру, чтобы обсудить задачу, или оставьте заявку с
          размерами и пожеланиями.
        </p>
        {SERVER_ENABLED && (
          <a
            className="button button-primary full-width"
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Send size={18} /> @AikBaseOrder_Bot
          </a>
        )}
        <a className="button button-primary full-width" href={masterTelegramUrl} target="_blank" rel="noopener noreferrer"><Send size={18} />Написать мастеру в Telegram</a>
        {phone && (
          <a
            className="contact-detail"
            href={`tel:${phone.replace(/[^+\d]/g, "")}`}
          >
            {phoneDisplay}
          </a>
        )}
        {config?.email && (
          <a className="contact-detail" href={`mailto:${config.email}`}>
            {config.email}
          </a>
        )}
        <p className="form-footnote">
          {SERVER_ENABLED
            ? "Чат с ботом не является прямым чатом мастера. Для передачи задачи используйте форму заявки."
            : "Форма подготовит текст заявки. Отправьте его мастеру в Telegram или обсудите задачу по телефону. Для отправки сообщения нажмите кнопку отправки в Telegram."}
        </p>
        <button
          className="button button-outline full-width"
          onClick={() => {
            setContact(false);
            openOrder();
          }}
        >
          Оформить заявку <ArrowUpRight size={18} />
        </button>
      </Modal>
      <Modal
        open={privacy}
        onClose={() => setPrivacy(false)}
        label="Обработка персональных данных"
      >
        <div className="eyebrow">ВАШИ ДАННЫЕ</div>
        <h2>Только для дела.</h2>
        <div className="privacy-copy">
          {!SERVER_ENABLED ? (
            <>
              <p>
                Форма помогает составить текст заявки: имя, контакт, параметры
                проекта и описание задачи. Данные обрабатываются только в
                открытой странице и не отправляются в базу данных или боту.
              </p>
              <p>
                Текст передаётся другому приложению только по вашему действию:
                копированию, открытию SMS или кнопке «Поделиться». Сайт не
                проверяет и не подтверждает отправку или получение мастером.
              </p>
              <p>
                Не указывайте паспортные или платёжные данные. Скачанный файл
                остаётся на вашем устройстве; удалите его, когда он больше не
                нужен. Уточнить вопросы по заявке можно по телефону{" "}
                {phoneDisplay}.
              </p>
            </>
          ) : (
            <>
              <p>
                Форма запрашивает имя, контакт, параметры проекта и описание
                задачи. Они используются для обработки заявки и обратной связи.
                В Mini App после проверки авторизации к заявке привязывается
                числовой Telegram ID.
              </p>
              <p>
                Данные хранятся в базе сервера. При подключённом боте информация
                о заявке передаётся администратору через Telegram. Другие
                посетители не могут просматривать заявки без личного ключа
                доступа или авторизации владельца.
              </p>
              <p>
                Не указывайте паспортные данные, платёжные реквизиты и другую
                чувствительную информацию. Для уточнения или удаления заявки
                свяжитесь с мастером и укажите номер заявки.
              </p>
              <div className="notice">
                Перед публичным приёмом заказов владелец должен указать свои
                реквизиты, контакт для обращений, сроки хранения и применимые
                правила обработки данных. Сейчас это информационное описание
                работы формы.
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

export default App;
