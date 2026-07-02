/**
 * Находится ли фокус в поле ввода текста (input / textarea / contenteditable).
 *
 * Доменно-независимый DOM-примитив, поэтому живёт в shared: любой клавиатурный
 * хоткей холста (удаление и будущие undo / копипаст / хоткеи инструментов) обязан
 * пропускать такие цели, иначе перехватит клавиши у пользователя, редактирующего
 * текст (напр. Backspace снёс бы фигуру вместо символа).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
