import { useEffect, useRef, useState, type FormEvent } from "react";
import services from "../shared/services.json";
import { orderSchema } from "../shared/validation.mjs";
import type { EstimateInput } from "./types";
import type { DraftInput } from "./draft";
export default function QuickRequest({
  initial,
  reference,
  onPrepared,
}: {
  initial: EstimateInput & Partial<DraftInput>;
  reference: string;
  onPrepared: (draft: DraftInput) => void;
}) {
  const [step, setStep] = useState(0),
    [input, setInput] = useState<EstimateInput>(() => ({serviceId:initial.serviceId,metal:initial.metal,width:initial.width,height:initial.height,quantity:initial.quantity,onsite:initial.onsite})),
    [description, setDescription] = useState(initial.description || reference),
    [name, setName] = useState(initial.name || ""),
    [contact, setContact] = useState(initial.contact || ""),
    [comment, setComment] = useState(initial.comment || ""),
    [unknown, setUnknown] = useState(initial.sizesUnknown || false),
    [error, setError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    title.current?.closest("dialog")?.scrollTo({ top: 0 });
  }, [step]);
  function next(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (step === 0) {
      if (description.trim().length < 10) {
        setError("Коротко опишите задачу — хотя бы 10 символов.");
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    const data = new FormData(e.currentTarget),
      payload = {
        ...input,
        width: unknown ? 1 : input.width,
        height: unknown ? 1 : input.height,
        name: name.trim(),
        contact: contact.trim(),
        description: description.trim(),
        comment: comment.trim(),
        consent: data.get("consent") === "on",
        website: "",
      };
    const parsed = orderSchema.safeParse(payload);
    if (!parsed.success) {
      setError(
        "Проверьте имя и контакт: телефон, email или Telegram @username.",
      );
      return;
    }
    onPrepared({ ...payload, sizesUnknown: unknown });
  }
  return (
    <form className="quick-request" onSubmit={next}>
      <ol className="request-progress" aria-label="Этапы заявки">
        {["Задача", "Размеры", "Связь"].map((label, i) => (
          <li key={label} aria-current={step === i ? "step" : undefined}>
            <span>{i < step ? "✓" : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <h3 tabIndex={-1} ref={title}>
        {
          [
            "Что нужно сделать?",
            "Какие размеры известны?",
            "Как с вами связаться?",
          ][step]
        }
      </h3>
      {step === 0 && (
        <>
          <label className="field">
            Вид работ
            <select
              aria-label="Вид работ"
              value={input.serviceId}
              onChange={(e) =>
                setInput({ ...input, serviceId: e.target.value })
              }
            >
              {services.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          {reference && (
            <p className="request-reference">
              По примеру из портфолио: {reference}
            </p>
          )}
          <label className="field">
            Что нужно сделать?
            <textarea
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={10}
              maxLength={3000}
              rows={3}
              placeholder="Например: нужен навес для машины или ремонт металлических перил"
            />
          </label>
          <a
            className="inline-link"
            href="https://t.me/+79349999779"
            target="_blank"
            rel="noopener noreferrer"
          >
            Просто задать вопрос мастеру в Telegram ↗
          </a>
        </>
      )}
      {step === 1 && (
        <>
          <label className="check-field">
            <input
              type="checkbox"
              checked={unknown}
              onChange={(e) => setUnknown(e.target.checked)}
            />
            Размеров пока нет — нужна консультация
          </label>
          {!unknown && (
            <div className="field-grid">
              {(
                [
                  ["width", "Длина, м"],
                  ["height", "Ширина / высота, м"],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    type="number"
                    required
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={Number.isNaN(input[key]) ? "" : input[key]}
                    onChange={(e) =>
                      setInput({ ...input, [key]: e.target.valueAsNumber })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          <p className="form-footnote">
            Приблизительные размеры подойдут. Возможность выезда и замера
            согласуется с мастером.
          </p>
          <details className="request-extra">
            <summary>Материал, количество и выезд</summary>
            <label className="field">
              Тип металла
              <select
                value={input.metal}
                onChange={(e) => setInput({ ...input, metal: e.target.value })}
              >
                <option value="steel">Сталь</option>
                <option value="stainless">Нержавеющая сталь</option>
                <option value="aluminum">Алюминий</option>
              </select>
            </label>
            <label className="field">
              Количество
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                required
                value={input.quantity}
                onChange={(e) =>
                  setInput({ ...input, quantity: e.target.valueAsNumber })
                }
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={input.onsite}
                onChange={(e) =>
                  setInput({ ...input, onsite: e.target.checked })
                }
              />
              Нужен выезд на объект
            </label>
          </details>
        </>
      )}
      {step === 2 && (
        <>
          <div className="request-review">
            <strong>
              {services.find((s) => s.id === input.serviceId)?.title}
            </strong>
            <p>{description}</p>
            <p>
              {unknown
                ? "Размеры нужно уточнить"
                : `Приблизительные размеры: ${input.width} × ${input.height} м`}
            </p>
          </div>
          <div className="field-grid">
            <label className="field">
              Ваше имя
              <input
                name="name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Как к вам обращаться"
              />
            </label>
            <label className="field">
              Телефон, email или Telegram
              <input
                name="contact"
                required
                minLength={5}
                maxLength={160}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="+7 … или @username"
              />
            </label>
          </div>
          <details className="request-extra">
            <summary>Добавить пожелания и сроки</summary>
            <label className="field">
              Пожелания и сроки
              <textarea
                name="comment"
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
              />
            </label>
          </details>
          <label className="check-field consent-field">
            <input name="consent" required type="checkbox" />
            Понимаю, что текст нужно самостоятельно передать мастеру.
          </label>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="request-navigation">
        {step > 0 && (
          <button
            type="button"
            className="button button-outline"
            onClick={() => {
              setError("");
              setStep(step - 1);
            }}
          >
            Назад
          </button>
        )}
        <button type="submit" className="button button-primary">
          {step < 2 ? "Далее" : "Подготовить текст заявки"} ↗
        </button>
      </div>
      <p className="form-footnote">
        Данные остаются на устройстве до передачи в Telegram. После подготовки
        текста проверьте его и подтвердите отправку мастеру.
      </p>
    </form>
  );
}
